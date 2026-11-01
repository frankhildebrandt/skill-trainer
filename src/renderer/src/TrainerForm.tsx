import { useRef } from "react";
import { matchesSkill } from "@shared/project-skill";
import type { ModelOption, ProjectSkill, TrainRequest } from "@shared/types";
import { BudgetFields } from "./BudgetFields";
import { NumberField } from "./NumberField";

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
  onDerive,
  deriving,
}: {
  form: TrainRequest;
  running: boolean;
  deriving: boolean;
  models: ModelOption[];
  skillName: string | null;
  projectSkills: ProjectSkill[];
  skillsNote: string | null;
  onChange: (form: TrainRequest) => void;
  onChooseSkill: () => void;
  onChooseDestination: () => void;
  onChooseFolder: () => void;
  onPickRun: () => void;
  onDerive: () => void;
}) {
  const paths = useRef({ create: "", existing: "" });
  const workflow = form.workflow ?? "train";
  const draft = workflow !== "train";
  const fineTune = !draft || form.trainAfterDraft !== false;
  const locked = running || deriving;
  const deriveModelId = fineTune ? form.targetModel : form.optimizerModel;
  const deriveModel = models.find((model) => model.id === deriveModelId)?.label ?? deriveModelId;

  function changeWorkflow(next: "train" | "pretrain" | "create") {
    const currentKey = workflow === "create" ? "create" : "existing";
    const nextKey = next === "create" ? "create" : "existing";
    paths.current[currentKey] = form.skillPath;
    onChange({ ...form, workflow: next, skillPath: paths.current[nextKey] });
  }

  return (
    <>
      <label>
        Workflow
        <select value={workflow} disabled={locked} onChange={(event) => changeWorkflow(event.target.value as typeof workflow)}>
          <option value="train">Fine-Tuning</option>
          <option value="pretrain">Vortraining</option>
          <option value="create">Create Skill</option>
        </select>
      </label>
      {workflow === "create" ? (
        <>
          <label>
            Skill-Name
            <input
              value={form.skillName ?? ""}
              disabled={locked}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="mein-neuer-skill"
              onChange={(event) => onChange({ ...form, skillName: event.target.value })}
            />
          </label>
          <label>
            Neuer Skill-Ordner
            <div className="row">
              <input
                value={form.skillPath}
                disabled={locked}
                required
                placeholder="Pfad zum neuen Skill-Ordner"
                onChange={(event) => onChange({ ...form, skillPath: event.target.value })}
              />
              <button type="button" onClick={onChooseDestination} disabled={locked}>Wählen</button>
            </div>
            <small>Der Ordner wird beim Übernehmen des Ergebnisses erstellt.</small>
          </label>
        </>
      ) : null}
      {fineTune ? (
        <label>
          Projekt
          <div className="row">
            <input readOnly value={form.workspacePath} placeholder="Projektordner" />
            <button type="button" onClick={onChooseFolder} disabled={locked}>Wählen</button>
          </div>
          <small>Läufe schreiben nur in eine eigene Kopie. Dieser Ordner und sein Git bleiben unverändert.</small>
        </label>
      ) : null}
      {workflow !== "create" ? (
        <>
          <SkillField
            form={form}
            running={locked}
            skillName={skillName}
            projectSkills={projectSkills}
            skillsNote={skillsNote}
            onChange={onChange}
            onChooseSkill={onChooseSkill}
          />
          <div className="field">
            <div className="field-head">
              <span>Aus dem Skill</span>
              <button
                type="button"
                onClick={onDerive}
                disabled={locked || !form.skillPath.trim() || !deriveModelId.trim()}
                title={form.skillPath.trim() ? `${deriveModel} liest den Skill und schreibt Ziel und Auftrag` : "Zuerst einen Skill wählen"}
              >
                {deriving ? "Analysiert…" : "Mit Modell füllen"}
              </button>
            </div>
            <small>{deriveModel} liest den gewählten Skill und schreibt Ziel und Auftrag.</small>
          </div>
        </>
      ) : null}
      {draft ? (
        <>
          <label>
            {workflow === "create" ? "Skill beschreiben" : "Ziel des Vortrainings"}
            <textarea
              value={form.skillBrief ?? ""}
              disabled={locked}
              required
              rows={5}
              placeholder="Einsatzfälle, gewünschter Ablauf, Referenzen und Skripte"
              onChange={(event) => onChange({ ...form, skillBrief: event.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.trainAfterDraft !== false}
              disabled={locked}
              onChange={(event) => onChange({ ...form, trainAfterDraft: event.target.checked })}
            />
            Anschließend Fine-Tuning
          </label>
          <p className="quiet">Der Entwurf wird vor dem Fine-Tuning vorbereitet. Seine Qualität ist erst durch Trainingsläufe messbar.</p>
        </>
      ) : null}
      {fineTune ? (
        <>
          <div className="field">
            <div className="field-head">
              <span>Trainingsauftrag</span>
              <button
                type="button"
                onClick={onPickRun}
                disabled={locked || !form.workspacePath.trim()}
                title={form.workspacePath.trim() ? "Lokale und Cloud-Agents dieses Repos" : "Zuerst einen Projektordner wählen"}
              >
                Aus Cursor-Läufen
              </button>
            </div>
            <textarea
              value={form.auftrag}
              disabled={locked}
              required
              onChange={(event) => onChange({ ...form, auftrag: event.target.value })}
              rows={4}
              placeholder="Konkrete Aufgabe, an der der Skill geprüft wird"
            />
            <small>Oder einen vorhandenen Lauf dieses Repos auswählen. Die Suche geht durch Auftrag und Antworten.</small>
          </div>
          <label>
            Weitere Aufträge
            <textarea value={form.extraTasks} disabled={locked} onChange={(event) => onChange({ ...form, extraTasks: event.target.value })} rows={2} placeholder="Eine Zeile pro Variante" />
          </label>
          <fieldset className="choice" disabled={locked}>
            <legend>Prüfung</legend>
            <label className="check">
              <input type="radio" name="verifyMode" checked={form.verifyMode === "command"} onChange={() => onChange({ ...form, verifyMode: "command" })} />
              Testbefehl
            </label>
            <label className="check">
              <input type="radio" name="verifyMode" checked={form.verifyMode === "agent"} onChange={() => onChange({ ...form, verifyMode: "agent" })} />
              Agent schreibt das Testskript
            </label>
          </fieldset>
          {form.verifyMode === "command" ? (
            <label>
              Testbefehl
              <input value={form.verifyCommand} required disabled={locked} onChange={(event) => onChange({ ...form, verifyCommand: event.target.value })} placeholder="npm test" />
            </label>
          ) : null}
        </>
      ) : null}
      <fieldset className="choice" disabled={locked}>
        <legend>Ziel</legend>
        <label className="check">
          <input type="radio" name="skillScope" checked={form.skillScope !== "specific"} onChange={() => onChange({ ...form, skillScope: "general" })} />
          Allgemein
        </label>
        <label className="check">
          <input type="radio" name="skillScope" checked={form.skillScope === "specific"} onChange={() => onChange({ ...form, skillScope: "specific" })} />
          {fineTune ? "Dieser Auftrag" : "Dieser Zweck"}
        </label>
        {workflow === "train" ? (
          <label>
            In eigenen Worten
            <textarea
              value={form.skillBrief ?? ""}
              disabled={locked}
              rows={3}
              placeholder="Worauf der Skill hinaus soll"
              onChange={(event) => onChange({ ...form, skillBrief: event.target.value })}
            />
          </label>
        ) : null}
      </fieldset>
      <div className="grid">
        {fineTune ? <ModelField label="Zielmodell" models={models} value={form.targetModel} disabled={locked} onChange={(targetModel) => onChange({ ...form, targetModel })} /> : null}
        <ModelField label="Optimierer" models={models} value={form.optimizerModel} disabled={locked} onChange={(optimizerModel) => onChange({ ...form, optimizerModel })} />
      </div>
      {fineTune ? (
        <>
          <div className="grid nums">
            <NumberField label="Schritte" value={form.steps} disabled={locked} onChange={(steps) => onChange({ ...form, steps })} />
            <NumberField label="Training" value={form.trainBatch} disabled={locked} onChange={(trainBatch) => onChange({ ...form, trainBatch })} />
            <NumberField label="Gate" value={form.selectionRepeats} disabled={locked} onChange={(selectionRepeats) => onChange({ ...form, selectionRepeats })} />
            <NumberField label="Parallel" value={form.concurrency} disabled={locked} onChange={(concurrency) => onChange({ ...form, concurrency })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={form.gateOnEmptyRepo} disabled={locked} onChange={(event) => onChange({ ...form, gateOnEmptyRepo: event.target.checked })} />
            Gate auf leerem Repository
          </label>
          <label className="check">
            <input type="checkbox" checked={form.slowUpdate} disabled={locked} onChange={(event) => onChange({ ...form, slowUpdate: event.target.checked })} />
            Slow-Update
          </label>
          <details className="settings-details">
            <summary>Zeitlimits</summary>
            <div className="grid">
              <NumberField label="Lauf (Minuten)" value={form.attemptTimeoutMin} disabled={locked} onChange={(attemptTimeoutMin) => onChange({ ...form, attemptTimeoutMin })} />
              <NumberField label="Prüfung (Sekunden)" value={form.verifyTimeoutSec} disabled={locked} onChange={(verifyTimeoutSec) => onChange({ ...form, verifyTimeoutSec })} />
            </div>
          </details>
        </>
      ) : null}
      {!form.budget?.unlimited ? <NumberField label="Lernrate (Text-Edits)" value={form.learningRate} disabled={locked} onChange={(learningRate) => onChange({ ...form, learningRate })} /> : null}
      <BudgetFields form={form} running={locked} onChange={onChange} />
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
  const selected = projectSkills.find((skill) => matchesSkill(form.skillPath, skill.root))?.root ?? "";
  return (
    <label>
      Skill
      {form.workspacePath.trim() ? (
        <select
          value={selected}
          disabled={running || projectSkills.length === 0}
          onChange={(event) => onChange({ ...form, skillPath: event.target.value })}
        >
          <option value="">{projectSkills.length === 0 ? "Kein Skill im Projekt" : "Skill aus dem Projekt"}</option>
          {projectSkills.map((skill) => (
            <option key={skill.root} value={skill.root}>
              {skill.name} · {skill.relative}
            </option>
          ))}
        </select>
      ) : null}
      <div className="row">
        <input readOnly value={form.skillPath} placeholder="Ordner oder SKILL.md" />
        <button type="button" onClick={onChooseSkill} disabled={running}>Wählen</button>
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
