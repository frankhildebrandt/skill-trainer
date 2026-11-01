import { DEFAULT_BUDGET } from "@shared/budget";
import type { OptimizerBudget, TrainRequest } from "@shared/types";
import { NumberField } from "./NumberField";

export function BudgetFields({
  form,
  running,
  onChange,
}: {
  form: TrainRequest;
  running: boolean;
  onChange: (form: TrainRequest) => void;
}) {
  const budget = form.budget ?? DEFAULT_BUDGET;
  const runBudget = form.runBudget === undefined ? 48 : form.runBudget;
  function setBudget(patch: Partial<OptimizerBudget>) {
    onChange({ ...form, budget: { ...budget, ...patch } });
  }
  return (
    <fieldset className="choice" disabled={running}>
      <legend>Budgets</legend>
      <label className="check">
        <input
          type="checkbox"
          checked={budget.unlimited}
          onChange={(event) => setBudget({ unlimited: event.target.checked })}
        />
        Optimizer ohne Edit-Budget
      </label>
      <small>Der Optimizer darf SKILL.md vollständig umschreiben und Referenzen oder Skripte anlegen, ändern und löschen.</small>
      {!budget.unlimited ? (
        <div className="grid">
          <NumberField label="Zeichen pro Text-Edit" value={budget.maxEditChars} onChange={(maxEditChars) => setBudget({ maxEditChars })} />
          <NumberField label="Neue Zeichen pro Schritt" value={budget.maxAddedChars} onChange={(maxAddedChars) => setBudget({ maxAddedChars })} />
          <NumberField label="Datei-Edits pro Schritt" value={budget.maxFileEdits} onChange={(maxFileEdits) => setBudget({ maxFileEdits })} />
          <NumberField label="Zeichen pro Datei-Edit" value={budget.maxFileChars} onChange={(maxFileChars) => setBudget({ maxFileChars })} />
        </div>
      ) : (
        <small>Keine Grenze für Edit-Anzahl oder Textlänge. Die Lernrate wird ausgesetzt.</small>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={runBudget === null}
          onChange={(event) => onChange({ ...form, runBudget: event.target.checked ? null : 48 })}
        />
        Ohne Laufbudget
      </label>
      {runBudget !== null ? (
        <NumberField label="Maximale Agent-Läufe" value={runBudget} onChange={(value) => onChange({ ...form, runBudget: value })} />
      ) : null}
      <small>Die gewählten Schritte und Zeitlimits gelten weiterhin.</small>
    </fieldset>
  );
}
