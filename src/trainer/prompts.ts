import type { FileEdit, OptimizerBudget, Rejection, SkillEdit, SkillFile, Trajectory } from "../shared/types";
import { DEFAULT_BUDGET } from "../shared/budget";

export function buildTargetPrompt(input: {
  skill: string;
  task: string;
  verifyCommand: string;
  skillFile: string;
  skillDir?: string;
  emptyRepo?: boolean;
  authoredChecks?: boolean;
}): string {
  const setting = input.emptyRepo
    ? `This repository is empty except for the skill${input.authoredChecks ? " and the grading script under .skill-trainer/checks" : ""}. The original project is not available. You cannot read it, and you have no shell. Create and edit files in this repository only. The harness runs the verify command after you stop.`
    : `You are working in a copy of an existing project.`;
  const owned = input.authoredChecks
    ? `The harness restores \`.skill-trainer/checks\` immediately before grading. Editing or deleting that directory does not change the score.\n\n`
    : "";
  return `You are doing one task in this repository. A harness grades the working tree after you stop by running the verify command itself. Your own claim of success is not the score.

${setting}

${owned}Follow the skill document as the procedure. When it already states a command, API, file path, flag, or pitfall, use that instead of searching, guessing, or rereading the tree. If the skill and another project instruction disagree about this task, follow the skill.

The skill directory is on disk at \`${input.skillDir ?? input.skillFile}\`. Follow \`SKILL.md\` there, and use the scripts and extra documents in that directory instead of rediscovering them.

<verify>
${input.verifyCommand}
</verify>

<skill>
${input.skill}
</skill>

<task>
${input.task}
</task>
`;
}

export function buildCheckAuthorPrompt(input: { auftrag: string; emptyGate: boolean }): string {
  const gate = input.emptyGate
    ? `Later grading runs in a new empty git repository. The script must be runnable there, with no files from this project except the skill. It must fail while the module or add-on is absent. Do not import this project as a library, and do not assume its packages, venv, or node_modules exist in that empty repo.`
    : `Later grading runs in a fresh copy of this project, before the task is done. The script must fail on that copy and exit 0 only after the task is actually complete.`;
  return `You write the grading script for a later agent. You do not implement the task.

Read this project only to learn how a finished result can be checked. Then write a check that fails today and exits 0 only when the task below is done.

Rules:
- Write files only under \`.skill-trainer/checks/\`.
- \`.skill-trainer/checks/run.sh\` is the entrypoint. The harness runs \`sh .skill-trainer/checks/run.sh\` with the repository as the working directory.
- Exit 0 means the task is done. Any other exit means it is not.
- Check the behavior and artifacts the task requires. Do not check wording inside a skill file.
- Do not implement the task. Do not change project files so the check passes. Do not weaken the check so it passes now.
- Keep the script deterministic and offline. No network.
- ${gate}

<task>
${input.auftrag}
</task>
`;
}

export function buildOptimizerPrompt(input: {
  skill: string;
  kind: "step" | "slow" | "create" | "pretrain";
  learningRate: number;
  train: Trajectory[];
  rejected: Rejection[];
  files?: SkillFile[];
  emptyGate?: boolean;
  skillScope?: "general" | "specific";
  auftrag?: string;
  skillBrief?: string;
  budget?: OptimizerBudget;
}): string {
  const failures = input.train.filter((run) => run.score.hard < 1);
  const successes = input.train.filter((run) => run.score.hard >= 1);
  const rejected = input.rejected
    .slice(-6)
    .map((item, index) => {
      const edits = [
        ...item.edits.map((edit) => formatEdit(edit)),
        ...(item.fileEdits ?? []).map((edit) => formatFileEdit(edit)),
      ].join("\n");
      const evidence = (item.gateRuns ?? [])
        .filter((run) => run.score.hard < 1)
        .slice(0, 2)
        .map((run) => clip(formatRun(run), 1200))
        .join("\n");
      return [
        `Rejection ${index + 1}: gate ${(item.before.gate * 100).toFixed(1)} -> ${(item.after.gate * 100).toFixed(1)}`,
        item.reasoning,
        edits,
        evidence ? `Held-out runs:\n${evidence}` : "",
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    })
    .join("\n\n");

  const budget = input.budget ?? DEFAULT_BUDGET;
  const budgetHint = budget.unlimited
    ? `There is no optimizer edit budget: no harness limit on the number of edits or file operations, individual edit length, file-operation content length, or total added characters. Return all changes needed for a coherent skill folder.`
    : `Budget for this proposal: at most ${input.learningRate} text edits in "edits", each containing at most ${budget.maxEditChars} characters in "content", with at most ${budget.maxAddedChars} added characters in total. At most ${budget.maxFileEdits} file operations in "files", each containing at most ${budget.maxFileChars} characters in "content". These are separate budgets. Rank changes from most useful to least; the harness applies only changes that fit.`;
  const slowHint = input.kind === "slow"
    ? `This is a slow update. Put the durable lesson in the "slow" string (plain markdown${budget.unlimited ? " without a harness length limit" : `, at most ${Math.min(budget.maxEditChars, budget.maxAddedChars)} characters`}). You may also propose edits and file operations within the budget above.`
    : `Leave "slow" as an empty string.`;
  const draftHint = input.kind === "create"
    ? `Create a new skill folder from the brief below. There are no rollout results yet. Write the complete SKILL.md using a "write" operation in "files", plus any useful references, scripts, or assets. Give SKILL.md YAML frontmatter with a name and a description that explains when to use it.`
    : input.kind === "pretrain"
      ? `This is pretraining before fine-tuning. Restructure, expand, or rewrite the existing skill folder according to the brief below. There are no rollout results yet. Improve its procedure, references, and scripts as a coherent whole.`
      : `This is fine-tuning from the rollout evidence below. Propose a coherent improvement that will be tested on fresh held-out runs.`;

  const aim =
    input.skillScope === "specific"
      ? `This skill is for this assignment, not a general procedure. Encode the concrete commands, paths, flags, APIs, and pitfalls that make this task succeed. You may name this task's files and checks. Do not paste a finished solution or a diff the agent can copy instead of doing the work.`
      : `This skill must stay general. Write reusable procedure for this kind of task: commands, flags, file locations, API names, order of operations, and pitfalls. Do not paste the solution, the diff, or a task-specific answer into the skill. Do not add a rule that only restates this one assignment.`;

  return `You optimize one skill folder. The target model stays frozen. You may change everything inside this skill folder: rewrite SKILL.md, update its frontmatter and name when useful, add or replace reference documents and scripts, and delete obsolete companion files.

The run directories are already gone, including copies that passed. The scores, diffs, and errors below are the whole record. Do not search the disk, the original project, Application Support, or any earlier session. Do not call tools.

The skill must make the next agent reach the task with less searching and fewer mistakes. ${aim}
${draftHint}
${input.skillBrief ? `\nSkill brief:\n<brief>\n${input.skillBrief}\n</brief>\n` : ""}
${
  input.skillScope === "specific" && input.auftrag
    ? `
Assignment to encode:
${input.auftrag}
`
    : ""
}
${
  input.emptyGate
    ? `
Every rollout below ran in a fresh empty repository. The agent could not read the original project. Put the scaffold, commands, reference notes, and scripts into the skill folder so the next agent succeeds from that folder alone. Do not mention files that exist only in the user's project.
`
    : ""
}

Keep valid YAML frontmatter with a name and description. Keep the main document clear; move detailed reference material and executable helpers into companion files when useful. The existing slow region is editable like the rest of SKILL.md.

Operations:
- append: add "content" at the end of the editable body. "target" is "".
- insert_after: "target" is an exact unique snippet copied from the skill; "content" is inserted after it.
- replace: "target" is an exact unique snippet; "content" replaces it.
- delete: "target" is an exact unique snippet; "content" is "".

If a target string is not unique, the harness skips the edit. Prefer short targets that occur once.

File operations travel with SKILL.md. Add a reference document or a script when the next agent would otherwise have to rediscover it. SKILL.md can be rewritten through "files", including during fine-tuning. Do not also text-edit a section that a later file write replaces.
- write: "path" is relative to the skill folder, "content" is the full new text file. Use this to create or fully rewrite SKILL.md, a document, or a script. Set "executable": true for runnable scripts.
- replace: "path" plus an exact unique "target" snippet inside an existing file.
- delete: "path" identifies an obsolete companion file; "content" is "". SKILL.md must remain present and nonempty.
- All paths must stay inside the skill folder. No absolute paths, parent/dot segments, or .git paths.

${budgetHint}
${slowHint}

Reply with one JSON object and nothing else. Do not edit files.
{
  "reasoning": "what failed, what worked, why these edits reduce future research",
  "slow": "",
  "edits": [
    { "op": "append", "target": "", "content": "...", "why": "..." }
  ],
  "files": [
    { "op": "write", "path": "reference.md", "content": "the commands, layout, and pitfalls" },
    { "op": "write", "path": "scripts/scaffold.sh", "content": "the script the agent should run", "executable": true }
  ]
}

Current skill (${input.skill.length} characters):
<skill>
${input.skill}
</skill>

Failure minibatch (${failures.length}):
${failures.map(formatRun).join("\n\n") || "(none)"}

Success minibatch (${successes.length}):
${successes.map(formatRun).join("\n\n") || "(none)"}

Other skill files:
${formatSkillFiles(input.files ?? [])}

Rejected edits, do not repeat them:
${rejected || "(none)"}
`;
}

function formatRun(run: Trajectory): string {
  return scrubPaths(
    [
      `Run ${run.runId} tools=${run.score.toolCalls} verify=${run.score.verifyExitCode ?? "n/a"} hard=${run.score.hard}`,
      run.summary,
    ].join("\n"),
  );
}

function scrubPaths(text: string): string {
  const folded = text.replaceAll("Application Support", "Application+Support");
  return folded
    .replace(/(?:~|\/(?:Users|private|tmp|var|opt|home|Applications))(?:\/[^\s"'`|]+)+/g, "[path]")
    .replaceAll("Application+Support", "Application Support");
}

function formatSkillFiles(files: SkillFile[]): string {
  const others = files.filter((file) => file.path !== "SKILL.md");
  if (others.length === 0) return "(none)";
  return others
    .map((file) => {
      if (file.base64) return `${file.path} (binary, copied unchanged)`;
      return `--- ${file.path}${file.executable ? " (executable)" : ""} ---\n${file.text ?? ""}`;
    })
    .join("\n\n");
}

function formatFileEdit(edit: FileEdit): string {
  return `- file ${edit.op} ${edit.path} content=${JSON.stringify(clip(edit.content, 180))}`;
}

function formatEdit(edit: SkillEdit): string {
  const target = edit.target ? ` target=${JSON.stringify(clip(edit.target, 180))}` : "";
  return `- ${edit.op}${target} content=${JSON.stringify(clip(edit.content, 180))}`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
