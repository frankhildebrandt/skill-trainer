import { describe, expect, it } from "vitest";
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
