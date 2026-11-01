import { DEFAULT_BUDGET } from "@shared/budget";
import type { OptimizerBudget, TrainRequest } from "@shared/types";
import { NumberField } from "./NumberField";
import { useI18n } from "./i18n";

export function BudgetFields({
  form,
  running,
  onChange,
}: {
  form: TrainRequest;
  running: boolean;
  onChange: (form: TrainRequest) => void;
}) {
  const { t } = useI18n();
  const budget = form.budget ?? DEFAULT_BUDGET;
  const runBudget = form.runBudget === undefined ? 48 : form.runBudget;
  function setBudget(patch: Partial<OptimizerBudget>) {
    onChange({ ...form, budget: { ...budget, ...patch } });
  }
  return (
    <fieldset className="choice" disabled={running}>
      <legend>{t("form.budgets")}</legend>
      <label className="check">
        <input
          type="checkbox"
          checked={budget.unlimited}
          onChange={(event) => setBudget({ unlimited: event.target.checked })}
        />
        {t("form.unlimitedEdits")}
      </label>
      <small>{t("form.optimizerHint")}</small>
      {!budget.unlimited ? (
        <div className="grid">
          <NumberField label={t("form.editChars")} value={budget.maxEditChars} onChange={(maxEditChars) => setBudget({ maxEditChars })} />
          <NumberField label={t("form.addedChars")} value={budget.maxAddedChars} onChange={(maxAddedChars) => setBudget({ maxAddedChars })} />
          <NumberField label={t("form.fileEdits")} value={budget.maxFileEdits} onChange={(maxFileEdits) => setBudget({ maxFileEdits })} />
          <NumberField label={t("form.fileChars")} value={budget.maxFileChars} onChange={(maxFileChars) => setBudget({ maxFileChars })} />
        </div>
      ) : (
        <small>{t("form.unlimitedHint")}</small>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={runBudget === null}
          onChange={(event) => onChange({ ...form, runBudget: event.target.checked ? null : 48 })}
        />
        {t("form.unlimitedRuns")}
      </label>
      {runBudget !== null ? (
        <NumberField label={t("form.maxRuns")} value={runBudget} onChange={(value) => onChange({ ...form, runBudget: value })} />
      ) : null}
      <small>{t("form.limitsHint")}</small>
    </fieldset>
  );
}
