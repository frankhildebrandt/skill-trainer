import path from "node:path";
import fs from "node:fs/promises";
import { efficiencySoft, gateScore } from "../shared/score";
import type { ActivityUpdate } from "../shared/run-log";
import type { RunScore, SkillFile, Trajectory } from "../shared/types";
import type { CheckFile } from "./checks";
import { plantChecks } from "./checks";
import { createEmptyRepo, isolateWorkspace, pinChecks } from "./isolate";
import { buildTargetPrompt } from "./prompts";
import { rootedFs } from "./rooted-fs";
import { isAbortError } from "./pool";
import { writeSkillTree } from "./skill-bundle";
import { skillSlug } from "./skill-file";
import { runVerify } from "./verify";

export interface AgentTrace {
  status: RunScore["status"];
  finalText: string;
  toolCalls: number;
  transcript: string;
  durationMs: number;
  error?: string;
}

export interface ExecuteRequest {
  cwd: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  timeoutMs: number;
  settingSources?: Array<"project">;
  /** When set, file tools see only this tree and shell is unavailable. */
  fs?: ReturnType<typeof rootedFs>;
  onActivity?: (update: ActivityUpdate) => void;
}

export interface AttemptRequest {
  runId: string;
  phase: Trajectory["phase"];
  ground: Trajectory["ground"];
  workspacePath: string;
  runDir: string;
  skill: string;
  files: SkillFile[];
  skillRoot: string;
  skillPath: string;
  taskPrompt: string;
  model: string;
  verifyCommand: string;
  checks?: CheckFile[];
  verifyTimeoutMs: number;
  attemptTimeoutMs: number;
  signal: AbortSignal;
  onActivity?: (update: ActivityUpdate) => void;
  execute: (input: ExecuteRequest) => Promise<AgentTrace>;
}

export async function performAttempt(input: AttemptRequest): Promise<Trajectory> {
  const snapshot = path.join(input.runDir, "workspace");
  const iso =
    input.ground === "empty" ? await createEmptyRepo(snapshot) : await isolateWorkspace(input.workspacePath, snapshot);
  const timed = linkTimeout(input.signal, input.attemptTimeoutMs);
  let keep = false;
  try {
    const placed = await placeSkill(iso.dir, input.files, input.workspacePath, input.skillRoot || input.skillPath);
    if (input.checks?.length) {
      await plantChecks(iso.dir, input.checks);
      await pinChecks(iso);
    }
    const trace = await input.execute({
      cwd: iso.dir,
      model: input.model,
      prompt: buildTargetPrompt({
        skill: input.skill,
        task: input.taskPrompt,
        verifyCommand: input.verifyCommand,
        skillFile: placed.file,
        skillDir: placed.dir,
        emptyRepo: input.ground === "empty",
        authoredChecks: Boolean(input.checks?.length),
      }),
      signal: timed.signal,
      timeoutMs: input.attemptTimeoutMs,
      onActivity: input.onActivity,
      settingSources: input.ground === "empty" ? [] : ["project"],
      fs: input.ground === "empty" ? rootedFs(iso.dir) : undefined,
    });
    const diff = await iso.diff();
    if (input.checks?.length) await plantChecks(iso.dir, input.checks);
    const verify =
      trace.status === "cancelled"
        ? { exitCode: null, output: "Lauf abgebrochen, Prüfbefehl nicht gestartet." }
        : await runVerify(input.verifyCommand, iso.dir, input.verifyTimeoutMs, input.signal);
    const score = scoreRun(trace, verify.exitCode, verify.output);
    keep = score.hard < 1 && trace.status !== "cancelled";
    return {
      runId: input.runId,
      phase: input.phase,
      ground: input.ground,
      taskPrompt: input.taskPrompt,
      score,
      summary: buildSummary(trace, verify.output, diff.stat, diff.patch),
      diffStat: diff.stat,
      keptWorkspace: keep ? iso.dir : null,
      error: trace.error,
    };
  } catch (err) {
    if (isAbortError(err) || input.signal.aborted) {
      const error = new Error("Abgebrochen");
      error.name = "AbortError";
      throw error;
    }
    keep = true;
    throw err;
  } finally {
    timed.clear();
    if (!keep) await iso.cleanup().catch(() => undefined);
  }
}

export async function placeSkill(
  dest: string,
  files: SkillFile[],
  workspace: string,
  skillRoot: string,
): Promise<{ dir: string; file: string }> {
  const document = files.find((file) => file.path === "SKILL.md")?.text ?? "";
  const slug = skillSlug(document);
  const relativeRoot = path.relative(workspace, skillRoot);
  const inside = relativeRoot.length > 0 && !relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot);
  const primary = inside ? path.join(dest, relativeRoot) : path.join(dest, ".cursor", "skills", slug);
  const mirror = path.join(dest, ".cursor", "skills", slug);
  for (const root of new Set([primary, mirror])) {
    await assertSkillDestination(dest, root);
    await fs.rm(root, { recursive: true, force: true });
    await writeSkillTree(root, files);
  }
  return {
    dir: path.relative(dest, primary),
    file: path.relative(dest, path.join(primary, "SKILL.md")),
  };
}

async function assertSkillDestination(workspace: string, destination: string): Promise<void> {
  const relative = path.relative(workspace, destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Der Skill muss innerhalb der Laufkopie liegen.");
  }
  let current = workspace;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("Der Skill-Pfad in der Laufkopie darf keine symbolischen Links enthalten.");
  }
}

function scoreRun(
  trace: AgentTrace,
  verifyExitCode: number | null,
  verifyOutput: string,
): RunScore {
  const passed = trace.status !== "cancelled" && verifyExitCode === 0;
  const hard = passed ? 1 : 0;
  const soft = efficiencySoft(trace.toolCalls, passed);
  return {
    hard,
    soft,
    gate: gateScore(hard, soft),
    verifyExitCode,
    verifyOutput: verifyOutput.slice(-4000),
    toolCalls: trace.toolCalls,
    durationMs: trace.durationMs,
    status: trace.status,
  };
}

function buildSummary(trace: AgentTrace, verifyOutput: string, stat: string, patch: string): string {
  return [
    "Verify output:",
    clip(verifyOutput, 2500),
    "Agent:",
    clip(trace.finalText, 1500),
    trace.error ? `Agent error: ${trace.error}` : "",
    "Trace:",
    clip(trace.transcript, 4000),
    "Diff stat:",
    clip(stat, 1500),
    "Diff:",
    clip(patch, 2500),
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

function linkTimeout(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const child = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error("Zeitlimit");
    error.name = "AbortError";
    child.abort(error);
  }, timeoutMs);
  const onParent = () => child.abort(parent.reason);
  if (parent.aborted) child.abort(parent.reason);
  else parent.addEventListener("abort", onParent, { once: true });
  return {
    signal: child.signal,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}
