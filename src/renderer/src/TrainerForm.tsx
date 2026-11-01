import { useRef } from "react";
import { matchesSkill } from "@shared/project-skill";
import type { ModelOption, ProjectSkill, TrainRequest } from "@shared/types";
import { BudgetFields } from "./BudgetFields";
import { NumberField } from "./NumberField";
import { useI18n } from "./i18n";

export function TrainerForm({
  form,
  running,
  models,
  skillName,
  projectSkills,
  skillsNote,
  onChange,
  onChooseSkill,
  onChooseDestination,
  onChooseFolder,
  onPickRun,
}: {
  form: TrainRequest;
  running: boolean;
  models: ModelOption[];
  skillName: string | null;
  projectSkills: ProjectSkill[];
  skillsNote: string | null;
  onChange: (form: TrainRequest) => void;
  onChooseSkill: () => void;
  onChooseDestination: () => void;
  onChooseFolder: () => void;
  onPickRun: () => void;
}) {
  const { t } = useI18n();
  const paths = useRef({ create: "", existing: "" });
  const workflow = form.workflow ?? "train";
  const draft = workflow !== "train";
  const fineTune = !draft || form.trainAfterDraft !== false;

  function changeWorkflow(next: "train" | "pretrain" | "create") {
    const currentKey = workflow === "create" ? "create" : "existing";
    const nextKey = next === "create" ? "create" : "existing";
    paths.current[currentKey] = form.skillPath;
    onChange({ ...form, workflow: next, skillPath: paths.current[nextKey] });
  }

  return (
    <>
      <label>
        {t("form.workflow")}
        <select value={workflow} disabled={running} onChange={(event) => changeWorkflow(event.target.value as typeof workflow)}>
          <option value="train">{t("form.fineTune")}</option>
          <option value="pretrain">{t("form.pretrain")}</option>
          <option value="create">{t("form.create")}</option>
        </select>
      </label>
      {workflow === "create" ? (
        <>
          <label>
            {t("form.skillName")}
            <input
              value={form.skillName ?? ""}
              disabled={running}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder={t("form.skillNamePlaceholder")}
              onChange={(event) => onChange({ ...form, skillName: event.target.value })}
            />
          </label>
          <label>
            {t("form.newSkillFolder")}
            <div className="row">
              <input
                value={form.skillPath}
                disabled={running}
                required
                placeholder={t("form.newSkillPath")}
                onChange={(event) => onChange({ ...form, skillPath: event.target.value })}
              />
              <button type="button" onClick={onChooseDestination} disabled={running}>{t("form.choose")}</button>
            </div>
            <small>{t("form.createFolderHint")}</small>
          </label>
        </>
      ) : null}
      {fineTune ? (
        <label>
          {t("form.project")}
          <div className="row">
            <input readOnly value={form.workspacePath} placeholder={t("form.projectFolder")} />
            <button type="button" onClick={onChooseFolder} disabled={running}>{t("form.choose")}</button>
          </div>
          <small>{t("form.isolationHint")}</small>
        </label>
      ) : null}
      {workflow !== "create" ? (
        <SkillField
          form={form}
          running={running}
          skillName={skillName}
          projectSkills={projectSkills}
          skillsNote={skillsNote}
          onChange={onChange}
          onChooseSkill={onChooseSkill}
        />
      ) : null}
      {draft ? (
        <>
          <label>
            {workflow === "create" ? t("form.describeSkill") : t("form.pretrainGoal")}
            <textarea
              value={form.skillBrief ?? ""}
              disabled={running}
              required
              rows={5}
              placeholder={t("form.briefPlaceholder")}
              onChange={(event) => onChange({ ...form, skillBrief: event.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.trainAfterDraft !== false}
              disabled={running}
              onChange={(event) => onChange({ ...form, trainAfterDraft: event.target.checked })}
            />
            {t("form.fineTuneAfter")}
          </label>
          <p className="quiet">{t("form.draftHint")}</p>
        </>
      ) : null}
      {fineTune ? (
        <>
          <div className="field">
            <div className="field-head">
              <span>{t("form.task")}</span>
              <button
                type="button"
                onClick={onPickRun}
                disabled={running || !form.workspacePath.trim()}
                title={form.workspacePath.trim() ? t("form.runTitle") : t("form.chooseProjectFirst")}
              >
                {t("form.fromRuns")}
              </button>
            </div>
            <textarea
              value={form.auftrag}
              disabled={running}
              required
              onChange={(event) => onChange({ ...form, auftrag: event.target.value })}
              rows={4}
              placeholder={t("form.taskPlaceholder")}
            />
            <small>{t("form.runHint")}</small>
          </div>
          <label>
            {t("form.extraTasks")}
            <textarea value={form.extraTasks} disabled={running} onChange={(event) => onChange({ ...form, extraTasks: event.target.value })} rows={2} placeholder={t("form.extraPlaceholder")} />
          </label>
          <fieldset className="choice" disabled={running}>
            <legend>{t("form.verification")}</legend>
            <label className="check">
              <input type="radio" name="verifyMode" checked={form.verifyMode === "command"} onChange={() => onChange({ ...form, verifyMode: "command" })} />
              {t("form.testCommand")}
            </label>
            <label className="check">
              <input type="radio" name="verifyMode" checked={form.verifyMode === "agent"} onChange={() => onChange({ ...form, verifyMode: "agent" })} />
              {t("form.agentCheck")}
            </label>
          </fieldset>
          {form.verifyMode === "command" ? (
            <label>
              {t("form.testCommand")}
              <input value={form.verifyCommand} required disabled={running} onChange={(event) => onChange({ ...form, verifyCommand: event.target.value })} placeholder="npm test" />
            </label>
          ) : null}
        </>
      ) : null}
      <fieldset className="choice" disabled={running}>
        <legend>{t("form.scope")}</legend>
        <label className="check">
          <input type="radio" name="skillScope" checked={form.skillScope !== "specific"} onChange={() => onChange({ ...form, skillScope: "general" })} />
          {t("form.general")}
        </label>
        <label className="check">
          <input type="radio" name="skillScope" checked={form.skillScope === "specific"} onChange={() => onChange({ ...form, skillScope: "specific" })} />
          {fineTune ? t("form.thisTask") : t("form.thisPurpose")}
        </label>
        {workflow === "train" ? (
          <label>
            {t("form.ownWords")}
            <textarea
              value={form.skillBrief ?? ""}
              disabled={running}
              rows={3}
              placeholder={t("form.goalPlaceholder")}
              onChange={(event) => onChange({ ...form, skillBrief: event.target.value })}
            />
          </label>
        ) : null}
      </fieldset>
      <div className="grid">
        {fineTune ? <ModelField label={t("form.targetModel")} models={models} value={form.targetModel} disabled={running} onChange={(targetModel) => onChange({ ...form, targetModel })} /> : null}
        <ModelField label={t("form.optimizer")} models={models} value={form.optimizerModel} disabled={running} onChange={(optimizerModel) => onChange({ ...form, optimizerModel })} />
      </div>
      {fineTune ? (
        <>
          <div className="grid nums">
            <NumberField label={t("form.steps")} value={form.steps} disabled={running} onChange={(steps) => onChange({ ...form, steps })} />
            <NumberField label={t("form.training")} value={form.trainBatch} disabled={running} onChange={(trainBatch) => onChange({ ...form, trainBatch })} />
            <NumberField label={t("form.gate")} value={form.selectionRepeats} disabled={running} onChange={(selectionRepeats) => onChange({ ...form, selectionRepeats })} />
            <NumberField label={t("form.parallel")} value={form.concurrency} disabled={running} onChange={(concurrency) => onChange({ ...form, concurrency })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={form.gateOnEmptyRepo} disabled={running} onChange={(event) => onChange({ ...form, gateOnEmptyRepo: event.target.checked })} />
            {t("form.emptyGate")}
          </label>
          <label className="check">
            <input type="checkbox" checked={form.slowUpdate} disabled={running} onChange={(event) => onChange({ ...form, slowUpdate: event.target.checked })} />
            {t("form.slowUpdate")}
          </label>
          <details className="settings-details">
            <summary>{t("form.timeouts")}</summary>
            <div className="grid">
              <NumberField label={t("form.attemptMinutes")} value={form.attemptTimeoutMin} disabled={running} onChange={(attemptTimeoutMin) => onChange({ ...form, attemptTimeoutMin })} />
              <NumberField label={t("form.verifySeconds")} value={form.verifyTimeoutSec} disabled={running} onChange={(verifyTimeoutSec) => onChange({ ...form, verifyTimeoutSec })} />
            </div>
          </details>
        </>
      ) : null}
      {!form.budget?.unlimited ? <NumberField label={t("form.learningRate")} value={form.learningRate} disabled={running} onChange={(learningRate) => onChange({ ...form, learningRate })} /> : null}
      <BudgetFields form={form} running={running} onChange={onChange} />
    </>
  );
}

function SkillField({
  form,
  running,
  skillName,
  projectSkills,
  skillsNote,
  onChange,
  onChooseSkill,
}: {
  form: TrainRequest;
  running: boolean;
  skillName: string | null;
  projectSkills: ProjectSkill[];
  skillsNote: string | null;
  onChange: (form: TrainRequest) => void;
  onChooseSkill: () => void;
}) {
  const { t } = useI18n();
  const selected = projectSkills.find((skill) => matchesSkill(form.skillPath, skill.root))?.root ?? "";
  return (
    <label>
      {t("form.skill")}
      {form.workspacePath.trim() ? (
        <select
          value={selected}
          disabled={running || projectSkills.length === 0}
          onChange={(event) => onChange({ ...form, skillPath: event.target.value })}
        >
          <option value="">{projectSkills.length === 0 ? t("form.noProjectSkill") : t("form.projectSkill")}</option>
          {projectSkills.map((skill) => (
            <option key={skill.root} value={skill.root}>
              {skill.name} · {skill.relative}
            </option>
          ))}
        </select>
      ) : null}
      <div className="row">
        <input readOnly value={form.skillPath} placeholder={t("form.skillPath")} />
        <button type="button" onClick={onChooseSkill} disabled={running}>{t("form.choose")}</button>
      </div>
      {skillName ? <small>{skillName}</small> : null}
      {skillsNote ? <small>{skillsNote}</small> : null}
    </label>
  );
}

function ModelField({ label, models, value, disabled, onChange }: {
  label: string;
  models: ModelOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const choices = !value || models.some((model) => model.id === value) ? models : [{ id: value, label: value }, ...models];
  return (
    <label>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {choices.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
    </label>
  );
}
