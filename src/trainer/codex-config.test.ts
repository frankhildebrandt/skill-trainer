import { describe, expect, it, vi } from "vitest";
import type { CodexAppServer } from "./codex-client";
import { isolatedThreadConfig } from "./codex-config";

describe("Codex inference configuration", () => {
  it("disables configured MCP servers with intact transports and TOML-compatible values", async () => {
    const request = vi.fn().mockResolvedValueOnce({ config: { mcp_servers: {
      "server.with.dots": { command: "test-server", args: [], enabled: true, tool_timeout_sec: null, env: null },
      remote: { url: "https://example.test/mcp", http_headers: { "X-Optional": null }, enabled: true },
    } } }).mockResolvedValueOnce({ data: [{ skills: [{ path: "/skills/example/SKILL.md" }] }] });
    const config = await isolatedThreadConfig({ request } as unknown as CodexAppServer, "/project");
    expect(config).toEqual({
      mcp_servers: {
        "server.with.dots": { command: "test-server", args: [], enabled: false },
        remote: { url: "https://example.test/mcp", http_headers: {}, enabled: false },
      },
      "skills.config": [{ path: "/skills/example/SKILL.md", enabled: false }],
    });
    expect(request).toHaveBeenCalledWith("skills/list", { cwds: ["/project"] });
  });

  it("handles a Codex installation with no MCP servers or skills", async () => {
    const request = vi.fn().mockResolvedValueOnce({ config: {} }).mockResolvedValueOnce({ data: [] });
    await expect(isolatedThreadConfig({ request } as unknown as CodexAppServer, "/project")).resolves.toEqual({ mcp_servers: {}, "skills.config": [] });
  });
});
