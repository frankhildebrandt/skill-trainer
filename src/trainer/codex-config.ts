import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LocalizedError } from "../shared/localized-error";
import type { CodexAppServer } from "./codex-client";

const runFile = promisify(execFile);
const checked = new Set<string>();

/** Finds CLI installations when Electron was launched with a minimal desktop PATH. */
export function codexBinary(): string {
  if (process.env.CODEX_APP_SERVER_BIN?.trim()) return process.env.CODEX_APP_SERVER_BIN;
  const names = process.platform === "win32" ? ["codex.exe"] : ["codex"];
  const directories = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin", "/usr/local/bin",
  ];
  for (const directory of directories) {
    for (const name of names) {
      const binary = path.join(directory, name);
      if (existsSync(binary)) return binary;
    }
  }
  return "codex";
}

/** Restricted runs require environment disabling rather than ignored, newer RPC fields. */
export async function requireCodexVersion(): Promise<void> {
  const binary = codexBinary();
  if (checked.has(binary)) return;
  const { stdout } = await runFile(binary, ["--version"], { timeout: 10_000 });
  const version = /codex-cli\s+(\d+)\.(\d+)\.(\d+)/.exec(stdout);
  if (!version || (Number(version[1]) === 0 && Number(version[2]) < 166)) {
    throw new LocalizedError("codex.unsupportedVersion");
  }
  checked.add(binary);
}

export function inferenceConfig(nativeEnvironment: boolean): Record<string, unknown> {
  return {
    web_search: "disabled",
    project_doc_max_bytes: 0,
    "features.shell_tool": nativeEnvironment,
    "features.view_image": nativeEnvironment,
    "features.skip_host_skill_discovery": true,
    ...Object.fromEntries([
      "apps", "plugins", "remote_plugin", "browser_use", "computer_use", "image_generation",
      "artifact", "multi_agent", "multi_agent_v2", "code_mode", "memories", "hooks", "skill_search",
    ].map((name) => [`features.${name}`, false])),
  };
}

/** Applies per-thread overrides without changing the user's Codex configuration. */
export async function isolatedThreadConfig(client: CodexAppServer, cwd: string): Promise<Record<string, unknown>> {
  const config = await client.request<{ config: { mcp_servers?: Record<string, Record<string, unknown>> } }>("config/read", { includeLayers: false });
  const skills = await client.request<{ data: Array<{ skills: Array<{ path: string }> }> }>("skills/list", { cwds: [cwd] });
  return {
    mcp_servers: withoutNulls(Object.fromEntries(Object.entries(config.config.mcp_servers ?? {}).map(([name, server]) => [name, { ...server, enabled: false }]))),
    "skills.config": skills.data.flatMap((entry) => entry.skills.map((skill) => ({ path: skill.path, enabled: false }))),
  };
}

/** Config reads include optional nulls, which cannot be round-tripped through TOML overrides. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((entry) => entry !== null).map(withoutNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, withoutNulls(entry)]));
}
