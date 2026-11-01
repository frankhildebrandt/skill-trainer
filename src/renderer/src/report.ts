import type { SessionSummary } from "@shared/types";
import { translate, type Locale } from "../../shared/i18n";

export function bundleChanged(summary: SessionSummary): boolean {
  if (summary.bestSkill.trim() !== summary.originalSkill.trim()) return true;
  const left = summary.originalFiles ?? [];
  const right = summary.bestFiles ?? [];
  if (left.length !== right.length) return true;
  return right.some((file) => {
    const other = left.find((item) => item.path === file.path);
    return !other || other.text !== file.text || other.base64 !== file.base64 || Boolean(other.executable) !== Boolean(file.executable);
  });
}

export function measuredImprovement(summary: SessionSummary): boolean {
  return summary.best.runs > 0 && summary.best.gate > summary.baseline.gate + 1e-9;
}

export function resultTitle(summary: SessionSummary, locale: Locale = "de"): string {
  if (measuredImprovement(summary)) return translate(locale, "runs.report.improved");
  if (summary.draft && bundleChanged(summary)) {
    return translate(locale, summary.best.runs > 0 ? "runs.report.draftTrained" : "runs.report.draftPrepared");
  }
  if (summary.error || summary.cancelled) return translate(locale, "runs.report.cancelledUnchanged");
  return translate(locale, "runs.report.noImprovement");
}

export function reportBody(summary: SessionSummary, locale: Locale = "de"): string {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params);
  const lines = [resultTitle(summary, locale)];
  if (summary.draft) {
    lines.push("", t(summary.draft.kind === "create" ? "runs.report.created" : "runs.report.pretrained"));
    lines.push(t("runs.report.noGate"));
    if (summary.draft.reasoning) lines.push("", summary.draft.reasoning);
  }
  if (summary.best.runs > 0) {
    lines.push("", t("runs.report.scores", {
      baselineLabel: t(summary.draft ? "runs.report.draftBaseline" : "runs.report.start"),
      baseline: pct(summary.baseline.gate, locale),
      baselinePasses: summary.baseline.passes.toLocaleString(locale),
      baselineRuns: summary.baseline.runs.toLocaleString(locale),
      best: pct(summary.best.gate, locale),
      bestPasses: summary.best.passes.toLocaleString(locale),
      bestRuns: summary.best.runs.toLocaleString(locale),
    }));
    if (summary.draft && !measuredImprovement(summary)) lines.push(t("runs.report.noAdditionalImprovement"));
  } else if (summary.draft) {
    lines.push("", t("runs.report.unmeasured"));
  }
  if (summary.error) lines.push("", summary.error);
  if (summary.cancelled) lines.push("", t("runs.report.cancelled"));
  return lines.join("\n");
}

function pct(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100);
}
