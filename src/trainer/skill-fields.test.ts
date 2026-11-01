import { describe, expect, it } from "vitest";
import { translate, type Locale } from "../shared/i18n";
import { LocalizedError, localizedMessage } from "../shared/localized-error";
import type { SkillFile } from "../shared/types";
import { buildSkillFieldsPrompt, parseSkillFields, readSkillFields } from "./skill-fields";

describe("skill field draft", () => {
  it("asks for a German goal and a concrete assignment from the skill text", () => {
    const files: SkillFile[] = [{ path: "SKILL.md", text: "# Skill\n" }, { path: "scripts/run.sh", text: "echo ok\n", executable: true }];
    const prompt = buildSkillFieldsPrompt({ skill: "Lies zuerst das Logformat.", files });
    expect(prompt).toContain("Lies zuerst das Logformat.");
    expect(prompt).toContain("scripts/run.sh");
    expect(prompt).toContain('"ziel"');
    expect(prompt).toContain('"auftrag"');
    expect(prompt).toContain("plain German");
    expect(prompt).toContain("echo ok");
  });

  it.each<[Locale, string]>([
    ["de", "German"], ["en", "English"], ["fr", "French"],
    ["it", "Italian"], ["es", "Spanish"], ["nl", "Dutch"],
  ])("requests %s field content without changing the skill or JSON identifiers", (locale, language) => {
    const prompt = buildSkillFieldsPrompt({ skill: "Lies zuerst das Logformat.", locale });
    expect(prompt).toContain(`in plain ${language}`);
    expect(prompt).toContain(`one concrete assignment, in ${language},`);
    expect(prompt).toContain('"ziel": "..."');
    expect(prompt).toContain('"auftrag": "..."');
    expect(prompt).toContain("Lies zuerst das Logformat.");
  });

  it("preserves the language and text of generated fields when parsing", () => {
    expect(readSkillFields('{"ziel":"Read logs reliably.","auftrag":"Parse logs/app.log into a table."}'))
      .toEqual({ ziel: "Read logs reliably.", auftrag: "Parse logs/app.log into a table." });
  });

  it("keeps localized parser diagnostics available at the UI boundary", () => {
    const french = (error: unknown) => localizedMessage(error, (key, values) => translate("fr", key, values));
    for (const [read, key, expected] of [
      [() => parseSkillFields(null), "analysis.responseNotObject", "La réponse n’est pas un objet."],
      [() => parseSkillFields({ ziel: "Goal only" }), "analysis.missingFields", "L’objectif ou la tâche manque dans la réponse."],
      [() => readSkillFields("not json"), "analysis.incompleteJson", "La réponse ne contient pas d’objet JSON complet."],
    ] as const) {
      try {
        read();
        expect.fail("Expected field validation to reject the response");
      } catch (error) {
        expect(error).toBeInstanceOf(LocalizedError);
        expect(error).toMatchObject({ key });
        expect(french(error)).toBe(expected);
      }
    }
  });

  it("reads the JSON object even when the model wraps it", () => {
    const text = "Hier die Felder:\n```json\n{ \"ziel\": \"Logs zuverlässig lesen.\", \"auftrag\": \"Parse logs/app.log zu einer Tabelle.\" }\n```";
    expect(readSkillFields(text)).toEqual({
      ziel: "Logs zuverlässig lesen.",
      auftrag: "Parse logs/app.log zu einer Tabelle.",
    });
  });

  it("accepts English keys and rejects an empty assignment", () => {
    expect(parseSkillFields({ goal: "Zweck.", task: "Tu das." })).toEqual({ ziel: "Zweck.", auftrag: "Tu das." });
    expect(() => parseSkillFields({ ziel: "Zweck.", auftrag: "  " })).toThrow(/fehlt/);
    expect(() => readSkillFields("kein json")).toThrow(/JSON/);
  });
});
