import type { TranslationKey, TranslationValues } from "./i18n";
import type { Locale } from "./i18n/types";
import type { CursorRunCatalog } from "./cursor-runs";
import type { ActivityUpdate } from "./run-log";

export interface AggregateScore {
  gate: number;
  hard: number;
  soft: number;
  runs: number;
  passes: number;
}

export interface RunScore {
  hard: number;
  soft: number;
  gate: number;
  verifyExitCode: number | null;
  verifyOutput: string;
  toolCalls: number;
  durationMs: number;
  status: "finished" | "error" | "cancelled";
}

export type EditOp = "append" | "insert_after" | "replace" | "delete";

export interface SkillEdit {
  op: EditOp;
  /** Replacement or inserted text. Empty for delete. */
  content: string;
  /** Exact snippet already in the skill. Empty for append. */
  target: string;
  why?: string;
}

export interface SkippedEdit {
  edit: SkillEdit;
  reason: string;
}

/** One file inside a skill directory. Binary files are copied and not edited. */
export interface SkillFile {
  path: string;
  text?: string;
  base64?: string;
  executable?: boolean;
}

export interface FileEdit {
  op: "write" | "replace" | "delete";
  path: string;
  content: string;
  target?: string;
  why?: string;
  executable?: boolean;
}

export type AttemptGround = "repo" | "empty";

export interface Trajectory {
  runId: string;
  phase: "baseline" | "train" | "gate" | "slow";
  /** Training uses the project. The gate can use a fresh empty repository. */
  ground: AttemptGround;
  taskPrompt: string;
  score: RunScore;
  summary: string;
  diffStat: string;
  keptWorkspace: string | null;
  error?: string;
}

export interface StepRecord {
  index: number;
  kind: "baseline" | "step" | "slow";
  reasoning: string;
  applied: SkillEdit[];
  appliedFiles?: FileEdit[];
  skipped: SkippedEdit[];
  selectionBefore: AggregateScore;
  selectionAfter: AggregateScore | null;
  accepted: boolean;
  /** Skill that remains current after this step. */
  skill: string;
}

export interface Rejection {
  edits: SkillEdit[];
  before: AggregateScore;
  after: AggregateScore;
  reasoning: string;
  fileEdits?: FileEdit[];
  /** Held-out runs that rejected this candidate. Empty-repo failures live here. */
  gateRuns: Trajectory[];
}

export interface SessionSummary {
  workflow?: SkillWorkflow;
  draft?: SkillDraft;
  fineTuned?: boolean;
  originalSkill: string;
  bestSkill: string;
  originalFiles?: SkillFile[];
  bestFiles?: SkillFile[];
  baseline: AggregateScore;
  best: AggregateScore;
  steps: StepRecord[];
  rejected: Rejection[];
  cancelled: boolean;
  error?: string;
  sessionDir: string;
}

export type VerifyMode = "command" | "agent";

/** `general`: reusable procedure. `specific`: this assignment may be written into the skill. */
export type SkillScope = "general" | "specific";

export type SkillWorkflow = "train" | "pretrain" | "create";

export type InferenceProvider = "cursor" | "codex";

export interface OptimizerBudget {
  unlimited: boolean;
  maxEditChars: number;
  maxAddedChars: number;
  maxFileEdits: number;
  maxFileChars: number;
}

export interface SkillDraft {
  kind: "pretrain" | "create";
  reasoning: string;
  skill: string;
  files: SkillFile[];
}

export interface TrainRequest {
  /** Older sessions use Cursor when no provider is recorded. */
  provider?: InferenceProvider;
  workflow?: SkillWorkflow;
  skillName?: string;
  skillBrief?: string;
  trainAfterDraft?: boolean;
  budget?: OptimizerBudget;
  /** null disables the run-count cap; finite sessions still use steps and batches. */
  runBudget?: number | null;
  skillPath: string;
  workspacePath: string;
  auftrag: string;
  extraTasks: string;
  /** `command`: the user supplies the shell command. `agent`: the target model writes a check script first. */
  verifyMode: VerifyMode;
  verifyCommand: string;
  targetModel: string;
  optimizerModel: string;
  steps: number;
  trainBatch: number;
  selectionRepeats: number;
  concurrency: number;
  learningRate: number;
  slowUpdate: boolean;
  /** Train in the project folder. Score baseline and gate in a fresh empty git repo. */
  gateOnEmptyRepo: boolean;
  /** Whether the optimizer should keep the skill reusable or fit it to this assignment. */
  skillScope?: SkillScope;
  attemptTimeoutMin: number;
  verifyTimeoutSec: number;
}

export interface AuthStatus {
  state: "logged-in" | "logged-out" | "error";
  email: string | null;
  via: "env" | "login" | "none";
  message?: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProjectSkill {
  root: string;
  relative: string;
  name: string;
}

export interface LocalizedLabel {
  key: TranslationKey;
  values?: TranslationValues;
}

export type TrainerEvent =
  | { type: "log"; message: string }
  | { type: "phase"; phase: string }
  | { type: "run_started"; run: { runId: string; phase: Trajectory["phase"]; ground: AttemptGround; taskPrompt: string } }
  | { type: "run_activity"; runId: string; update?: ActivityUpdate; title?: string; label?: LocalizedLabel; settled?: boolean }
  | { type: "run_finished"; run: Trajectory }
  | { type: "step"; step: StepRecord }
  | { type: "done"; summary: SessionSummary }
  | { type: "error"; message: string };

/** A trainer event tagged for one global training tab. */
export type SessionEvent = TrainerEvent & { sessionId: string };

export interface TrainerApi {
  loadLocale: () => Promise<Locale>;
  saveLocale: (locale: Locale) => Promise<void>;
  onLocaleChange: (cb: (locale: Locale) => void) => () => void;
  authStatus: (provider?: InferenceProvider) => Promise<AuthStatus>;
  authLogin: (provider?: InferenceProvider) => Promise<AuthStatus>;
  listModels: (provider?: InferenceProvider) => Promise<{ models: ModelOption[]; error?: string }>;
  pickSkill: () => Promise<string | null>;
  pickSkillDestination: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;
  listProjectSkills: (workspacePath: string) => Promise<ProjectSkill[]>;
  deriveSkillFields: (skillPath: string, model: string, provider?: InferenceProvider) => Promise<{ ziel: string; auftrag: string }>;
  readSkill: (skillPath: string) => Promise<{
    name: string;
    chars: number;
    preview: string;
    root: string;
    fileCount: number;
    files: string[];
  }>;
  loadSettings: () => Promise<TrainRequest | null>;
  saveSettings: (request: TrainRequest) => Promise<void>;
  start: (request: TrainRequest, sessionId: string) => Promise<{ sessionDir: string; sessionId: string }>;
  cancel: (sessionId: string) => Promise<void>;
  writeBack: (sessionId: string) => Promise<{ backupPath: string | null; skillPath: string }>;
  openPath: (target: string) => Promise<void>;
  pickCursorRun: (workspacePath: string) => Promise<string | null>;
  listCursorRuns: (scope?: "local" | "cloud") => Promise<CursorRunCatalog>;
  chooseCursorRun: (prompt: string) => Promise<void>;
  cancelCursorRun: () => Promise<void>;
  onEvent: (cb: (event: SessionEvent) => void) => () => void;
}
