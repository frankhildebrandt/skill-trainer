import { describe, expect, it } from "vitest";
import {
  assignmentText,
  cursorProjectSlug,
  dedupeRuns,
  filterCursorRuns,
  messageText,
  normalizeRepoUrl,
  parseRemotes,
  parseWorktrees,
  runsFromMessages,
  sameRepo,
  type CursorRunOption,
} from "./cursor-runs";

describe("cursor project slug", () => {
  it("matches Cursor's project folder names", () => {
    expect(cursorProjectSlug("/Users/frank/.t3/worktrees/skill-trainer/t3-51aea825")).toBe(
      "Users-frank-t3-worktrees-skill-trainer-t3-51aea825",
    );
    expect(cursorProjectSlug("/Users/frank/Library/Application Support/skill-trainer/sessions/2026-10-31T13:30:42.352Z/runs/train-3/workspace/")).toBe(
      "Users-frank-Library-Application-Support-skill-trainer-sessions-2026-10-31T13-30-42-352Z-runs-train-3-workspace",
    );
  });
});

describe("repository urls", () => {
  it("treats ssh, https, and .git suffixes as the same repo", () => {
    expect(normalizeRepoUrl("git@github.com:acme/widgets.git")).toBe("github.com/acme/widgets");
    expect(sameRepo("https://github.com/acme/widgets.git", "ssh://git@github.com/acme/widgets")).toBe(true);
    expect(sameRepo("https://github.com/acme/widgets", "https://github.com/acme/other")).toBe(false);
  });

  it("parses git worktree and remote output", () => {
    expect(parseWorktrees("worktree /tmp/main\nHEAD abc\n\nworktree /tmp/feature\n")).toEqual(["/tmp/main", "/tmp/feature"]);
    expect(parseRemotes("origin\tgit@github.com:acme/widgets.git (fetch)\norigin\tgit@github.com:acme/widgets.git (push)\n")).toEqual([
      "git@github.com:acme/widgets.git",
    ]);
  });
});

describe("assignment text", () => {
  it("keeps the user query and drops Cursor wrappers", () => {
    const raw = "<manually_attached_skills>\nskill\n</manually_attached_skills>\n<user_query>\nSchreibe den Parser.\n</user_query>";
    expect(assignmentText(raw)).toBe("Schreibe den Parser.");
    expect(assignmentText("Baue das Modul.")).toBe("Baue das Modul.");
    expect(assignmentText("<system>hidden</system>")).toBe("");
  });

  it("reads nested message text", () => {
    expect(messageText({ message: { content: [{ type: "text", text: "Hallo" }] } })).toBe("Hallo");
  });
});

describe("run search", () => {
  const runs = runsFromMessages({
    idPrefix: "chat",
    runtime: "local",
    place: "widgets",
    createdAt: 10,
    messages: [
      { role: "user", text: "<user_query>Schreibe den Parser.</user_query>" },
      { role: "assistant", text: "Der Parser akzeptiert leere Dateien." },
      { role: "user", text: "Ergänze einen Test." },
    ],
  });

  it("splits each user message into its own run and keeps the reply searchable", () => {
    expect(runs.map((run) => run.prompt)).toEqual(["Schreibe den Parser.", "Ergänze einen Test."]);
    expect(filterCursorRuns(runs, "leere Dateien", "all")).toHaveLength(1);
    expect(filterCursorRuns(runs, "parser test", "all")).toHaveLength(0);
    expect(filterCursorRuns(runs, "Parser", "cloud")).toHaveLength(0);
  });

  it("drops duplicate prompts and keeps the newer one", () => {
    const older: CursorRunOption = { ...runs[0]!, id: "old", createdAt: 1 };
    const newer: CursorRunOption = { ...runs[0]!, id: "new", createdAt: 50 };
    expect(dedupeRuns([older, newer]).map((run) => run.id)).toEqual(["new"]);
  });
});
