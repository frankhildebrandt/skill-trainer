import type { AggregateScore, SessionEvent, SessionSummary, StepRecord, TrainerApi, TrainRequest, Trajectory } from "../../src/shared/types";

declare global {
  interface Window { trainer: TrainerApi }
}

/** Documentation examples only: no SDK, account, filesystem write, or actual training is used. */
const create = new URLSearchParams(window.location.search).get("example") === "create";
const subscribers = new Set<(event: SessionEvent) => void>();
const originalSkill = "---\nname: react-testing\ndescription: React-Komponenten zuverlässig testen.\n---\n\n# React Testing\n\nSchreibe Tests für das Verhalten der Komponente.\n";
const bestSkill = originalSkill + "\n## Vorgehen\n\n1. Prüfe zuerst die vorhandenen Tests und Konventionen.\n2. Schreibe einen fehlschlagenden Test für das gewünschte Verhalten.\n3. Implementiere die kleinste passende Änderung.\n4. Führe den gezielten Test und anschließend die Testsuite aus.\n";
const baseline: AggregateScore = { gate: 0.446428571, hard: 0.5, soft: 0.142857143, runs: 2, passes: 1 };
const best: AggregateScore = { gate: 0.9, hard: 1, soft: 1 / 3, runs: 2, passes: 2 };
const settings: TrainRequest = {
  workflow: create ? "create" : "train",
  skillName: create ? "api-review" : "",
  skillBrief: create
    ? "Prüfe REST-APIs auf konsistente Fehlerantworten, Eingabevalidierung und verständliche Tests. Nutze eine Checkliste und lege Beispiele unter references/ ab."
    : "Der Skill soll Testkonventionen erkennen und Änderungen durch Verhaltenstests absichern.",
  trainAfterDraft: !create,
  runBudget: 48,
  skillPath: create ? "/beispiel/skills/api-review" : "/beispiel/projekt/.cursor/skills/react-testing",
  workspacePath: "/beispiel/projekt",
  auftrag: "Ergänze die Filterfunktion der Aufgabenliste. Prüfe die Auswahl \"Offen\", \"Erledigt\" und \"Alle\" mit Verhaltenstests.",
  extraTasks: "Prüfe eine leere Aufgabenliste.\nPrüfe den Wechsel zwischen zwei Filtern.",
  verifyMode: "command",
  verifyCommand: "npm test -- task-filter",
  targetModel: "composer-2.5",
  optimizerModel: "composer-2.5",
  steps: 2,
  trainBatch: 2,
  selectionRepeats: 2,
  concurrency: 2,
  learningRate: 3,
  slowUpdate: true,
  gateOnEmptyRepo: false,
  skillScope: "general",
  attemptTimeoutMin: 12,
  verifyTimeoutSec: 180,
};

const step: StepRecord = {
  index: 1,
  kind: "step",
  reasoning: "Die Baseline übersieht einen Filterwechsel. Der Skill erhält einen klaren Ablauf: erst Verhalten absichern, dann implementieren und die Testsuite prüfen.",
  applied: [{ op: "append", target: "", content: "## Vorgehen\n\nErst Verhalten testen, dann implementieren.\nAbschließend die vollständige Testsuite ausführen." }],
  skipped: [],
  selectionBefore: baseline,
  selectionAfter: best,
  accepted: true,
  skill: bestSkill,
};

function finished(runId: string, phase: Trajectory["phase"], passed: boolean, toolCalls: number): Trajectory {
  const soft = passed ? 1 / (1 + toolCalls / 8) : 0;
  return {
    runId, phase, ground: "repo", taskPrompt: settings.auftrag,
    score: {
      hard: Number(passed), soft, gate: 0.85 * Number(passed) + 0.15 * soft,
      verifyExitCode: passed ? 0 : 1,
      verifyOutput: passed ? "Tests: 6 passed\nExit 0" : "Filterwechsel: Erwarteter Eintrag fehlt\nExit 1",
      toolCalls, durationMs: 83_000, status: "finished",
    },
    summary: passed ? "Alle Filterzustände und Filterwechsel sind geprüft." : "Ein Filterwechsel bleibt ohne Testabdeckung.",
    diffStat: "2 files changed, 34 insertions(+), 8 deletions(-)",
    keptWorkspace: passed ? null : "/beispiel/sitzung/runs/baseline-1",
  };
}

const summary: SessionSummary = {
  workflow: "train", fineTuned: true, originalSkill, bestSkill,
  baseline, best, steps: [step], rejected: [], cancelled: false,
  sessionDir: "/beispiel/sitzung",
};

function emit(sessionId: string, event: Omit<SessionEvent, "sessionId">) {
  for (const subscriber of subscribers) subscriber({ ...event, sessionId } as SessionEvent);
}

/** Sends a deterministic sample session through the same public events as the backend. */
async function runExample(_request: TrainRequest, sessionId: string) {
  const send = (event: Record<string, unknown>) => emit(sessionId, event as Omit<SessionEvent, "sessionId">);
  send({ type: "log", message: `**Dokumentationsbeispiel · Beispieldaten**\n\n${create ? "Neuer Skill-Entwurf aus einer Beschreibung. Noch keine Leistungsmessung." : "Vorprüfung rot. Jeder Lauf arbeitet in einer eigenen Projektkopie."}` });
  if (create) {
    const skill = "---\nname: api-review\ndescription: REST-APIs auf Fehlerbehandlung und Validierung prüfen.\n---\n\n# API Review\n\n## Ablauf\n\n1. Routen und Verträge lesen.\n2. Eingabevalidierung und Fehlerantworten prüfen.\n3. Verhalten durch Tests absichern.\n\nNutze die Checkliste in `references/checkliste.md`.\n";
    send({ type: "run_activity", runId: "entwurf", title: "Optimierer · Create Skill", update: { op: "append", kind: "text", text: JSON.stringify({ reasoning: "Die Beschreibung wird in einen wiederverwendbaren Prüfablauf mit einer separaten Checkliste übersetzt.", files: [{ op: "write", path: "SKILL.md", content: skill }, { op: "write", path: "references/checkliste.md", content: "# API-Checkliste\n\n- Eingaben validieren\n- Statuscodes begründen\n- Fehlerantworten vereinheitlichen\n- Grenzfälle testen" }] }) }, settled: true });
    send({ type: "done", summary: { ...summary, workflow: "create", fineTuned: false, draft: { kind: "create", reasoning: "Skill und Checkliste sind als Entwurf vorbereitet.", skill, files: [{ path: "SKILL.md", text: skill }, { path: "references/checkliste.md", text: "# API-Checkliste\n\n- Eingaben validieren\n- Fehlerantworten testen" }] }, originalSkill: "", bestSkill: skill, bestFiles: [{ path: "SKILL.md", text: skill }, { path: "references/checkliste.md", text: "# API-Checkliste\n\n- Eingaben validieren\n- Fehlerantworten testen" }], baseline: { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 }, best: { gate: 0, hard: 0, soft: 0, runs: 0, passes: 0 }, steps: [] } });
    return { sessionDir: summary.sessionDir, sessionId };
  }
  for (const [runId, phase, passed, toolCalls] of [
    ["baseline-1", "baseline", false, 24],
    ["baseline-2", "baseline", true, 20],
    ["training-1", "train", true, 18],
    ["training-2", "train", false, 22],
  ] as const) {
    send({ type: "run_started", run: { runId, phase, ground: "repo", taskPrompt: settings.auftrag } });
    send({ type: "run_activity", runId, settled: true });
    send({ type: "run_finished", run: finished(runId, phase, passed, toolCalls) });
  }
  send({ type: "run_activity", runId: "optimierer-1", title: "Optimierer · Schritt 1", update: { op: "append", kind: "thinking", text: "Die erfolgreichen Läufe lesen zunächst die Testkonventionen. Ich ergänze diese Reihenfolge im Skill und prüfe die neue Fassung anschließend auf frischen Läufen." } });
  send({ type: "run_activity", runId: "optimierer-1", update: { op: "append", kind: "text", text: JSON.stringify({ reasoning: "Ein expliziter Ablauf macht das Testverhalten wiederholbar. Die Änderung bleibt allgemein und enthält keine Lösung für den konkreten Trainingsauftrag.", edits: [{ op: "append", content: "## Vorgehen\n\n1. Prüfe vorhandene Tests und Konventionen.\n2. Schreibe einen fehlschlagenden Verhaltenstest.\n3. Implementiere die kleinste passende Änderung.\n4. Prüfe den gezielten Test und die Testsuite.", why: "Die Baseline verpasst den Filterwechsel. Der Ablauf sichert auch Zustandsänderungen ab." }], files: [{ op: "write", path: "references/test-checkliste.md", content: "# Verhalten prüfen\n\n- Normalfall und leeren Zustand abdecken\n- Zustandswechsel prüfen\n- Vorhandene Testkonventionen beibehalten\n- Abschließend die Testsuite ausführen", why: "Eine kurze Checkliste hält den Hauptskill fokussiert." }] }) }, settled: true });
  for (const runId of ["gate-1", "gate-2"]) {
    send({ type: "run_started", run: { runId, phase: "gate", ground: "repo", taskPrompt: settings.auftrag } });
    send({ type: "run_activity", runId, settled: true });
    send({ type: "run_finished", run: finished(runId, "gate", true, 16) });
  }
  send({ type: "step", step });
  send({ type: "done", summary });
  return { sessionDir: summary.sessionDir, sessionId };
}

window.localStorage.setItem("skill-trainer.panes", JSON.stringify({ panel: 352, feed: 480 }));
window.trainer = {
  authStatus: async () => ({ state: "logged-in", email: "demo@example.com", via: "login" }),
  authLogin: async () => ({ state: "logged-in", email: "demo@example.com", via: "login" }),
  listModels: async () => ({ models: [{ id: "composer-2.5", label: "Composer 2.5" }] }),
  loadSettings: async () => settings,
  saveSettings: async () => undefined,
  listProjectSkills: async () => [{ root: settings.skillPath, name: "react-testing", relative: ".cursor/skills/react-testing" }],
  readSkill: async () => ({ name: "react-testing", chars: originalSkill.length, preview: originalSkill, root: settings.skillPath, fileCount: 2, files: ["SKILL.md", "references/test-checkliste.md"] }),
  pickSkill: async () => null,
  pickSkillDestination: async () => null,
  pickFolder: async () => null,
  start: runExample,
  cancel: async () => undefined,
  writeBack: async () => ({ backupPath: null, skillPath: settings.skillPath }),
  openPath: async () => undefined,
  pickCursorRun: async () => null,
  listCursorRuns: async () => ({ workspacePath: settings.workspacePath, runs: [], warnings: [] }),
  chooseCursorRun: async () => undefined,
  cancelCursorRun: async () => undefined,
  onEvent: (subscriber) => { subscribers.add(subscriber); return () => { subscribers.delete(subscriber); }; },
} as TrainerApi;
