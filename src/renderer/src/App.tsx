import { PROVIDERS, restoreProvider, type ProviderKind } from "@shared/provider";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LANGUAGE_NAMES, SUPPORTED_LOCALES, type Locale, type Translate } from "@shared/i18n";
import { useI18n } from "./i18n";
import { estimateRuns } from "@shared/estimate";
import { skillPathForWorkspace } from "@shared/project-skill";
import { applyRunUpdate, type RunBlock } from "@shared/run-log";
import { changedLines } from "@shared/text-diff";
import type {
  AuthStatus,
  LocalizedLabel,
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
  label?: LocalizedLabel;
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

type BuiltinProvider = "cursor" | "codex";
const NO_MODELS: ModelOption[] = [];

function isBuiltinProvider(kind: ProviderKind): kind is BuiltinProvider {
  return kind === "cursor" || kind === "codex";
}

type ProviderCatalogs = Record<BuiltinProvider, { models: ModelOption[]; error?: string }>;

function newTrainingTab(ordinal: number, form: TrainRequest): TrainingTab {
  return { id: crypto.randomUUID(), ordinal, initialForm: structuredClone(form) };
}

const EMPTY: TrainRequest = {
  provider: { kind: "cursor" },
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
  const { locale, setLocale, t, saveError } = useI18n();
  const api = window.trainer;
  const [loggingInFor, setLoggingInFor] = useState<BuiltinProvider | null>(null);
  const [authByProvider, setAuthByProvider] = useState<Record<BuiltinProvider, AuthStatus | null>>({ cursor: null, codex: null });
  const [catalogs, setCatalogs] = useState<ProviderCatalogs>({ cursor: { models: [{ id: "composer-2.5", label: "Composer 2.5" }] }, codex: { models: [] } });
  const [tabs, setTabs] = useState<TrainingTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, TabSnapshot>>({});
  const ordinals = useRef(0);
  const providerGenerations = useRef<Record<BuiltinProvider, number>>({ cursor: 0, codex: 0 });

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    for (const provider of ["cursor", "codex"] as const) {
      const generation = ++providerGenerations.current[provider];
      const current = () => !cancelled && generation === providerGenerations.current[provider];
      void api.authStatus({ kind: provider }).then((status) => {
        if (current()) setAuthByProvider((prev) => ({ ...prev, [provider]: status }));
      }).catch((error: unknown) => {
        if (current()) setAuthByProvider((prev) => ({ ...prev, [provider]: { state: "error", email: null, via: "none", message: messageOf(error) } }));
      });
      void api.listModels({ kind: provider }).then((result) => {
        if (current()) setCatalogs((prev) => ({ ...prev, [provider]: result }));
      }).catch((error: unknown) => {
        if (current()) setCatalogs((prev) => ({ ...prev, [provider]: { models: [], error: messageOf(error) } }));
      });
    }
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
    return <main className="fallback">{t("app.fallback")}</main>;
  }

  const runningCount = Object.values(snapshots).filter((snapshot) => snapshot.running).length;
  const activeForm = (activeId && snapshots[activeId]?.form) || tabs.find((tab) => tab.id === activeId)?.initialForm;
  const provider = restoreProvider(activeForm?.provider);
  const builtinProvider = isBuiltinProvider(provider.kind) ? provider.kind : null;
  const providerLabel = PROVIDERS[provider.kind].label;
  const auth = builtinProvider ? authByProvider[builtinProvider] : null;
  const loggingIn = loggingInFor !== null && loggingInFor === builtinProvider;
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
    if (!builtinProvider) return;
    const selected = builtinProvider;
    const generation = ++providerGenerations.current[selected];
    setLoggingInFor(selected);
    try {
      const next = await api.authLogin({ kind: selected });
      if (generation !== providerGenerations.current[selected]) return;
      setAuthByProvider((prev) => ({ ...prev, [selected]: next }));
      const listed = await api.listModels({ kind: selected });
      if (generation === providerGenerations.current[selected]) setCatalogs((prev) => ({ ...prev, [selected]: listed }));
    } catch (err) {
      if (generation === providerGenerations.current[selected]) setAuthByProvider((prev) => ({ ...prev, [selected]: { state: "error", email: null, via: "none", message: messageOf(err) } }));
    } finally {
      setLoggingInFor(null);
    }
  }

  return (
    <div className={runningCount > 0 ? "app is-running" : "app"}>
      <Backdrop />
      {saveError ? (
        <div className="locale-save-error" role="alert">
          <span>{t("app.localeSaveError")}</span>
          <button type="button" onClick={() => setLocale(locale)}>{t("app.retry")}</button>
        </div>
      ) : null}
      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <h1>Skill Trainer</h1>
        </div>
        <div className="global-tabs" role="tablist" aria-label={t("app.trainings")}>
          {tabs.map((tab) => {
            const snapshot = snapshots[tab.id];
            const selected = tab.id === activeId;
            const tone = snapshot?.tone ?? "idle";
            const label = snapshot?.label ?? t("app.trainingNumber", { n: tab.ordinal });
            const status = snapshot?.status ?? t("app.ready");
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
                <button type="button" className="global-tab-x" aria-label={t("app.closeLabel", { label })} title={t("app.close")} onClick={() => closeTab(tab.id)}>
                  <CloseIcon />
                </button>
              </div>
            );
          })}
          <div className="global-tabs-end">
            <button type="button" className="global-tab-add" onClick={addTab} aria-label={t("app.addTraining")} title={t("app.addTraining")}>
              <PlusIcon />
              <span className="global-tab-add-label">{t("app.training")}</span>
            </button>
          </div>
        </div>
        <div className="titlebar-end">
          <select
            className="language-select"
            aria-label={t("app.language")}
            title={t("app.language")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((language) => (
              <option key={language} value={language} lang={language}>{LANGUAGE_NAMES[language]}</option>
            ))}
          </select>
          <div className="status" aria-live="polite">
            {runningCount > 0 ? (
              <span className="status-pill live">
                <span className="pulse" aria-hidden="true" />
                <span className="status-pill-num">{runningCount}</span>
                {t(runningCount === 1 ? "app.oneTrainingRunning" : "app.trainingsRunning")}
              </span>
            ) : null}
          </div>
          <div className="auth">
            <span className={loggedIn ? "pill ok" : auth?.state === "error" ? "pill bad" : "pill"} title={builtinProvider ? `${providerLabel} · ${loggingIn ? t("app.browserOpen") : authLabel(auth, t)}` : providerLabel}>
              <span className="pill-dot" aria-hidden="true" />
              {providerLabel}{builtinProvider ? ` · ${loggingIn ? t("app.browserOpen") : authLabel(auth, t)}` : ""}
            </span>
            {builtinProvider ? <button type="button" className="ghost" onClick={() => void login()} disabled={runningCount > 0 || loggingInFor !== null} title={providerLabel}>
              {t("app.login")}
            </button> : null}
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
          catalogs={catalogs}
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
  catalogs,
  onSnapshot,
}: {
  sessionId: string;
  ordinal: number;
  initialForm: TrainRequest;
  active: boolean;
  catalogs: ProviderCatalogs;
  onSnapshot: (snapshot: TabSnapshot) => void;
}) {
  const { locale, t } = useI18n();
  const api = window.trainer;
  const [form, setForm] = useState<TrainRequest>(initialForm);
  const provider = restoreProvider(form.provider);
  const builtinProvider = isBuiltinProvider(provider.kind) ? provider.kind : null;
  const catalog = builtinProvider ? catalogs[builtinProvider] : undefined;
  const models = catalog?.models ?? NO_MODELS;
  const [skillInfo, setSkillInfo] = useState<{ name: string; fileCount: number } | null>(null);
  const skillName = skillInfo ? skillLabel(skillInfo, t) : null;
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([]);
  const [skillsNote, setSkillsNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [phase, setPhase] = useState("ready");
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | { skillPath: string; backupPath: string | null } | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const seenAgents = useRef(new Set<string>());
  const feedStick = useRef(true);
  const agentStick = useRef(true);
  const starting = useRef(false);
  const deriveGen = useRef(0);
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

  function changeProvider(next: ProviderKind) {
    deriveGen.current += 1;
    const model = isBuiltinProvider(next) ? catalogs[next].models[0]?.id ?? "" : "";
    setForm((prev) => ({ ...prev, provider: restoreProvider({ kind: next }), targetModel: model, optimizerModel: model }));
  }

  useEffect(() => {
    const model = models[0]?.id;
    if (!model || running || deriving) return;
    setForm((prev) => {
      if (restoreProvider(prev.provider).kind !== provider.kind || (prev.targetModel && prev.optimizerModel)) return prev;
      return { ...prev, targetModel: prev.targetModel || model, optimizerModel: prev.optimizerModel || model };
    });
  }, [models, provider.kind, running, deriving]);

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
      setSkillInfo(null);
      return;
    }
    let cancelled = false;
    void api.readSkill(skillPath).then((preview) => {
      if (!cancelled) setSkillInfo(preview);
    }).catch(() => {
      if (!cancelled) setSkillInfo(null);
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
      setSkillsNote(skills.length === 0 ? t("app.noSkills") : null);
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
  }, [api, form.workspacePath, t]);

  useEffect(() => {
    if (!api) return;
    return api.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.type === "log") pushFeed({ type: "note", text: event.message });
      if (event.type === "phase") setPhase(event.phase);
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
                label: event.label,
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
                  label: event.label ?? run.label,
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

  const tabLabelText = trainingLabel(form, ordinal, skillName, t);
  const liveCount = runs.filter((run) => isLive(run)).length;
  const tabState = trainingStatus(running, phase, summary, liveCount, locale, t);
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
      setSkillsNote(skills.length === 0 ? t("app.noSkills") : null);
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
      pushFeed({ type: "note", text: t("app.chooseProject") });
      return;
    }
    try {
      const prompt = await api.pickCursorRun(form.workspacePath);
      if (prompt) setForm((prev) => ({ ...prev, auftrag: prompt }));
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
    }
  }

  async function deriveFields() {
    const skillPath = form.skillPath.trim();
    const fineTune = form.workflow === "train" || form.trainAfterDraft !== false;
    const model = (fineTune ? form.targetModel : form.optimizerModel).trim();
    if (!skillPath || form.workflow === "create") {
      pushFeed({ type: "note", text: t("runner.chooseSkill") });
      return;
    }
    if (!model) {
      pushFeed({ type: "note", text: t("runner.noModel") });
      return;
    }
    const generation = ++deriveGen.current;
    setDeriving(true);
    const label = models.find((item) => item.id === model)?.label ?? model;
    pushFeed({ type: "note", text: t("runner.readingSkill", { model: label }) });
    try {
      const fields = await api.deriveSkillFields(skillPath, model, provider);
      if (generation !== deriveGen.current) return;
      setForm((prev) => ({ ...prev, skillBrief: fields.ziel, auftrag: fields.auftrag }));
      pushFeed({ type: "note", text: t("runner.fieldsFilled") });
    } catch (err) {
      if (generation !== deriveGen.current) return;
      pushFeed({ type: "note", text: messageOf(err) });
    } finally {
      if (generation === deriveGen.current) setDeriving(false);
    }
  }

  async function start() {
    if (starting.current || deriving) return;
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
    setPhase("starting");
    try {
      await api.start(form, sessionId);
    } catch (err) {
      pushFeed({ type: "note", text: messageOf(err) });
      setPhase("ready");
    } finally {
      starting.current = false;
      setRunning(false);
    }
  }

  async function writeBack() {
    setNotice(null);
    try {
      const result = await api.writeBack(sessionId);
      setNotice(result);
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
              modelError={catalog?.error}
              skillName={skillName}
              projectSkills={projectSkills}
              skillsNote={skillsNote}
              onChange={setForm}
              onProviderChange={changeProvider}
              onChooseSkill={() => void chooseSkill()}
              onChooseDestination={() => void chooseDestination()}
              onChooseFolder={() => void chooseFolder()}
              onPickRun={() => void pickRun()}
              onDerive={() => void deriveFields()}
              deriving={deriving}
            />
          </div>
          <div className="panel-foot">
            <p className="estimate">
              {t("app.estimate", { total: estimate.total, attempts: estimate.attempts, optimizer: estimate.optimizer })}
              {estimate.checks ? ` · ${t("app.checkEstimate", { count: estimate.checks })}` : ""}
            </p>
            {form.runBudget !== null && estimate.total > (form.runBudget ?? 48) ? (
              <p className="budget-error" role="status">{t("app.budgetExceeded")}</p>
            ) : null}
            <div className="actions">
              <button type="submit" className={running ? "primary busy" : "primary"} disabled={running || deriving}>
                {running ? <span className="spin" aria-hidden="true" /> : <PlayIcon />}
                <span className="label">{running ? phaseLabel(phase, t) : t("app.start")}</span>
              </button>
              <button type="button" className="danger" onClick={() => void api.cancel(sessionId)} disabled={!running}>
                <StopIcon />
                {t("app.cancel")}
              </button>
            </div>
          </div>
        </form>

        <ResizeHandle
          label={t("app.settingsWidth")}
          value={panes.sizes.panel}
          min={panes.limits.panel.min}
          max={panes.limits.panel.max}
          initial={panes.limits.panel.initial}
          onChange={panes.setPanel}
        />

        <section className="feed">
          <div className="pane-head">
            <PulseIcon />
            <span>{t("app.history")}</span>
            {runs.length > 0 ? <span className="count">{t("app.runCount", { count: runs.length })}</span> : null}
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
                <Empty icon={<SparkIcon />} title={t("app.noRun")}>
                  {t("app.noRunHelp")}
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
                      <span className="agent-name">{agentLabel(run, t)}</span>
                      <span className="agent-time">{runDuration(run, now)}</span>
                      <span className={`agent-state ${stateTone(run)}`}>{runState(run, t)}</span>
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
                    notice={typeof notice === "string" || !notice ? notice : `${t("app.applied", { path: notice.skillPath })}${notice.backupPath ? ` ${t("app.backup", { path: notice.backupPath })}` : ""}`}
                    onApply={() => void writeBack()}
                    onOpen={() => void api.openPath(summary.sessionDir)}
                  />
                ) : null;
              })}
            </div>
          </div>
        </section>

        <ResizeHandle
          label={t("app.historyWidth")}
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
                {t("app.agents")}
              </span>
            ) : null}
            {tabs.map((tab) => {
              const run = runs.find((item) => item.runId === tab);
              const live = run ? isLive(run) : false;
              return (
                <div key={tab} className={tab === openRun ? "tab on" : "tab"}>
                  <button type="button" role="tab" aria-selected={tab === openRun} onClick={() => setOpenRun(tab)}>
                    {live ? <span className="spin" aria-hidden="true" /> : null}
                    {run ? tabLabel(run, t) : tab}
                  </button>
                  <button type="button" className="tab-x" aria-label={t("app.closeTab")} onClick={() => closeTab(tab)}>
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
                      <strong>{agentLabel(activeRun, t)}</strong>
                      <p>
                        {runState(activeRun, t)}
                        {runDuration(activeRun, now) ? ` · ${runDuration(activeRun, now)}` : ""}
                      </p>
                    </div>
                  </div>
                  {activeRun.blocks.length > 0 ? (
                    <div className="stream">
                      <StreamBlocks blocks={activeRun.blocks} />
                    </div>
                  ) : (
                    <p className="quiet waiting">{t("app.waiting")}</p>
                  )}
                  {activeRun.trajectory?.keptWorkspace ? (
                    <button
                      type="button"
                      className="align-start"
                      onClick={() => void api.openPath(activeRun.trajectory!.keptWorkspace!)}
                    >
                      <ExternalIcon />
                      {t("app.openCopy")}
                    </button>
                  ) : null}
                </>
              ) : (
                <Empty icon={<TerminalIcon />} title={t("app.noAgent")}>
                  {t("app.noAgentHelp")}
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
  const { locale, t } = useI18n();
  const edits = [
    ...step.applied.map((edit) => `${edit.op}: ${edit.content || edit.target}`),
    ...(step.appliedFiles ?? []).map((edit) => `${edit.op} ${edit.path}: ${edit.content || edit.target || ""}`),
  ];
  return (
    <article className={`card enter ${step.accepted ? "kept" : "dropped"}`}>
      <header>
        <strong>{stepTitle(step, t)}</strong>
        <span className={step.accepted ? "tag ok" : "tag"}>{t(step.accepted ? "app.accepted" : "app.rejected")}</span>
      </header>
      {step.reasoning ? <MarkdownView text={step.reasoning} /> : null}
      {step.selectionAfter ? (
        <div className="score">
          <ScoreBar before={step.selectionBefore.gate} after={step.selectionAfter.gate} />
          <p className="mono">
            {`${pct(step.selectionBefore.gate, locale)} → ${pct(step.selectionAfter.gate, locale)} · ${t("app.passed", { passes: step.selectionAfter.passes, runs: step.selectionAfter.runs })}`}
          </p>
        </div>
      ) : (
        <p className="mono">{t("app.noGate")}</p>
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
  const { locale, t } = useI18n();
  const skillDiff = changedLines(summary.originalSkill, summary.bestSkill);
  const files = fileChanges(summary, t);
  const accepted = summary.steps.filter((step) => step.accepted && step.kind !== "baseline");
  return (
    <article className={improved ? "card report enter improved" : "card report enter"}>
      <header>
        <strong>
          <SparkIcon />
          {t("app.report")}
        </strong>
        <span className={measuredImprovement(summary) ? "tag ok" : "tag"}>{resultTitle(summary, locale)}</span>
      </header>
      <MarkdownView text={reportBody(summary, locale)} />
      {summary.best.runs > 0 ? <ScoreBar before={summary.baseline.gate} after={summary.best.gate} /> : null}
      <h3>{t("app.changes")}</h3>
      {skillDiff ? (
        <pre>
          <code>{`SKILL.md\n${skillDiff}`}</code>
        </pre>
      ) : (
        <p className="quiet">{t("app.unchanged")}</p>
      )}
      {files.map((file) => (
        <pre key={file.path}>
          <code>{`${file.path}\n${file.diff}`}</code>
        </pre>
      ))}
      <h3>{t("app.optimizations")}</h3>
      {accepted.length === 0 ? <p className="quiet">{t("app.noOptimization")}</p> : null}
      {accepted.map((step) => (
        <div key={`${step.kind}-${step.index}`} className="opt">
          <strong>{stepTitle(step, t)}</strong>
          {step.reasoning ? <MarkdownView text={step.reasoning} /> : null}
        </div>
      ))}
      <div className="actions">
        <button type="button" className="primary" disabled={!improved} onClick={onApply}>
          <CheckIcon />
          {t("app.applyChanges")}
        </button>
        <button type="button" onClick={onOpen}>
          <ExternalIcon />
          {t("app.openSession")}
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

function tabLabel(run: LiveRun, t: Translate): string {
  return run.label ? t(run.label.key, run.label.values) : run.title ?? run.runId;
}

function agentLabel(run: LiveRun, t: Translate): string {
  if (run.label) return t(run.label.key, run.label.values);
  if (run.title) return run.title;
  const where = t(run.ground === "empty" ? "app.emptyRepo" : "app.project");
  return `${run.runId} · ${phaseName(run.phase, t)} · ${where}`;
}

function stateTone(run: LiveRun): string {
  if (!run.trajectory) return run.settled ? "" : "live";
  if (run.trajectory.score.status === "cancelled") return "";
  return run.trajectory.score.hard >= 1 ? "good" : "bad";
}

function runState(run: LiveRun, t: Translate): string {
  if (run.trajectory) return scoreLabel(run.trajectory, t);
  if (run.settled) return t("app.finished");
  return t("app.running");
}

function phaseName(phase: Trajectory["phase"], t: Translate): string {
  if (phase === "baseline") return t("app.baseline");
  if (phase === "train") return t("app.training");
  if (phase === "gate") return t("app.gate");
  return t("app.slow");
}

function StreamBlocks({ blocks }: { blocks: RunBlock[] }) {
  const { t } = useI18n();
  const joined = blocks.filter((block) => block.kind === "text").map((block) => block.text).join("");
  const proposal = readProposal(joined);
  const started = !proposal && proposalStarted(joined);
  let textShown = false;
  return blocks.map((block, index) => {
    if (block.kind !== "text") return <BlockView key={index} block={block} />;
    if (textShown) return null;
    textShown = true;
    if (proposal) return <ProposalView key="proposal" proposal={proposal} />;
    if (started) return <p key="draft" className="note">{t("app.writingProposal")}</p>;
    return <BlockView key={index} block={block} />;
  });
}

function BlockView({ block }: { block: RunBlock }) {
  const { t } = useI18n();
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
    if (proposalStarted(block.text)) return <p className="note">{t("app.writingProposal")}</p>;
    return <MarkdownView text={block.text} />;
  }
  if (block.kind === "tool") {
    const state = t(block.status === "running" ? "app.running" : block.status === "error" ? "app.error" : "app.finished");
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
  const { t } = useI18n();
  return (
    <article className="proposal-card">
      <header>{t("app.proposalSummary", { files: t(proposal.files.length === 1 ? "app.oneFile" : "app.files", { count: proposal.files.length }), edits: proposal.edits.length })}</header>
      {proposal.reasoning ? (
        <section>
          <h3>{t("app.reasoning")}</h3>
          <MarkdownView text={proposal.reasoning} />
        </section>
      ) : null}
      {proposal.slow ? (
        <section>
          <h3>{t("app.slow")}</h3>
          <MarkdownView text={proposal.slow} />
        </section>
      ) : null}
      {proposal.files.map((file, index) => (
        <FileView key={`${file.path}-${index}`} file={file} />
      ))}
      {proposal.edits.map((edit, index) => (
        <section className="edit" key={`${edit.op}-${index}`}>
          <h3>{t("app.editInSkill", { operation: opLabel(edit.op, t) })}</h3>
          {edit.why ? <p className="why">{edit.why}</p> : null}
          {edit.target ? <pre className="body">{edit.target}</pre> : null}
          {edit.content ? <pre className="body">{edit.content}</pre> : null}
        </section>
      ))}
    </article>
  );
}

function FileView({ file }: { file: ShownFile }) {
  const { t } = useI18n();
  const frontmatter = file.path.endsWith(".md") ? file.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/) : null;
  const body = frontmatter ? file.content.slice(frontmatter[0].length) : file.content;
  return (
    <section className="file">
      <header>
        <code>{opLabel(file.op, t)}</code>
        <span className="path">{file.path}</span>
        {file.executable ? <span>{t("app.executable")}</span> : null}
      </header>
      {file.why ? <p className="why">{file.why}</p> : null}
      {file.op === "delete" ? <p className="why">{t("app.fileDeleted")}</p> : null}
      {frontmatter?.[1] ? <pre className="body">{frontmatter[1]}</pre> : null}
      {body ? (file.path.endsWith(".md") ? <MarkdownView text={body} /> : <pre className="body">{body}</pre>) : null}
    </section>
  );
}

function opLabel(op: string, t: Translate): string {
  if (op === "write") return t("app.write");
  if (op === "replace") return t("app.replace");
  if (op === "delete") return t("app.delete");
  if (op === "append") return t("app.append");
  if (op === "insert_after") return t("app.insert");
  return op;
}

function skillLabel(preview: { name: string; fileCount: number }, t: Translate): string {
  return `${preview.name} · ${t(preview.fileCount === 1 ? "app.oneFile" : "app.files", { count: preview.fileCount })}`;
}

function fileChanges(summary: SessionSummary, t: Translate): { path: string; diff: string }[] {
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
      changes.push({ path, diff: t("app.binaryChanged") });
      continue;
    }
    const mode = Boolean(before?.executable) !== Boolean(after?.executable)
      ? `\n${t("app.executableMode", { value: t(after?.executable ? "app.yes" : "app.no") })}`
      : "";
    changes.push({ path, diff: `${changedLines(before?.text ?? "", after?.text ?? "") || t("app.changed")}${mode}` });
  }
  return changes;
}

function sameFile(left: SkillFile | undefined, right: SkillFile | undefined): boolean {
  return (left?.text ?? "") === (right?.text ?? "") && (left?.base64 ?? "") === (right?.base64 ?? "") && Boolean(left?.executable) === Boolean(right?.executable);
}

function trainingLabel(form: TrainRequest, ordinal: number, skillName: string | null, t: Translate): string {
  const created = form.skillName?.trim();
  if (form.workflow === "create" && created) return created;
  if (skillName) return skillName.split(" · ")[0] || skillName;
  const skill = form.skillPath.trim().split(/[/\\]/).filter(Boolean).pop();
  if (skill) return skill;
  return t("app.trainingNumber", { n: ordinal });
}

function trainingStatus(
  running: boolean,
  phase: string,
  summary: SessionSummary | null,
  liveCount: number,
  locale: Locale,
  t: Translate,
): { status: string; tone: "idle" | "live" | "good" | "bad" } {
  if (running) {
    const count = liveCount > 0 ? ` · ${t("app.activeCount", { count: liveCount })}` : "";
    return { status: `${phaseLabel(phase, t)}${count}`, tone: "live" };
  }
  if (!summary) return { status: t("app.ready"), tone: "idle" };
  if (summary.cancelled) return { status: t("app.cancelled"), tone: "bad" };
  if (summary.error) return { status: t("app.error"), tone: "bad" };
  if (measuredImprovement(summary) || bundleChanged(summary)) return { status: resultTitle(summary, locale), tone: "good" };
  return { status: resultTitle(summary, locale), tone: "idle" };
}

function phaseLabel(phase: string, t: Translate): string {
  if (phase === "ready") return t("app.ready");
  if (phase === "starting") return t("app.starting");
  if (phase === "create") return t("app.createSkill");
  if (phase === "pretrain") return t("app.pretrain");
  if (phase === "checks") return t("app.testScript");
  if (phase === "preflight") return t("app.preflight");
  if (phase === "baseline") return t("app.baseline");
  if (phase === "slow") return t("app.slow");
  const [kind, n] = phase.split(":");
  if (kind === "train") return t("app.trainingNumber", { n: n ?? "" });
  if (kind === "optimize") return t("app.optimizerNumber", { n: n ?? "" });
  if (kind === "gate") return t("app.gateNumber", { n: n ?? "" });
  return phase;
}

function stepTitle(step: StepRecord, t: Translate): string {
  if (step.kind === "baseline") return t("app.baseline");
  if (step.kind === "slow") return t("app.slow");
  return t("app.step", { n: step.index });
}

function scoreLabel(run: Trajectory, t: Translate): string {
  if (run.score.status === "cancelled") return t("app.cancelled");
  if (run.score.hard >= 1) return t("app.greenTools", { count: run.score.toolCalls });
  return t("app.redExit", { code: run.score.verifyExitCode ?? "—" });
}

function authLabel(auth: AuthStatus | null, t: Translate): string {
  if (!auth) return "…";
  if (auth.message && auth.state !== "logged-in") return auth.message;
  if (auth.state === "logged-in" && auth.via === "env") return t("app.apiKey");
  if (auth.state === "logged-in") return auth.email ?? t("app.signedIn");
  if (auth.state === "error") return t("app.error");
  return t("app.signedOut");
}

function pct(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100);
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value * 100));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
