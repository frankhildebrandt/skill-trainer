import { useEffect, useMemo, useRef, useState } from "react";
import { estimateRuns } from "@shared/estimate";
import { applyRunUpdate, type RunBlock } from "@shared/run-log";
import { changedLines } from "@shared/text-diff";
import type {
  AuthStatus,
  ModelOption,
  SessionSummary,
  SkillFile,
  StepRecord,
  TrainRequest,
  Trajectory,
} from "@shared/types";
import { MarkdownView } from "./MarkdownView";

interface LiveRun {
  runId: string;
  phase: Trajectory["phase"];
  ground: Trajectory["ground"];
  taskPrompt: string;
  title?: string;
  blocks: RunBlock[];
  startedAt?: number;
  settled?: boolean;
  trajectory?: Trajectory;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type FeedItem =
  | { id: number; type: "note"; text: string }
  | { id: number; type: "agent"; runId: string }
  | { id: number; type: "finding"; index: number }
  | { id: number; type: "report" };

const EMPTY: TrainRequest = {
  skillPath: "",
  workspacePath: "",
  auftrag: "",
  extraTasks: "",
  verifyMode: "command",
  verifyCommand: "",
  targetModel: "composer-2.5",
  optimizerModel: "composer-2.5",
  steps: 2,
  trainBatch: 2,
  selectionRepeats: 2,
  concurrency: 2,
  learningRate: 3,
  slowUpdate: true,
  gateOnEmptyRepo: false,
  skillScope: "general",
  attemptTimeoutMin: 12,
  verifyTimeoutSec: 180,
};

export function App() {
  const api = window.trainer;
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [models, setModels] = useState<ModelOption[]>([{ id: "composer-2.5", label: "Composer 2.5" }]);
  const [form, setForm] = useState<TrainRequest>(EMPTY);
  const [settingsReady, setSettingsReady] = useState(false);
  const [skillName, setSkillName] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("bereit");
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const seenAgents = useRef(new Set<string>());
  const feedStick = useRef(true);
  const agentStick = useRef(true);

  function pushFeed(item: DistributiveOmit<FeedItem, "id">) {
    const id = ++seq.current;
    setFeed((prev) => [...prev, { ...item, id }]);
  }

  function rememberAgent(runId: string) {
    if (seenAgents.current.has(runId)) return;
    seenAgents.current.add(runId);
    pushFeed({ type: "agent", runId });
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.loadSettings().then(async (saved) => {
      if (cancelled) return;
      if (saved) {
        setForm(saved);
        if (saved.skillPath) {
          try {
            const preview = await api.readSkill(saved.skillPath);
            if (!cancelled) setSkillName(skillLabel(preview));
          } catch {
            if (!cancelled) setSkillName(null);
          }
        }
      }
      if (!cancelled) setSettingsReady(true);
    }).catch(() => {
      if (!cancelled) setSettingsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !settingsReady) return;
    const timer = setTimeout(() => {
      void api.saveSettings(form);
    }, 250);
    return () => clearTimeout(timer);
  }, [api, form, settingsReady]);

  useEffect(() => {
    if (!api) return;
    void api.authStatus().then(setAuth).catch((err: unknown) => pushFeed({ type: "note", text: messageOf(err) }));
    void api.listModels().then((result) => {
      if (result.models.length > 0) setModels(result.models);
    });
    return api.onEvent((event) => {
      if (event.type === "log") pushFeed({ type: "note", text: event.message });
      if (event.type === "phase") setPhase(phaseLabel(event.phase));
      if (event.type === "run_started") {
        setRuns((prev) => [
          ...prev,
          {
            runId: event.run.runId,
            phase: event.run.phase,
            ground: event.run.ground,
            taskPrompt: event.run.taskPrompt,
            blocks: [],
            startedAt: Date.now(),
          },
        ]);
        rememberAgent(event.run.runId);
      }
      if (event.type === "run_activity") {
        setRuns((prev) => {
          const index = prev.findIndex((run) => run.runId === event.runId);
          if (index < 0) {
            return [
              ...prev,
              {
                runId: event.runId,
                phase: "train",
                ground: "repo",
                taskPrompt: event.title ?? event.runId,
                title: event.title,
                blocks: event.update ? applyRunUpdate([], event.update) : [],
                startedAt: Date.now(),
                settled: event.settled,
              },
            ];
          }
          return prev.map((run) =>
            run.runId === event.runId
              ? {
                  ...run,
                  title: event.title ?? run.title,
                  blocks: event.update ? applyRunUpdate(run.blocks, event.update) : run.blocks,
                  settled: event.settled || run.settled,
                }
              : run,
          );
        });
        rememberAgent(event.runId);
      }
      if (event.type === "run_finished") {
        setRuns((prev) => prev.map((run) => (run.runId === event.run.runId ? { ...run, trajectory: event.run } : run)));
      }
      if (event.type === "step") {
        setSteps((prev) => {
          const next = prev.slice();
          next[event.step.index] = event.step;
          return next;
        });
        if (event.step.kind !== "baseline") pushFeed({ type: "finding", index: event.step.index });
      }
      if (event.type === "error") pushFeed({ type: "note", text: event.message });
      if (event.type === "done") {
        setSummary(event.summary);
        pushFeed({ type: "report" });
      }
    });
  }, [api]);

  const anyLive = runs.some((run) => isLive(run));
  useEffect(() => {
    if (!anyLive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyLive]);

  const estimate = useMemo(
    () =>
      estimateRuns({
        steps: form.steps,
        trainBatch: form.trainBatch,
        selectionRepeats: form.selectionRepeats,
        slowUpdate: form.slowUpdate,
      }),
    [form.steps, form.trainBatch, form.selectionRepeats, form.slowUpdate],
  );

  if (!api) {
    return <main className="fallback">Skill Trainer läuft nur in der Electron-App.</main>;
  }

  async function login() {
    setAuth({ state: "logged-out", email: null, via: "none", message: "Browser ist offen …" });
    try {
      const next = await api.authLogin();
      setAuth(next);
      const listed = await api.listModels();
      if (listed.models.length > 0) setModels(listed.models);
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
    }
  }

  async function chooseSkill() {
    const picked = await api.pickSkill();
    if (!picked) return;
    setForm((prev) => ({ ...prev, skillPath: picked }));
    try {
      const preview = await api.readSkill(picked);
      setSkillName(skillLabel(preview));
    } catch (err) {
      setSkillName(null);
      pushFeed({ type: "note", text: messageOf(err) });
    }
  }

  async function chooseFolder() {
    const picked = await api.pickFolder();
    if (picked) setForm((prev) => ({ ...prev, workspacePath: picked }));
  }

  async function start() {
    setRunning(true);
    setNotice(null);
    setSummary(null);
    setSteps([]);
    setRuns([]);
    setFeed([]);
    setTabs([]);
    setActive(null);
    seq.current = 0;
    seenAgents.current = new Set();
    setPhase("startet");
    try {
      await api.start(form);
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
    } finally {
      setRunning(false);
    }
  }

  async function writeBack() {
    setNotice(null);
    try {
      const result = await api.writeBack();
      setNotice(`Übernommen nach ${result.skillPath}. Backup: ${result.backupPath}`);
    } catch (err) {
      setNotice(messageOf(err));
    }
  }

  function openAgent(runId: string) {
    setTabs((prev) => (prev.includes(runId) ? prev : [...prev, runId]));
    setActive(runId);
    agentStick.current = true;
  }

  function closeTab(runId: string) {
    const next = tabs.filter((tab) => tab !== runId);
    setTabs(next);
    if (active === runId) {
      const index = Math.max(0, tabs.indexOf(runId) - 1);
      setActive(next[index] ?? null);
    }
  }

  const improved = summary ? bundleChanged(summary) : false;
  const activeRun = runs.find((run) => run.runId === active);
  const runCount = estimate.attempts + (form.verifyMode === "agent" ? 1 : 0);

  return (
    <div className="app">
      <header>
        <div className="mark">ST</div>
        <h1>Skill Trainer</h1>
        <div className="auth">
          <span className={auth?.state === "logged-in" ? "pill ok" : "pill"}>{authLabel(auth)}</span>
          <button type="button" onClick={() => void login()} disabled={running}>
            Anmelden
          </button>
        </div>
      </header>

      <div className="layout">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <label>
            Skill
            <div className="row">
              <input readOnly value={form.skillPath} placeholder="Ordner oder SKILL.md" />
              <button type="button" onClick={() => void chooseSkill()} disabled={running}>
                Wählen
              </button>
            </div>
            {skillName ? <small>{skillName}</small> : null}
          </label>

          <label>
            Projekt
            <div className="row">
              <input readOnly value={form.workspacePath} placeholder="Projektordner" />
              <button type="button" onClick={() => void chooseFolder()} disabled={running}>
                Wählen
              </button>
            </div>
          </label>

          <label>
            Auftrag
            <textarea
              value={form.auftrag}
              onChange={(event) => setForm({ ...form, auftrag: event.target.value })}
              rows={4}
              placeholder="Was der Agent können soll"
            />
          </label>

          <label>
            Weitere Aufträge
            <textarea
              value={form.extraTasks}
              onChange={(event) => setForm({ ...form, extraTasks: event.target.value })}
              rows={2}
              placeholder="Eine Zeile pro Variante"
            />
          </label>

          <fieldset className="choice" disabled={running}>
            <legend>Prüfung</legend>
            <label className="check">
              <input
                type="radio"
                name="verifyMode"
                checked={form.verifyMode === "command"}
                onChange={() => setForm({ ...form, verifyMode: "command" })}
              />
              Testbefehl
            </label>
            <label className="check">
              <input
                type="radio"
                name="verifyMode"
                checked={form.verifyMode === "agent"}
                onChange={() => setForm({ ...form, verifyMode: "agent" })}
              />
              Agent schreibt das Testskript
            </label>
          </fieldset>

          <fieldset className="choice" disabled={running}>
            <legend>Ziel</legend>
            <label className="check">
              <input
                type="radio"
                name="skillScope"
                checked={form.skillScope !== "specific"}
                onChange={() => setForm({ ...form, skillScope: "general" })}
              />
              Allgemein
            </label>
            <label className="check">
              <input
                type="radio"
                name="skillScope"
                checked={form.skillScope === "specific"}
                onChange={() => setForm({ ...form, skillScope: "specific" })}
              />
              Dieser Auftrag
            </label>
          </fieldset>

          {form.verifyMode === "command" ? (
            <label>
              Testbefehl
              <input
                value={form.verifyCommand}
                onChange={(event) => setForm({ ...form, verifyCommand: event.target.value })}
                placeholder="npm test"
                disabled={running}
              />
            </label>
          ) : null}

          <div className="grid">
            <label>
              Zielmodell
              <select value={form.targetModel} onChange={(event) => setForm({ ...form, targetModel: event.target.value })}>
                {modelChoices(models, form.targetModel).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optimierer
              <select
                value={form.optimizerModel}
                onChange={(event) => setForm({ ...form, optimizerModel: event.target.value })}
              >
                {modelChoices(models, form.optimizerModel).map((model) => (
                  <option key={`opt-${model.id}`} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid nums">
            <NumberField label="Schritte" value={form.steps} min={1} max={6} disabled={running} onChange={(steps) => setForm({ ...form, steps })} />
            <NumberField label="Training" value={form.trainBatch} min={1} max={6} disabled={running} onChange={(trainBatch) => setForm({ ...form, trainBatch })} />
            <NumberField label="Gate" value={form.selectionRepeats} min={1} max={4} disabled={running} onChange={(selectionRepeats) => setForm({ ...form, selectionRepeats })} />
            <NumberField label="Parallel" value={form.concurrency} min={1} max={6} disabled={running} onChange={(concurrency) => setForm({ ...form, concurrency })} />
            <NumberField label="Lernrate" value={form.learningRate} min={1} max={6} disabled={running} onChange={(learningRate) => setForm({ ...form, learningRate })} />
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={form.gateOnEmptyRepo}
              onChange={(event) => setForm({ ...form, gateOnEmptyRepo: event.target.checked })}
              disabled={running}
            />
            Gate auf leerem Repository
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.slowUpdate}
              onChange={(event) => setForm({ ...form, slowUpdate: event.target.checked })}
              disabled={running}
            />
            Slow-Update
          </label>

          <p className="estimate">
            {runCount} Läufe · {estimate.optimizer} Optimierer
          </p>

          <div className="actions">
            <button type="submit" className="primary" disabled={running}>
              {running ? phase : "Start"}
            </button>
            <button type="button" onClick={() => void api.cancel()} disabled={!running}>
              Abbrechen
            </button>
          </div>
        </form>

        <section className="feed">
          <div
            className="sheet"
            onScroll={(event) => {
              const node = event.currentTarget;
              feedStick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
            }}
            ref={(node) => {
              if (node && feedStick.current) node.scrollTop = node.scrollHeight;
            }}
          >
            <div className="column">
              {feed.length === 0 ? <p className="quiet">Noch kein Lauf.</p> : null}
              {feed.map((item) => {
                if (item.type === "note") {
                  return (
                    <div key={item.id} className="msg">
                      <MarkdownView text={item.text} />
                    </div>
                  );
                }
                if (item.type === "agent") {
                  const run = runs.find((entry) => entry.runId === item.runId);
                  if (!run) return null;
                  return (
                    <button key={item.id} type="button" className="agent-link" onClick={() => openAgent(run.runId)}>
                      <LiveMark run={run} />
                      <span>{agentLabel(run)}</span>
                      <span className="agent-time">{runDuration(run, now)}</span>
                      <span className="agent-state">{runState(run)}</span>
                    </button>
                  );
                }
                if (item.type === "finding") {
                  const step = steps[item.index];
                  if (!step) return null;
                  return <FindingCard key={item.id} step={step} />;
                }
                return summary ? (
                  <Report
                    key={item.id}
                    summary={summary}
                    improved={improved}
                    notice={notice}
                    onApply={() => void writeBack()}
                    onOpen={() => void api.openPath(summary.sessionDir)}
                  />
                ) : null;
              })}
            </div>
          </div>
        </section>

        <section className="logs">
          <div className="tabs" role="tablist">
            {tabs.length === 0 ? <span className="tab-hint">Agenten</span> : null}
            {tabs.map((tab) => {
              const run = runs.find((item) => item.runId === tab);
              const live = run ? isLive(run) : false;
              return (
                <div key={tab} className={tab === active ? "tab on" : "tab"}>
                  <button type="button" role="tab" aria-selected={tab === active} onClick={() => setActive(tab)}>
                    {live ? <span className="spin" aria-hidden="true" /> : null}
                    {run ? tabLabel(run) : tab}
                  </button>
                  <button type="button" className="tab-x" aria-label="Tab schließen" onClick={() => closeTab(tab)}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div
            className="sheet"
            onScroll={(event) => {
              const node = event.currentTarget;
              agentStick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
            }}
            ref={(node) => {
              if (node && agentStick.current) node.scrollTop = node.scrollHeight;
            }}
          >
            <div className="column">
              {activeRun ? (
                <>
                  <div className="agent-head">
                    <LiveMark run={activeRun} />
                    <div>
                      <strong>{agentLabel(activeRun)}</strong>
                      <p>
                        {runState(activeRun)}
                        {runDuration(activeRun, now) ? ` · ${runDuration(activeRun, now)}` : ""}
                      </p>
                    </div>
                  </div>
                  {activeRun.blocks.length > 0 ? (
                    <div className="stream">
                      {activeRun.blocks.map((block, index) => (
                        <BlockView key={index} block={block} />
                      ))}
                    </div>
                  ) : (
                    <p className="quiet">Wartet auf die erste Ausgabe.</p>
                  )}
                  {activeRun.trajectory?.keptWorkspace ? (
                    <button type="button" onClick={() => void api.openPath(activeRun.trajectory!.keptWorkspace!)}>
                      Kopie öffnen
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="quiet">Klicke einen Lauf im Feed, dann steht sein Log hier.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function FindingCard({ step }: { step: StepRecord }) {
  const edits = [
    ...step.applied.map((edit) => `${edit.op}: ${edit.content || edit.target}`),
    ...(step.appliedFiles ?? []).map((edit) => `${edit.path}: ${edit.content || edit.target || ""}`),
  ];
  return (
    <article className={`card ${step.accepted ? "kept" : "dropped"}`}>
      <header>
        <strong>{stepTitle(step)}</strong>
        <span className={step.accepted ? "tag ok" : "tag"}>{step.accepted ? "übernommen" : "verworfen"}</span>
      </header>
      {step.reasoning ? <MarkdownView text={step.reasoning} /> : null}
      <p className="mono">
        {step.selectionAfter
          ? `${pct(step.selectionBefore.gate)} → ${pct(step.selectionAfter.gate)} · ${step.selectionAfter.passes}/${step.selectionAfter.runs} grün`
          : "kein Gate"}
      </p>
      {edits.length > 0 ? (
        <pre>
          <code>{edits.join("\n\n")}</code>
        </pre>
      ) : null}
    </article>
  );
}

function Report({
  summary,
  improved,
  notice,
  onApply,
  onOpen,
}: {
  summary: SessionSummary;
  improved: boolean;
  notice: string | null;
  onApply: () => void;
  onOpen: () => void;
}) {
  const skillDiff = changedLines(summary.originalSkill, summary.bestSkill);
  const files = fileChanges(summary);
  const accepted = summary.steps.filter((step) => step.accepted && step.kind !== "baseline");
  return (
    <article className="card report">
      <header>
        <strong>Bericht</strong>
        <span className={improved ? "tag ok" : "tag"}>{resultTitle(summary, improved)}</span>
      </header>
      <MarkdownView text={reportBody(summary, improved)} />
      <h3>Änderungen</h3>
      {skillDiff ? (
        <pre>
          <code>{`SKILL.md\n${skillDiff}`}</code>
        </pre>
      ) : (
        <p className="quiet">SKILL.md unverändert.</p>
      )}
      {files.map((file) => (
        <pre key={file.path}>
          <code>{`${file.path}\n${file.diff}`}</code>
        </pre>
      ))}
      <h3>Optimierungen</h3>
      {accepted.length === 0 ? <p className="quiet">Keine übernommene Optimierung.</p> : null}
      {accepted.map((step) => (
        <div key={`${step.kind}-${step.index}`} className="opt">
          <strong>{stepTitle(step)}</strong>
          {step.reasoning ? <MarkdownView text={step.reasoning} /> : null}
        </div>
      ))}
      <div className="actions">
        <button type="button" className="primary" disabled={!improved} onClick={onApply}>
          Änderungen übernehmen
        </button>
        <button type="button" onClick={onOpen}>
          Sitzung öffnen
        </button>
      </div>
      {notice ? <p className="quiet">{notice}</p> : null}
    </article>
  );
}

function LiveMark({ run }: { run: LiveRun }) {
  if (isLive(run)) return <span className="spin" aria-hidden="true" />;
  if (run.trajectory && run.trajectory.score.hard < 1) return <span className="dot bad" aria-hidden="true" />;
  if (run.trajectory) return <span className="dot" aria-hidden="true" />;
  return <span className="dot idle" aria-hidden="true" />;
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function isLive(run: LiveRun): boolean {
  return !run.trajectory && !run.settled;
}

function tabLabel(run: LiveRun): string {
  return run.title ?? run.runId;
}

function agentLabel(run: LiveRun): string {
  if (run.title) return run.title;
  const where = run.ground === "empty" ? "leeres Repo" : "Projekt";
  return `${run.runId} · ${phaseName(run.phase)} · ${where}`;
}

function runDuration(run: LiveRun, now: number): string {
  const ms =
    run.trajectory && run.trajectory.score.durationMs > 0
      ? run.trajectory.score.durationMs
      : run.startedAt
        ? Math.max(0, now - run.startedAt)
        : 0;
  if (ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function runState(run: LiveRun): string {
  if (run.trajectory) return scoreLabel(run.trajectory);
  if (run.settled) return "fertig";
  return "läuft";
}

function phaseName(phase: Trajectory["phase"]): string {
  if (phase === "baseline") return "Baseline";
  if (phase === "train") return "Training";
  if (phase === "gate") return "Gate";
  return "Slow";
}

function BlockView({ block }: { block: RunBlock }) {
  if (block.kind === "thinking") {
    return (
      <div className="think">
        <BrainIcon />
        <pre className="body">{block.text}</pre>
      </div>
    );
  }
  if (block.kind === "text") return <MarkdownView text={block.text} />;
  if (block.kind === "tool") {
    const state = block.status === "running" ? "läuft" : block.status === "error" ? "Fehler" : "fertig";
    return (
      <details className="tool">
        <summary>
          <code>{block.name}</code>
          <span>{state}</span>
          {block.detail ? <span className="tool-detail">{block.detail}</span> : null}
        </summary>
        {block.output ? <pre className="body">{block.output}</pre> : null}
      </details>
    );
  }
  return <p className="note">{block.text}</p>;
}

function BrainIcon() {
  return (
    <svg className="brain" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function skillLabel(preview: { name: string; fileCount: number }): string {
  return `${preview.name} · ${preview.fileCount} ${preview.fileCount === 1 ? "Datei" : "Dateien"}`;
}

function modelChoices(models: ModelOption[], selected: string): ModelOption[] {
  if (!selected || models.some((model) => model.id === selected)) return models;
  return [{ id: selected, label: selected }, ...models];
}

function fileChanges(summary: SessionSummary): { path: string; diff: string }[] {
  const left = summary.originalFiles ?? [];
  const right = summary.bestFiles ?? [];
  const paths = [...new Set([...left.map((file) => file.path), ...right.map((file) => file.path)])].sort();
  const changes: { path: string; diff: string }[] = [];
  for (const path of paths) {
    if (path === "SKILL.md") continue;
    const before = left.find((file) => file.path === path);
    const after = right.find((file) => file.path === path);
    if (sameFile(before, after)) continue;
    if (!before?.text && !after?.text && (before?.base64 || after?.base64)) {
      changes.push({ path, diff: "Binärdatei geändert." });
      continue;
    }
    changes.push({ path, diff: changedLines(before?.text ?? "", after?.text ?? "") || "geändert" });
  }
  return changes;
}

function sameFile(left: SkillFile | undefined, right: SkillFile | undefined): boolean {
  return (left?.text ?? "") === (right?.text ?? "") && (left?.base64 ?? "") === (right?.base64 ?? "");
}

function reportBody(summary: SessionSummary, improved: boolean): string {
  const lines = [
    resultTitle(summary, improved),
    "",
    `Start **${pct(summary.baseline.gate)}** (${summary.baseline.passes}/${summary.baseline.runs} grün). Beste Fassung **${pct(summary.best.gate)}** (${summary.best.passes}/${summary.best.runs} grün).`,
  ];
  if (summary.error) lines.push("", summary.error);
  if (summary.cancelled) lines.push("", "Abgebrochen.");
  return lines.join("\n");
}

function phaseLabel(phase: string): string {
  if (phase === "checks") return "Testskript";
  if (phase === "preflight") return "Vorprüfung";
  if (phase === "baseline") return "Baseline";
  if (phase === "slow") return "Slow-Update";
  const [kind, n] = phase.split(":");
  if (kind === "train") return `Training ${n}`;
  if (kind === "optimize") return `Optimierer ${n}`;
  if (kind === "gate") return `Gate ${n}`;
  return phase;
}

function stepTitle(step: StepRecord): string {
  if (step.kind === "baseline") return "Baseline";
  if (step.kind === "slow") return "Slow-Update";
  return `Schritt ${step.index}`;
}

function scoreLabel(run: Trajectory): string {
  if (run.score.status === "cancelled") return "abgebrochen";
  if (run.score.hard >= 1) return `grün · ${run.score.toolCalls} Werkzeuge`;
  return `rot · Exit ${run.score.verifyExitCode ?? "—"}`;
}

function authLabel(auth: AuthStatus | null): string {
  if (!auth) return "…";
  if (auth.message && auth.state !== "logged-in") return auth.message;
  if (auth.state === "logged-in" && auth.via === "env") return "API-Key";
  if (auth.state === "logged-in") return auth.email ?? "angemeldet";
  if (auth.state === "error") return "Fehler";
  return "abgemeldet";
}

function bundleChanged(summary: SessionSummary): boolean {
  if (summary.bestSkill.trim() !== summary.originalSkill.trim()) return true;
  const left = summary.originalFiles ?? [];
  const right = summary.bestFiles ?? [];
  if (left.length !== right.length) return true;
  return right.some((file) => {
    const other = left.find((item) => item.path === file.path);
    return !other || other.text !== file.text || other.base64 !== file.base64;
  });
}

function resultTitle(summary: SessionSummary, improved: boolean): string {
  if (summary.error && !improved) return "Abgebrochen, Skill unverändert";
  if (improved) return "Bessere Fassung";
  return "Keine Verbesserung";
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
