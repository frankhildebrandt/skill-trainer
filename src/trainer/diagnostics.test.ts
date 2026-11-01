import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { translate, type Locale } from "../shared/i18n";
import { LocalizedError, localizedMessage } from "../shared/localized-error";
import { performAttempt } from "./attempt";
import { assertChecks } from "./checks";
import { assertSafeWorkspace } from "./isolate";
import { extractJson } from "./json";
import { isAbortError, throwIfAborted } from "./pool";
import { saveSkillOutput } from "./skill-output";
import { runVerify } from "./verify";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function captured(work: () => void): LocalizedError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(LocalizedError);
    return error as LocalizedError;
  }
  throw new Error("Expected a diagnostic");
}

function t(locale: Locale) {
  return (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate(locale, key, values);
}

describe("runtime diagnostics", () => {
  it("localizes rejected check paths while retaining the exact diagnostic path", () => {
    const file = ".skill-trainer/checks/../../références/{count}.sh";
    const error = captured(() => assertChecks([{ path: file, text: "exit 1" }]));
    expect(error.key).toBe("diagnostics.checkOutside");
    expect(error.message).toBe(`Prüfdatei liegt außerhalb von .skill-trainer/checks: ${file}`);
    expect(localizedMessage(error, t("fr"))).toBe(`Le fichier de vérification est en dehors de .skill-trainer/checks : ${file}`);
    expect(localizedMessage(error, t("nl"))).toBe(`Controlebestand staat buiten .skill-trainer/checks: ${file}`);
  });

  it("localizes workspace and optimizer response validation at the display boundary", () => {
    const workspace = captured(() => assertSafeWorkspace(os.homedir()));
    expect(localizedMessage(workspace, t("es"))).toBe("Esta carpeta es demasiado amplia. Elige la carpeta del proyecto en lugar de tu carpeta personal.");
    const json = captured(() => extractJson("No JSON returned"));
    expect(localizedMessage(json, t("it"))).toBe("La risposta dell’ottimizzatore non contiene un oggetto JSON completo.");
  });

  it("retains abort classification after localizing its message", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = captured(() => throwIfAborted(controller.signal));
    expect(isAbortError(error)).toBe(true);
    expect(error.name).toBe("AbortError");
    expect(localizedMessage(error, t("en"))).toBe("Cancelled");
    expect(await runVerify("exit 0", os.tmpdir(), 1000, controller.signal, t("fr")))
      .toEqual({ exitCode: null, output: "annulé" });
  });

  it("localizes a rejected save without creating any destination files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-diagnostic-save-"));
    roots.push(root);
    const error = await saveSkillOutput({ destination: path.join(root, "skill"), create: true, stamp: "now", files: [] })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(LocalizedError);
    expect(localizedMessage(error, t("en"))).toBe("The skill requires a nonempty SKILL.md.");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("localizes cancelled attempt status while leaving the agent response untouched", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-diagnostic-attempt-"));
    roots.push(root);
    const response = "Original agent response: Überprüfung";
    const run = await performAttempt({
      translate: t("fr"),
      runId: "cancelled-run", phase: "train", ground: "empty", workspacePath: "/project", runDir: root,
      skill: "# Helper", files: [{ path: "SKILL.md", text: "# Helper" }], skillRoot: "/external-skill", skillPath: "/external-skill",
      taskPrompt: "Original user task", model: "test", verifyCommand: "exit 0", verifyTimeoutMs: 1000, attemptTimeoutMs: 1000,
      signal: new AbortController().signal,
      execute: async () => ({ status: "cancelled", finalText: response, transcript: "original transcript", toolCalls: 0, durationMs: 1 }),
    });
    expect(run.score.status).toBe("cancelled");
    expect(run.score.hard).toBe(0);
    expect(run.score.verifyOutput).toBe("Exécution annulée, la commande de vérification n’a pas été lancée.");
    expect(run.taskPrompt).toBe("Original user task");
    expect(run.summary).toContain(response);
    expect(run.keptWorkspace).toBeNull();
  });
});
