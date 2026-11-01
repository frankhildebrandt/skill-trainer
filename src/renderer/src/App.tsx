import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { estimateRuns } from "@shared/estimate";
import { skillPathForWorkspace } from "@shared/project-skill";
import { applyRunUpdate, type RunBlock } from "@shared/run-log";
import { changedLines } from "@shared/text-diff";
import type {
  AuthStatus,
  ModelOption,
  ProjectSkill,
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
  CloseIcon,
  ExternalIcon,
  PlayIcon,
  PlusIcon,
  PulseIcon,
  SparkIcon,
  StopIcon,
  TerminalIcon,
} from "./icons";
import { MarkdownView } from "./MarkdownView";
import { proposalStarted, readProposal, type ShownFile, type ShownProposal } from "./markdown";
import { TrainerForm } from "./TrainerForm";
import { bundleChanged, measuredImprovement, reportBody, resultTitle } from "./report";
import { ResizeHandle, usePaneSizes } from "./ResizeHandle";
import { runDuration } from "./run-clock";

interface LiveRun {
  runId: string;
  phase: Trajectory["phase"];
  ground: Trajectory["ground"];
  taskPrompt: string;
  title?: string;
  blocks: RunBlock[];
  startedAt?: number;
  endedAt?: number;
  settled?: boolean;
  trajectory?: Trajectory;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type FeedItem =
  | { id: number; type: "note"; text: string }
  | { id: number; type: "agent"; runId: string }
  | { id: number; type: "finding"; index: number }
  | { id: number; type: "report" };

interface TabSnapshot {
  id: string;
  label: string;
  status: string;
  tone: "idle" | "live" | "good" | "bad";
  running: boolean;
  form: TrainRequest;
}

interface TrainingTab {
  id: string;
  ordinal: number;
  initialForm: TrainRequest;
}

function newTrainingTab(ordinal: number, form: TrainRequest): TrainingTab {
  return { id: crypto.randomUUID(), ordinal, initialForm: structuredClone(form) };
}

const EMPTY: TrainRequest = {
  workflow: "train",
  skillName: "",
  skillBrief: "",
  trainAfterDraft: true,
  runBudget: 48,
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
  const [tabs, setTabs] = useState<TrainingTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, TabSnapshot>>({});
  const ordinals = useRef(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api.authStatus().then((status) => {
      if (!cancelled) setAuth(status);
    }).catch(() => undefined);
    void api.listModels().then((result) => {
      if (!cancelled && result.models.length > 0) setModels(result.models);
    });
    void api.loadSettings().then((saved) => {
      if (cancelled) return;
      const tab = newTrainingTab(++ordinals.current, saved ?? EMPTY);
      setTabs([tab]);
      setActiveId(tab.id);
    }).catch(() => {
      if (cancelled) return;
      const tab = newTrainingTab(++ordinals.current, EMPTY);
      setTabs([tab]);
      setActiveId(tab.id);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!api) {
    return <main className="fallback">Skill Trainer läuft nur in der Electron-App.</main>;
  }

  const runningCount = Object.values(snapshots).filter((snapshot) => snapshot.running).length;
  const loggedIn = auth?.state === "logged-in";

  function rememberSnapshot(snapshot: TabSnapshot) {
    setSnapshots((prev) => {
      const current = prev[snapshot.id];
      if (
        current
        && current.label === snapshot.label
        && current.status === snapshot.status
        && current.tone === snapshot.tone
        && current.running === snapshot.running
        && current.form === snapshot.form
      ) return prev;
      return { ...prev, [snapshot.id]: snapshot };
    });
  }

  function addTab() {
    const source = (activeId && snapshots[activeId]?.form) || tabs.find((tab) => tab.id === activeId)?.initialForm || EMPTY;
    const tab = newTrainingTab(++ordinals.current, source);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    if (snapshots[id]?.running) void api.cancel(id);
    setSnapshots((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      const remaining = prev.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const form = snapshots[id]?.form ?? prev[index]?.initialForm ?? EMPTY;
        const tab = newTrainingTab(++ordinals.current, form);
        setActiveId(tab.id);
        return [tab];
      }
      if (activeId === id) {
        const neighbor = remaining[Math.max(0, index - 1)] ?? remaining[0];
        setActiveId(neighbor?.id ?? null);
      }
      return remaining;
    });
  }

  async function login() {
    setAuth({ state: "logged-out", email: null, via: "none", message: "Browser ist offen …" });
    try {
      const next = await api.authLogin();
      setAuth(next);
      const listed = await api.listModels();
      if (listed.models.length > 0) setModels(listed.models);
    } catch (err) {
      setAuth({ state: "error", email: null, via: "none", message: messageOf(err) });
    }
  }

  return (
    <div className={runningCount > 0 ? "app is-running" : "app"}>
      <Backdrop />
      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <h1>Skill Trainer</h1>
        </div>
        <div className="global-tabs" role="tablist" aria-label="Trainings">
          {tabs.map((tab) => {
            const snapshot = snapshots[tab.id];
            const selected = tab.id === activeId;
            const tone = snapshot?.tone ?? "idle";
            const label = snapshot?.label ?? `Training ${tab.ordinal}`;
            const status = snapshot?.status ?? "bereit";
            return (
              <div key={tab.id} className={`global-tab ${tone}${selected ? " on" : ""}`}>
                <button
                  type="button"
                  className="global-tab-main"
                  role="tab"
                  aria-selected={selected}
                  title={`${label} · ${status}`}
                  onClick={() => setActiveId(tab.id)}
                >
                  <span className="global-tab-mark" aria-hidden="true" />
                  <span className="global-tab-copy">
                    <span className="global-tab-label">{label}</span>
                    <span className="global-tab-status">{status}</span>
                  </span>
                </button>
                <button type="button" className="global-tab-x" aria-label={`${label} schließen`} title="Schließen" onClick={() => closeTab(tab.id)}>
                  <CloseIcon />
                </button>
              </div>
            );
          })}
          <div className="global-tabs-end">
            <button type="button" className="global-tab-add" onClick={addTab} aria-label="+ Training" title="Training hinzufügen">
              <PlusIcon />
              <span className="global-tab-add-label">Training</span>
            </button>
          </div>
        </div>
        <div className="titlebar-end">
          <div className="status" aria-live="polite">
            {runningCount > 0 ? (
              <span className="status-pill live">
                <span className="pulse" aria-hidden="true" />
                <span className="status-pill-num">{runningCount}</span>
                {runningCount === 1 ? "Training läuft" : "Trainings laufen"}
              </span>
            ) : null}
          </div>
          <div className="auth">
            <span className={loggedIn ? "pill ok" : auth?.state === "error" ? "pill bad" : "pill"} title={authLabel(auth)}>
              <span className="pill-dot" aria-hidden="true" />
              {authLabel(auth)}
            </span>
            <button type="button" className="ghost" onClick={() => void login()} disabled={runningCount > 0}>
              Anmelden
            </button>
          </div>
        </div>
        {runningCount > 0 ? <div className="beam" aria-hidden="true" /> : null}
      </header>
      {tabs.map((tab) => (
        <TrainingSession
          key={tab.id}
          sessionId={tab.id}
          ordinal={tab.ordinal}
          initialForm={tab.initialForm}
          active={tab.id === activeId}
          models={models}
          onSnapshot={rememberSnapshot}
        />
      ))}
    </div>
  );
}

function TrainingSession({
  sessionId,
  ordinal,
  initialForm,
  active,
  models,
  onSnapshot,
}: {
  sessionId: string;
  ordinal: number;
  initialForm: TrainRequest;
  active: boolean;
  models: ModelOption[];
  onSnapshot: (snapshot: TabSnapshot) => void;
}) {
  const api = window.trainer;
  const [form, setForm] = useState<TrainRequest>(initialForm);
  const [skillName, setSkillName] = useState<string | null>(null);
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([]);
  const [skillsNote, setSkillsNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("bereit");
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const seenAgents = useRef(new Set<string>());
  const feedStick = useRef(true);
  const agentStick = useRef(true);
  const starting = useRef(false);
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
    if (!api || !active) return;
    const timer = setTimeout(() => {
      void api.saveSettings(form);
    }, 250);
    return () => clearTimeout(timer);
  }, [api, form, active]);

  useEffect(() => {
    if (!api) return;
    const skillPath = form.skillPath.trim();
    if (!skillPath || form.workflow === "create") {
      setSkillName(null);
      return;
    }
    let cancelled = false;
    void api.readSkill(skillPath).then((preview) => {
      if (!cancelled) setSkillName(skillLabel(preview));
    }).catch(() => {
      if (!cancelled) setSkillName(null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, form.skillPath, form.workflow]);

  useEffect(() => {
    if (!api) return;
    const workspace = form.workspacePath.trim();
    if (!workspace) {
      setProjectSkills([]);
      setSkillsNote(null);
      return;
    }
    let cancelled = false;
    void api.listProjectSkills(workspace).then((skills) => {
      if (cancelled) return;
      setProjectSkills(skills);
      setSkillsNote(skills.length === 0 ? "Keine SKILL.md in diesem Projekt." : null);
      setForm((prev) => {
        if (prev.workflow === "create" || prev.workspacePath.trim() !== workspace || prev.skillPath.trim() || skills.length !== 1) return prev;
        return { ...prev, skillPath: skills[0]?.root ?? prev.skillPath };
      });
    }).catch((err: unknown) => {
      if (cancelled) return;
      setProjectSkills([]);
      setSkillsNote(messageOf(err));
    });
    return () => {
      cancelled = true;
    };
  }, [api, form.workspacePath]);

  useEffect(() => {
    if (!api) return;
    return api.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
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
            const startedAt = Date.now();
            return [
              ...prev,
              {
                runId: event.runId,
                phase: "train",
                ground: "repo",
                taskPrompt: event.title ?? event.runId,
                title: event.title,
                blocks: event.update ? applyRunUpdate([], event.update) : [],
                startedAt,
                endedAt: event.settled ? startedAt : undefined,
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
                  endedAt: run.endedAt ?? (event.settled ? Date.now() : undefined),
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
  }, [api, sessionId]);

  const anyLive = runs.some((run) => isLive(run));
  useEffect(() => {
    if (!anyLive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyLive]);

  const tabLabelText = trainingLabel(form, ordinal, skillName);
  const liveCount = runs.filter((run) => isLive(run)).length;
  const tabState = trainingStatus(running, phase, summary, liveCount);
  const snapshotRef = useRef(onSnapshot);
  snapshotRef.current = onSnapshot;
  useEffect(() => {
    snapshotRef.current({
      id: sessionId,
      label: tabLabelText,
      status: tabState.status,
      tone: tabState.tone,
      running,
      form,
    });
  }, [sessionId, tabLabelText, tabState.status, tabState.tone, running, form]);

  const hasDraft = form.workflow === "create" || form.workflow === "pretrain";
  const fineTune = !hasDraft || form.trainAfterDraft !== false;
  const estimate = useMemo(() => {
    const train = fineTune ? estimateRuns(form) : { attempts: 0, optimizer: 0 };
    const checks = fineTune && form.verifyMode === "agent" ? 1 : 0;
    const optimizer = train.optimizer + (hasDraft ? 1 : 0);
    return { attempts: train.attempts, checks, optimizer, total: train.attempts + checks + optimizer };
  }, [fineTune, hasDraft, form.steps, form.trainBatch, form.selectionRepeats, form.slowUpdate, form.verifyMode]);

  if (!api) return null;

  async function chooseSkill() {
    const picked = await api.pickSkill();
    if (picked) setForm((prev) => ({ ...prev, skillPath: picked }));
  }

  async function chooseDestination() {
    const picked = await api.pickSkillDestination();
    if (picked) setForm((prev) => ({ ...prev, skillPath: picked }));
  }

  async function chooseFolder() {
    const picked = await api.pickFolder();
    if (!picked) return;
    try {
      const skills = await api.listProjectSkills(picked);
      setProjectSkills(skills);
      setSkillsNote(skills.length === 0 ? "Keine SKILL.md in diesem Projekt." : null);
      setForm((prev) => ({
        ...prev,
        workspacePath: picked,
        skillPath: prev.workflow === "create" ? prev.skillPath : skillPathForWorkspace(prev.skillPath, prev.workspacePath, skills),
      }));
    } catch (err) {
      setProjectSkills([]);
      setSkillsNote(messageOf(err));
      setForm((prev) => ({ ...prev, workspacePath: picked }));
    }
  }

  async function pickRun() {
    if (!form.workspacePath.trim()) {
      pushFeed({ type: "note", text: "Zuerst einen Projektordner wählen." });
      return;
    }
    try {
      const prompt = await api.pickCursorRun(form.workspacePath);
      if (prompt) setForm((prev) => ({ ...prev, auftrag: prompt }));
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
    }
  }

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setRunning(true);
    setNotice(null);
    setSummary(null);
    setSteps([]);
    setRuns([]);
    setFeed([]);
    setTabs([]);
    setOpenRun(null);
    seq.current = 0;
    seenAgents.current = new Set();
    setPhase("startet");
    try {
      await api.start(form, sessionId);
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
      setPhase("bereit");
    } finally {
      starting.current = false;
      setRunning(false);
    }
  }

  async function writeBack() {
    setNotice(null);
    try {
      const result = await api.writeBack(sessionId);
      setNotice(`Übernommen nach ${result.skillPath}.${result.backupPath ? ` Backup: ${result.backupPath}` : ""}`);
    } catch (err) {
      setNotice(messageOf(err));
    }
  }

  function openAgent(runId: string) {
    setTabs((prev) => (prev.includes(runId) ? prev : [...prev, runId]));
    setOpenRun(runId);
    agentStick.current = true;
  }

  function closeTab(runId: string) {
    const next = tabs.filter((tab) => tab !== runId);
    setTabs(next);
    if (openRun === runId) {
      const index = Math.max(0, tabs.indexOf(runId) - 1);
      setOpenRun(next[index] ?? null);
    }
  }

  const improved = summary ? bundleChanged(summary) : false;
  const activeRun = runs.find((run) => run.runId === openRun);

  return (
    <div className="workspace" hidden={!active}>
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
            <TrainerForm
              form={form}
              running={running}
              models={models}
              skillName={skillName}
              projectSkills={projectSkills}
              skillsNote={skillsNote}
              onChange={setForm}
              onChooseSkill={() => void chooseSkill()}
              onChooseDestination={() => void chooseDestination()}
              onChooseFolder={() => void chooseFolder()}
              onPickRun={() => void pickRun()}
            />
          </div>
          <div className="panel-foot">
            <p className="estimate">
              Bis zu <strong>{estimate.total}</strong> Agent-Läufe · {estimate.attempts} Training/Gate · {estimate.optimizer} Optimierer
              {estimate.checks ? ` · ${estimate.checks} Testskript` : ""}
            </p>
            {form.runBudget !== null && estimate.total > (form.runBudget ?? 48) ? (
              <p className="budget-error" role="status">Laufbudget überschritten. Budget erhöhen oder Schritte und Wiederholungen senken.</p>
            ) : null}
            <div className="actions">
              <button type="submit" className={running ? "primary busy" : "primary"} disabled={running}>
                {running ? <span className="spin" aria-hidden="true" /> : <PlayIcon />}
                <span className="label">{running ? phase : "Start"}</span>
              </button>
              <button type="button" className="danger" onClick={() => void api.cancel(sessionId)} disabled={!running}>
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
                  Projekt wählen, den Skill daraus nehmen und den Auftrag setzen. Phasen, Agenten und Befunde erscheinen hier.
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
                  const classes = ["agent-link", "enter", isLive(run) ? "live" : "", run.runId === openRun ? "on" : ""];
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
                <div key={tab} className={tab === openRun ? "tab on" : "tab"}>
                  <button type="button" role="tab" aria-selected={tab === openRun} onClick={() => setOpenRun(tab)}>
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
                      <StreamBlocks blocks={activeRun.blocks} />
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
    ...(step.appliedFiles ?? []).map((edit) => `${edit.op} ${edit.path}: ${edit.content || edit.target || ""}`),
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
        <span className={measuredImprovement(summary) ? "tag ok" : "tag"}>{resultTitle(summary)}</span>
      </header>
      <MarkdownView text={reportBody(summary)} />
      {summary.best.runs > 0 ? <ScoreBar before={summary.baseline.gate} after={summary.best.gate} /> : null}
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
      {accepted.length === 0 ? <p className="quiet">Keine zusätzliche Optimierung durch das Gate übernommen.</p> : null}
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

function StreamBlocks({ blocks }: { blocks: RunBlock[] }) {
  const joined = blocks.filter((block) => block.kind === "text").map((block) => block.text).join("");
  const proposal = readProposal(joined);
  const started = !proposal && proposalStarted(joined);
  let textShown = false;
  return blocks.map((block, index) => {
    if (block.kind !== "text") return <BlockView key={index} block={block} />;
    if (textShown) return null;
    textShown = true;
    if (proposal) return <ProposalView key="proposal" proposal={proposal} />;
    if (started) return <p key="draft" className="note">Vorschlag wird geschrieben…</p>;
    return <BlockView key={index} block={block} />;
  });
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
  if (block.kind === "text") {
    const proposal = readProposal(block.text);
    if (proposal) return <ProposalView proposal={proposal} />;
    if (proposalStarted(block.text)) return <p className="note">Vorschlag wird geschrieben…</p>;
    return <MarkdownView text={block.text} />;
  }
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

function ProposalView({ proposal }: { proposal: ShownProposal }) {
  return (
    <article className="proposal-card">
      <header>Vorschlag · {proposal.files.length} {proposal.files.length === 1 ? "Datei" : "Dateien"} · {proposal.edits.length} Textänderungen</header>
      {proposal.reasoning ? (
        <section>
          <h3>Begründung</h3>
          <MarkdownView text={proposal.reasoning} />
        </section>
      ) : null}
      {proposal.slow ? (
        <section>
          <h3>Slow-Update</h3>
          <MarkdownView text={proposal.slow} />
        </section>
      ) : null}
      {proposal.files.map((file, index) => (
        <FileView key={`${file.path}-${index}`} file={file} />
      ))}
      {proposal.edits.map((edit, index) => (
        <section className="edit" key={`${edit.op}-${index}`}>
          <h3>{opLabel(edit.op)} in SKILL.md</h3>
          {edit.why ? <p className="why">{edit.why}</p> : null}
          {edit.target ? <pre className="body">{edit.target}</pre> : null}
          {edit.content ? <pre className="body">{edit.content}</pre> : null}
        </section>
      ))}
    </article>
  );
}

function FileView({ file }: { file: ShownFile }) {
  const frontmatter = file.path.endsWith(".md") ? file.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/) : null;
  const body = frontmatter ? file.content.slice(frontmatter[0].length) : file.content;
  return (
    <section className="file">
      <header>
        <code>{opLabel(file.op)}</code>
        <span className="path">{file.path}</span>
        {file.executable ? <span>ausführbar</span> : null}
      </header>
      {file.why ? <p className="why">{file.why}</p> : null}
      {file.op === "delete" ? <p className="why">Datei wird gelöscht.</p> : null}
      {frontmatter?.[1] ? <pre className="body">{frontmatter[1]}</pre> : null}
      {body ? (file.path.endsWith(".md") ? <MarkdownView text={body} /> : <pre className="body">{body}</pre>) : null}
    </section>
  );
}

function opLabel(op: string): string {
  if (op === "write") return "schreiben";
  if (op === "replace") return "ersetzen";
  if (op === "delete") return "löschen";
  if (op === "append") return "anhängen";
  if (op === "insert_after") return "einfügen";
  return op;
}

function skillLabel(preview: { name: string; fileCount: number }): string {
  return `${preview.name} · ${preview.fileCount} ${preview.fileCount === 1 ? "Datei" : "Dateien"}`;
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
    const mode = Boolean(before?.executable) !== Boolean(after?.executable)
      ? `\nAusführbar: ${after?.executable ? "ja" : "nein"}`
      : "";
    changes.push({ path, diff: `${changedLines(before?.text ?? "", after?.text ?? "") || "geändert"}${mode}` });
  }
  return changes;
}

function sameFile(left: SkillFile | undefined, right: SkillFile | undefined): boolean {
  return (left?.text ?? "") === (right?.text ?? "") && (left?.base64 ?? "") === (right?.base64 ?? "") && Boolean(left?.executable) === Boolean(right?.executable);
}

function trainingLabel(form: TrainRequest, ordinal: number, skillName: string | null): string {
  const created = form.skillName?.trim();
  if (form.workflow === "create" && created) return created;
  if (skillName) return skillName.split(" · ")[0] || skillName;
  const skill = form.skillPath.trim().split(/[/\\]/).filter(Boolean).pop();
  if (skill) return skill;
  return `Training ${ordinal}`;
}

function trainingStatus(
  running: boolean,
  phase: string,
  summary: SessionSummary | null,
  liveCount: number,
): { status: string; tone: "idle" | "live" | "good" | "bad" } {
  if (running) {
    const count = liveCount > 0 ? ` · ${liveCount} aktiv` : "";
    return { status: `${phase}${count}`, tone: "live" };
  }
  if (!summary) return { status: "bereit", tone: "idle" };
  if (summary.cancelled) return { status: "abgebrochen", tone: "bad" };
  if (summary.error) return { status: "Fehler", tone: "bad" };
  if (measuredImprovement(summary) || bundleChanged(summary)) return { status: resultTitle(summary), tone: "good" };
  return { status: resultTitle(summary), tone: "idle" };
}

function phaseLabel(phase: string): string {
  if (phase === "create") return "Skill erstellen";
  if (phase === "pretrain") return "Vortraining";
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

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}`;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value * 100));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
