import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cursorProjectSlug } from "../shared/cursor-runs";
import { listRepoRuns, parseTranscript, readCheckoutTranscripts, type RepoRunDeps } from "./repo-runs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("local transcripts", () => {
  it("reads user queries from the Cursor project folder of a checkout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-runs-"));
    roots.push(root);
    const checkout = path.join(root, "widgets");
    await fs.mkdir(checkout);
    const transcript = path.join(root, "projects", cursorProjectSlug(checkout), "agent-transcripts", "chat-1", "chat-1.jsonl");
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    await fs.writeFile(transcript, [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "<user_query>\nSchreibe den Parser.\n</user_query>" }] } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Der Parser akzeptiert leere Dateien." }] } }),
      "",
    ].join("\n"));

    const runs = await readCheckoutTranscripts(checkout, path.join(root, "projects"));
    expect(runs.map((run) => run.prompt)).toEqual(["Schreibe den Parser."]);
    expect(runs[0]?.searchText).toContain("leere Dateien");
    expect(parseTranscript("not json\n")).toEqual([]);
  });
});

describe("repo catalog", () => {
  it("keeps local runs and cloud agents of this repo, and searches the reply text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-catalog-"));
    roots.push(root);
    const checkout = path.join(root, "widgets");
    await fs.mkdir(checkout);
    const deps: RepoRunDeps = {
      projectsRoot: path.join(root, "projects"),
      checkouts: async () => ({ paths: [checkout], remotes: ["git@github.com:acme/widgets.git"] }),
      localAgents: async () => [{ agentId: "local-1", name: "Lokal", summary: "", repos: [], lastModified: 20 }],
      localMessages: async () => [{ role: "user", text: "Lokaler SDK-Auftrag." }],
      cloudAgents: async () => [
        { agentId: "bc-match", name: "Cloud", summary: "Zusammenfassung", repos: ["https://github.com/acme/widgets.git"], lastModified: 30 },
        { agentId: "bc-other", name: "Fremd", summary: "Anderes Repo", repos: ["https://github.com/acme/other"], lastModified: 40 },
      ],
      cloudRuns: async (agentId) => agentId === "bc-match"
        ? [{ id: "run-1", createdAt: 35, messages: [
          { role: "user", text: "Migriere die Anmeldung." },
          { role: "assistant", text: "Die Session-API bleibt erhalten." },
        ] }]
        : [],
    };

    const catalog = await listRepoRuns(checkout, deps);
    expect(catalog.warnings).toEqual([]);
    expect(catalog.runs.map((run) => run.prompt).sort()).toEqual(["Lokaler SDK-Auftrag.", "Migriere die Anmeldung."]);
    expect(catalog.runs.find((run) => run.runtime === "cloud")?.place).toBe("acme/widgets");
    expect(catalog.runs.some((run) => run.prompt.includes("Anderes Repo"))).toBe(false);
    expect(catalog.runs.find((run) => run.prompt.startsWith("Migriere"))?.searchText).toContain("Session-API");
  });

  it("reports a missing remote instead of listing every cloud agent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-catalog-"));
    roots.push(root);
    const checkout = path.join(root, "plain");
    await fs.mkdir(checkout);
    let cloudCalled = false;
    const catalog = await listRepoRuns(checkout, {
      projectsRoot: path.join(root, "missing"),
      checkouts: async () => ({ paths: [checkout], remotes: [] }),
      localAgents: async () => [],
      localMessages: async () => [],
      cloudAgents: async () => { cloudCalled = true; return []; },
      cloudRuns: async () => [],
    });
    expect(cloudCalled).toBe(false);
    expect(catalog.warnings.some((warning) => warning.includes("Git-Remote"))).toBe(true);
  });
});

describe("localized catalog warnings", () => {
  it("uses the requested language for missing-remote warnings and preserves SDK error text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-catalog-locale-"));
    roots.push(root);
    const checkout = path.join(root, "widgets");
    await fs.mkdir(checkout);
    const deps: RepoRunDeps = {
      projectsRoot: path.join(root, "missing"),
      checkouts: async () => ({ paths: [checkout], remotes: [] }),
      localAgents: async () => { throw new Error("SDK diagnostic stays unchanged"); },
      localMessages: async () => [],
      cloudAgents: async () => { throw new Error("Cloud should not be called"); },
      cloudRuns: async () => [],
    };
    const expected = {
      de: "Ohne Git-Remote lassen sich Cloud-Agents diesem Repo nicht zuordnen.",
      en: "A Git remote is required to match cloud agents to this repository.",
      fr: "Un dépôt Git distant est nécessaire pour associer les agents cloud à ce dépôt.",
      it: "È necessario un remote Git per associare gli agenti cloud a questo repository.",
      es: "Se necesita un remoto Git para asociar los agentes en la nube a este repositorio.",
      nl: "Een Git-remote is nodig om cloudagents aan deze repository te koppelen.",
    } as const;
    for (const locale of Object.keys(expected) as Array<keyof typeof expected>) {
      const catalog = await listRepoRuns(checkout, deps, "all", locale);
      expect(catalog.warnings).toContain(expected[locale]);
      expect(catalog.warnings[0]).toContain("widgets");
      expect(catalog.warnings[0]).toContain("SDK diagnostic stays unchanged");
      expect(catalog.warnings).toHaveLength(2);
    }
  });

  it("localizes per-agent cloud warnings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-catalog-locale-"));
    roots.push(root);
    const catalog = await listRepoRuns(root, {
      projectsRoot: path.join(root, "missing"),
      checkouts: async () => ({ paths: [root], remotes: ["https://github.com/acme/widgets"] }),
      localAgents: async () => [],
      localMessages: async () => [],
      cloudAgents: async () => [{
        agentId: "agent-1", name: "My agent", summary: "", repos: ["https://github.com/acme/widgets"], lastModified: 1,
      }],
      cloudRuns: async () => { throw new Error("SDK diagnostic"); },
    }, "cloud", "fr");
    expect(catalog.warnings).toEqual(["Agent cloud My agent : SDK diagnostic"]);
  });
});
