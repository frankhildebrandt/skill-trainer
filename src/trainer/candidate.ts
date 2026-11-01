import { DEFAULT_BUDGET } from "../shared/budget";
import type { OptimizerBudget, SkillFile } from "../shared/types";
import { applyEdits, setSlowRegion } from "./edits";
import type { Proposal } from "./json";
import { applyFileEdits, withDocument } from "./skill-bundle";

/** Applies a proposal consistently to a complete skill folder in every workflow. */
export function applyProposal(input: {
  skill: string;
  files: SkillFile[];
  proposal: Proposal;
  learningRate: number;
  budget?: OptimizerBudget;
  slow?: boolean;
}) {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const cap = (value: number) => budget.unlimited ? Infinity : value;
  const document = input.slow && input.proposal.slow
    ? setSlowRegion(input.skill, input.proposal.slow, cap(Math.min(budget.maxEditChars, budget.maxAddedChars)))
    : input.skill;
  const text = applyEdits(document, input.proposal.edits, {
    limit: cap(input.learningRate),
    maxEditChars: cap(budget.maxEditChars),
    maxAddedChars: cap(budget.maxAddedChars),
    protectSlowRegion: false,
  });
  const files = applyFileEdits(withDocument(input.files, text.skill), input.proposal.files ?? [], cap(budget.maxFileEdits), {
    maxFileChars: cap(budget.maxFileChars),
    allowSkillDocument: true,
  });
  const skill = files.files.find((file) => file.path === "SKILL.md")?.text ?? text.skill;
  if (!skill.trim()) throw new Error("Der Skill darf keine leere SKILL.md enthalten.");
  return {
    skill,
    files: withDocument(files.files, skill),
    applied: text.applied,
    appliedFiles: files.applied,
    skipped: [...text.skipped, ...files.skipped],
  };
}
