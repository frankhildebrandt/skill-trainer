import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import {
  BrainIcon,
  BrandMark,
  CheckIcon,
  ExternalIcon,
  FileIcon,
  FolderIcon,
  PlayIcon,
  PulseIcon,
  SparkIcon,
  StopIcon,
  TerminalIcon,
} from "./icons";
import { MarkdownView } from "./MarkdownView";
import { ResizeHandle, usePaneSizes } from "./ResizeHandle";

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
  const layoutRef = useRef<HTMLDivElement>(null);
  const panes = usePaneSizes(layoutRef);

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
  const liveCount = runs.filter((run) => isLive(run)).length;
  const loggedIn = auth?.state === "logged-in";

  return (
    <div className={running ? "app is-running" : "app"}>
      <Backdrop />

      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <h1>Skill Trainer</h1>
        </div>
        <div className="status" aria-live="polite">
          {running ? (
            <span className="status-pill live">
              <span className="pulse" aria-hidden="true" />
              {phase}
              {liveCount > 0 ? <span className="status-count">{liveCount} aktiv</span> : null}
            </span>
          ) : summary ? (
            <span className={improved ? "status-pill good" : "status-pill"}>{resultTitle(summary, improved)}</span>
          ) : null}
        </div>
        <div className="auth">
          <span className={loggedIn ? "pill ok" : auth?.state === "error" ? "pill bad" : "pill"} title={authLabel(auth)}>
            <span className="pill-dot" aria-hidden="true" />
            {authLabel(auth)}
          </span>
          <button type="button" className="ghost" onClick={() => void login()} disabled={running}>
            Anmelden
          </button>
        </div>
        {running ? <div className="beam" aria-hidden="true" /> : null}
      </header>

      <div
        className="layout"
        ref={layoutRef}
        style={{ gridTemplateColumns: `${panes.sizes.panel}px 1px ${panes.sizes.feed}px 1px minmax(0, 1fr)` }}
      >
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <div className="panel-scroll">
            <Group title="Quelle">
              <label>
                Skill
                <div className="row">
                  <input readOnly value={form.skillPath} title={form.skillPath} placeholder="Ordner oder SKILL.md" />
                  <button type="button" onClick={() => void chooseSkill()} disabled={running}>
                    <FileIcon />
                    Wählen
                  </button>
                </div>
                {skillName ? (
                  <small className="chip">
                    <CheckIcon />
                    {skillName}
                  </small>
                ) : null}
              </label>

              <label>
                Projekt
                <div className="row">
                  <input readOnly value={form.workspacePath} title={form.workspacePath} placeholder="Projektordner" />
                  <button type="button" onClick={() => void chooseFolder()} disabled={running}>
                    <FolderIcon />
                    Wählen
                  </button>
                </div>
              </label>
            </Group>

            <Group title="Aufgabe">
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

              <Segmented
                legend="Ziel"
                name="skillScope"
                disabled={running}
                value={form.skillScope === "specific" ? "specific" : "general"}
                options={[
                  { value: "general", label: "Allgemein" },
                  { value: "specific", label: "Dieser Auftrag" },
                ]}
                onChange={(skillScope) => setForm({ ...form, skillScope })}
              />
            </Group>

            <Group title="Prüfung">
              <Segmented
                legend="Prüfung"
                hideLegend
                name="verifyMode"
                disabled={running}
                value={form.verifyMode}
                options={[
                  { value: "command", label: "Testbefehl" },
                  { value: "agent", label: "Agent schreibt das Testskript" },
                ]}
                onChange={(verifyMode) => setForm({ ...form, verifyMode })}
              />

              {form.verifyMode === "command" ? (
                <label className="reveal">
                  Testbefehl
                  <input
                    className="mono-input"
                    value={form.verifyCommand}
                    onChange={(event) => setForm({ ...form, verifyCommand: event.target.value })}
                    placeholder="npm test"
                    disabled={running}
                  />
                </label>
              ) : null}
            </Group>

            <Group title="Modelle">
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
            </Group>

            <Group title="Budget">
              <div className="grid nums">
                <NumberField label="Schritte" value={form.steps} min={1} max={6} disabled={running} onChange={(steps) => setForm({ ...form, steps })} />
                <NumberField label="Training" value={form.trainBatch} min={1} max={6} disabled={running} onChange={(trainBatch) => setForm({ ...form, trainBatch })} />
                <NumberField label="Gate" value={form.selectionRepeats} min={1} max={4} disabled={running} onChange={(selectionRepeats) => setForm({ ...form, selectionRepeats })} />
                <NumberField label="Parallel" value={form.concurrency} min={1} max={6} disabled={running} onChange={(concurrency) => setForm({ ...form, concurrency })} />
                <NumberField label="Lernrate" value={form.learningRate} min={1} max={6} disabled={running} onChange={(learningRate) => setForm({ ...form, learningRate })} />
              </div>
            </Group>

            <Group title="Optionen">
              <Toggle
                label="Gate auf leerem Repository"
                hint="Baseline und Gate laufen in einem leeren Repo mit nur dem Skill."
                checked={form.gateOnEmptyRepo}
                disabled={running}
                onChange={(gateOnEmptyRepo) => setForm({ ...form, gateOnEmptyRepo })}
              />
              <Toggle
                label="Slow-Update"
                hint="Am Ende eine kurze dauerhafte Notiz, nur nach Gate."
                checked={form.slowUpdate}
                disabled={running}
                onChange={(slowUpdate) => setForm({ ...form, slowUpdate })}
              />
            </Group>
          </div>

          <div className="panel-foot">
            <p className="estimate">
              <strong>{runCount}</strong> Läufe · <strong>{estimate.optimizer}</strong> Optimierer
            </p>
            <div className="actions">
              <button type="submit" className={running ? "primary busy" : "primary"} disabled={running}>
                {running ? <span className="spin" aria-hidden="true" /> : <PlayIcon />}
                <span className="label">{running ? phase : "Start"}</span>
              </button>
              <button type="button" className="danger" onClick={() => void api.cancel()} disabled={!running}>
                <StopIcon />
                Abbrechen
              </button>
            </div>
          </div>
        </form>

        <ResizeHandle
          label="Breite der Einstellungen"
          value={panes.sizes.panel}
          min={panes.limits.panel.min}
          max={panes.limits.panel.max}
          initial={panes.limits.panel.initial}
          onChange={panes.setPanel}
        />

        <section className="feed">
          <div className="pane-head">
            <PulseIcon />
            <span>Verlauf</span>
            {runs.length > 0 ? <span className="count">{runs.length} Läufe</span> : null}
          </div>
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
              {feed.length === 0 ? (
                <Empty icon={<SparkIcon />} title="Noch kein Lauf.">
                  Skill, Projekt und Auftrag setzen, dann starten. Phasen, Agenten und Befunde erscheinen hier.
                </Empty>
              ) : null}
              {feed.map((item) => {
                if (item.type === "note") {
                  return (
                    <div key={item.id} className="msg enter">
                      <MarkdownView text={item.text} />
                    </div>
                  );
                }
                if (item.type === "agent") {
                  const run = runs.find((entry) => entry.runId === item.runId);
                  if (!run) return null;
                  const classes = ["agent-link", "enter", isLive(run) ? "live" : "", run.runId === active ? "on" : ""];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={classes.filter(Boolean).join(" ")}
                      onClick={() => openAgent(run.runId)}
                    >
                      <LiveMark run={run} />
                      <span className="agent-name">{agentLabel(run)}</span>
                      <span className="agent-time">{runDuration(run, now)}</span>
                      <span className={`agent-state ${stateTone(run)}`}>{runState(run)}</span>
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

        <ResizeHandle
          label="Breite des Verlaufs"
          value={panes.sizes.feed}
          min={panes.limits.feed.min}
          max={panes.limits.feed.max}
          initial={panes.limits.feed.initial}
          onChange={panes.setFeed}
        />

        <section className="logs">
          <div className="tabs" role="tablist">
            {tabs.length === 0 ? (
              <span className="tab-hint">
                <TerminalIcon />
                Agenten
              </span>
            ) : null}
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
            <div className="column switch" key={activeRun?.runId ?? "none"}>
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
                    <p className="quiet waiting">Wartet auf die erste Ausgabe.</p>
                  )}
                  {activeRun.trajectory?.keptWorkspace ? (
                    <button
                      type="button"
                      className="align-start"
                      onClick={() => void api.openPath(activeRun.trajectory!.keptWorkspace!)}
                    >
                      <ExternalIcon />
                      Kopie öffnen
                    </button>
                  ) : null}
                </>
              ) : (
                <Empty icon={<TerminalIcon />} title="Kein Agent geöffnet.">
                  Klicke einen Lauf im Feed, dann steht sein Log hier.
                </Empty>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="grid-lines" />
      <div className="grain" />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="group">
      <h2 className="group-title">{title}</h2>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  legend,
  hideLegend = false,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  hideLegend?: boolean;
  name: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className={hideLegend ? "sr-only" : undefined}>{legend}</legend>
      <div
        className="seg"
        style={{ "--seg-count": options.length, "--seg-index": index } as CSSProperties}
      >
        <span className="seg-thumb" aria-hidden="true" />
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        {label}
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty enter">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function FindingCard({ step }: { step: StepRecord }) {
  const edits = [
    ...step.applied.map((edit) => `${edit.op}: ${edit.content || edit.target}`),
    ...(step.appliedFiles ?? []).map((edit) => `${edit.path}: ${edit.content || edit.target || ""}`),
  ];
  return (
    <article className={`card enter ${step.accepted ? "kept" : "dropped"}`}>
      <header>
        <strong>{stepTitle(step)}</strong>
        <span className={step.accepted ? "tag ok" : "tag"}>{step.accepted ? "übernommen" : "verworfen"}</span>
      </header>
      {step.reasoning ? <MarkdownView text={step.reasoning} /> : null}
      {step.selectionAfter ? (
        <div className="score">
          <ScoreBar before={step.selectionBefore.gate} after={step.selectionAfter.gate} />
          <p className="mono">
            {`${pct(step.selectionBefore.gate)} → ${pct(step.selectionAfter.gate)} · ${step.selectionAfter.passes}/${step.selectionAfter.runs} grün`}
          </p>
        </div>
      ) : (
        <p className="mono">kein Gate</p>
      )}
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
    <article className={improved ? "card report enter improved" : "card report enter"}>
      <header>
        <strong>
          <SparkIcon />
          Bericht
        </strong>
        <span className={improved ? "tag ok" : "tag"}>{resultTitle(summary, improved)}</span>
      </header>
      <MarkdownView text={reportBody(summary, improved)} />
      <ScoreBar before={summary.baseline.gate} after={summary.best.gate} />
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
          <CheckIcon />
          Änderungen übernehmen
        </button>
        <button type="button" onClick={onOpen}>
          <ExternalIcon />
          Sitzung öffnen
        </button>
      </div>
      {notice ? <p className="quiet notice enter">{notice}</p> : null}
    </article>
  );
}

function ScoreBar({ before, after }: { before: number; after: number }) {
  const tone = after > before ? "up" : after < before ? "down" : "flat";
  return (
    <div className={`scorebar ${tone}`} aria-hidden="true">
      <span className="scorebar-before" style={{ width: `${clampPct(before)}%` }} />
      <span className="scorebar-after" style={{ width: `${clampPct(after)}%` }} />
    </div>
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
  const id = useId();
  return (
    <div className="num">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button
          type="button"
          aria-label={`${label} verringern`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <input
          id={id}
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
        <button
          type="button"
          aria-label={`${label} erhöhen`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
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

function stateTone(run: LiveRun): string {
  if (!run.trajectory) return run.settled ? "" : "live";
  if (run.trajectory.score.status === "cancelled") return "";
  return run.trajectory.score.hard >= 1 ? "good" : "bad";
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

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value * 100));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
