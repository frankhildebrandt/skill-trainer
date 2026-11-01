import type { SessionSummary } from "@shared/types";

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

export function resultTitle(summary: SessionSummary): string {
  if (measuredImprovement(summary)) return "Bessere Fassung gemessen";
  if (summary.draft && bundleChanged(summary)) {
    return summary.best.runs > 0 ? "Entwurf trainiert" : "Entwurf vorbereitet · ungemessen";
  }
  if (summary.error || summary.cancelled) return "Abgebrochen, Skill unverändert";
  return "Keine Verbesserung";
}

export function reportBody(summary: SessionSummary): string {
  const lines = [resultTitle(summary)];
  if (summary.draft) {
    lines.push("", summary.draft.kind === "create" ? "Der neue Skill wurde als Entwurf erstellt." : "Das Vortraining hat den Skill als Entwurf überarbeitet.");
    lines.push("Der Entwurf wurde ohne Leistungsgate übernommen.");
    if (summary.draft.reasoning) lines.push("", summary.draft.reasoning);
  }
  if (summary.best.runs > 0) {
    lines.push("", `${summary.draft ? "Baseline nach dem Entwurf" : "Start"} **${pct(summary.baseline.gate)}** (${summary.baseline.passes}/${summary.baseline.runs} grün). Beste Fassung **${pct(summary.best.gate)}** (${summary.best.passes}/${summary.best.runs} grün).`);
    if (summary.draft && !measuredImprovement(summary)) lines.push("Das Fine-Tuning hat keine zusätzliche Verbesserung gemessen.");
  } else if (summary.draft) {
    lines.push("", "Es liegt noch keine Leistungsmessung vor. Der Entwurf kann gespeichert und später mit dem Fine-Tuning geprüft werden.");
  }
  if (summary.error) lines.push("", summary.error);
  if (summary.cancelled) lines.push("", "Abgebrochen.");
  return lines.join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}`;
}
