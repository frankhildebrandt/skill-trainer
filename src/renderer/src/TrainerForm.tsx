import { useRef } from "react";
import type { ModelOption, TrainRequest } from "@shared/types";
import { BudgetFields } from "./BudgetFields";
import { NumberField } from "./NumberField";

export function TrainerForm({
  form,
  running,
  models,
  skillName,
  onChange,
  onChooseSkill,
  onChooseDestination,
  onChooseFolder,
}: {
  form: TrainRequest;
  running: boolean;
  models: ModelOption[];
  skillName: string | null;
  onChange: (form: TrainRequest) => void;
  onChooseSkill: () => void;
  onChooseDestination: () => void;
  onChooseFolder: () => void;
}) {
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
        Workflow
        <select value={workflow} disabled={running} onChange={(event) => changeWorkflow(event.target.value as typeof workflow)}>
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
              disabled={running}
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
                disabled={running}
                required
                placeholder="Pfad zum neuen Skill-Ordner"
                onChange={(event) => onChange({ ...form, skillPath: event.target.value })}
              />
              <button type="button" onClick={onChooseDestination} disabled={running}>Wählen</button>
            </div>
            <small>Der Ordner wird beim Übernehmen des Ergebnisses erstellt.</small>
          </label>
        </>
      ) : (
        <label>
          Skill
          <div className="row">
            <input readOnly value={form.skillPath} placeholder="Ordner oder SKILL.md" />
            <button type="button" onClick={onChooseSkill} disabled={running}>Wählen</button>
          </div>
          {skillName ? <small>{skillName}</small> : null}
        </label>
      )}
      {draft ? (
        <>
          <label>
            {workflow === "create" ? "Skill beschreiben" : "Ziel des Vortrainings"}
            <textarea
              value={form.skillBrief ?? ""}
              disabled={running}
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
              disabled={running}
              onChange={(event) => onChange({ ...form, trainAfterDraft: event.target.checked })}
            />
            Anschließend Fine-Tuning
          </label>
          <p className="quiet">Der Entwurf wird vor dem Fine-Tuning vorbereitet. Seine Qualität ist erst durch Trainingsläufe messbar.</p>
        </>
      ) : null}
      {fineTune ? (
        <>
          <label>
            Projekt
            <div className="row">
              <input readOnly value={form.workspacePath} placeholder="Projektordner" />
              <button type="button" onClick={onChooseFolder} disabled={running}>Wählen</button>
            </div>
          </label>
          <label>
            Trainingsauftrag
            <textarea
              value={form.auftrag}
              disabled={running}
              required
              onChange={(event) => onChange({ ...form, auftrag: event.target.value })}
              rows={4}
              placeholder="Konkrete Aufgabe, an der der Skill geprüft wird"
            />
          </label>
          <label>
            Weitere Aufträge
            <textarea value={form.extraTasks} disabled={running} onChange={(event) => onChange({ ...form, extraTasks: event.target.value })} rows={2} placeholder="Eine Zeile pro Variante" />
          </label>
          <fieldset className="choice" disabled={running}>
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
              <input value={form.verifyCommand} required disabled={running} onChange={(event) => onChange({ ...form, verifyCommand: event.target.value })} placeholder="npm test" />
            </label>
          ) : null}
        </>
      ) : null}
      <fieldset className="choice" disabled={running}>
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
              disabled={running}
              rows={3}
              placeholder="Worauf der Skill hinaus soll"
              onChange={(event) => onChange({ ...form, skillBrief: event.target.value })}
            />
          </label>
        ) : null}
      </fieldset>
      <div className="grid">
        {fineTune ? <ModelField label="Zielmodell" models={models} value={form.targetModel} disabled={running} onChange={(targetModel) => onChange({ ...form, targetModel })} /> : null}
        <ModelField label="Optimierer" models={models} value={form.optimizerModel} disabled={running} onChange={(optimizerModel) => onChange({ ...form, optimizerModel })} />
      </div>
      {fineTune ? (
        <>
          <div className="grid nums">
            <NumberField label="Schritte" value={form.steps} disabled={running} onChange={(steps) => onChange({ ...form, steps })} />
            <NumberField label="Training" value={form.trainBatch} disabled={running} onChange={(trainBatch) => onChange({ ...form, trainBatch })} />
            <NumberField label="Gate" value={form.selectionRepeats} disabled={running} onChange={(selectionRepeats) => onChange({ ...form, selectionRepeats })} />
            <NumberField label="Parallel" value={form.concurrency} disabled={running} onChange={(concurrency) => onChange({ ...form, concurrency })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={form.gateOnEmptyRepo} disabled={running} onChange={(event) => onChange({ ...form, gateOnEmptyRepo: event.target.checked })} />
            Gate auf leerem Repository
          </label>
          <label className="check">
            <input type="checkbox" checked={form.slowUpdate} disabled={running} onChange={(event) => onChange({ ...form, slowUpdate: event.target.checked })} />
            Slow-Update
          </label>
          <details className="settings-details">
            <summary>Zeitlimits</summary>
            <div className="grid">
              <NumberField label="Lauf (Minuten)" value={form.attemptTimeoutMin} disabled={running} onChange={(attemptTimeoutMin) => onChange({ ...form, attemptTimeoutMin })} />
              <NumberField label="Prüfung (Sekunden)" value={form.verifyTimeoutSec} disabled={running} onChange={(verifyTimeoutSec) => onChange({ ...form, verifyTimeoutSec })} />
            </div>
          </details>
        </>
      ) : null}
      {!form.budget?.unlimited ? <NumberField label="Lernrate (Text-Edits)" value={form.learningRate} disabled={running} onChange={(learningRate) => onChange({ ...form, learningRate })} /> : null}
      <BudgetFields form={form} running={running} onChange={onChange} />
    </>
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
