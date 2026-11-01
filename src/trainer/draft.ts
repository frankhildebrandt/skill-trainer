import { translate, type Locale, type Translate } from "../shared/i18n";
import type { SkillDraft, TrainerEvent } from "../shared/types";
import { applyProposal } from "./candidate";
import type { NormalizedTrain } from "./config";
import type { TrainerDeps } from "./loop";
import { throwIfAborted } from "./pool";
import { sameBundle, type SkillBundle } from "./skill-bundle";
import { frontmatterName } from "./skill-file";

/** Builds a structurally checked draft before any measured training begins. */
export async function prepareSkillDraft(
  config: NormalizedTrain,
  bundle: SkillBundle,
  signal: AbortSignal,
  propose: TrainerDeps["propose"],
  emit: (event: TrainerEvent) => void,
  locale: Locale = "de",
): Promise<SkillDraft> {
  const t: Translate = (key, values) => translate(locale, key, values);
  if (config.workflow === "train") throw new Error(t("trainer.noDraftNeeded"));
  throwIfAborted(signal);
  emit({ type: "phase", phase: config.workflow });
  const skill = config.workflow === "create"
    ? `---\nname: ${config.skillName}\ndescription: ${JSON.stringify(config.skillBrief.split("\n")[0])}\n---\n\n# ${config.skillName}\n`
    : bundle.document;
  const proposal = await propose({
    skill, files: bundle.files, kind: config.workflow, learningRate: config.learningRate,
    budget: config.budget, skillBrief: config.skillBrief, train: [], rejected: [],
    emptyGate: config.gateOnEmptyRepo, skillScope: config.skillScope, auftrag: config.auftrag, signal,
  });
  throwIfAborted(signal);
  const candidate = applyProposal({ skill, files: bundle.files, proposal, learningRate: config.learningRate, budget: config.budget });
  if (sameBundle(skill, candidate.skill, bundle.files.length ? bundle.files : [{ path: "SKILL.md", text: skill }], candidate.files)) {
    throw new Error(t("trainer.unchangedDraft"));
  }
  if (!frontmatterName(candidate.skill) || !/^description:\s*\S.*$/m.test(candidate.skill.split(/\r?\n---/)[0] ?? "")) {
    throw new Error(t("trainer.draftFrontmatter"));
  }
  for (const skipped of candidate.skipped) {
    emit({ type: "log", message: t("trainer.draftSkipped", { reason: skipped.reason }) });
  }
  emit({ type: "log", message: t("trainer.draftReady", { workflow: t(config.workflow === "create" ? "trainer.newSkill" : "trainer.pretraining"), count: candidate.files.length }) });
  return { kind: config.workflow, reasoning: proposal.reasoning, skill: candidate.skill, files: candidate.files };
}
