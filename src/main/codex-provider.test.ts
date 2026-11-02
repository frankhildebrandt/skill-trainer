import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCodexModels, loginCodex, readCodexAuth } from "./codex-provider";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  notifications: new Set<(message: { method: string; params?: unknown }) => void>(),
  failures: new Set<(error: Error) => void>(),
}));

vi.mock("../trainer/codex-client", () => ({
  CodexAppServer: { connect: mocks.connect },
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.notifications.clear();
  mocks.failures.clear();
  mocks.request.mockReset();
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.connect.mockReset().mockResolvedValue({
    request: mocks.request,
    close: mocks.close,
    subscribe: (callback: (message: { method: string; params?: unknown }) => void) => {
      mocks.notifications.add(callback);
      return () => mocks.notifications.delete(callback);
    },
    subscribeFailure: (callback: (error: Error) => void) => {
      mocks.failures.add(callback);
      return () => mocks.failures.delete(callback);
    },
  });
});

function complete(loginId: string, success: boolean) {
  for (const callback of mocks.notifications) callback({ method: "account/login/completed", params: { loginId, success } });
}

describe("Codex account and model catalog", () => {
  it("reads an existing ChatGPT login and disposes the process", async () => {
    mocks.request.mockResolvedValue({ account: { type: "chatgpt", email: "trainer@example.com" }, requiresOpenaiAuth: true });
    await expect(readCodexAuth()).resolves.toEqual({ state: "logged-in", email: "trainer@example.com", via: "login" });
    expect(mocks.request).toHaveBeenCalledWith("account/read", { refreshToken: false });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("distinguishes missing credentials from a provider that needs no OpenAI login", async () => {
    mocks.request.mockResolvedValueOnce({ account: null, requiresOpenaiAuth: true })
      .mockResolvedValueOnce({ account: null, requiresOpenaiAuth: false });
    await expect(readCodexAuth()).resolves.toMatchObject({ state: "logged-out" });
    await expect(readCodexAuth()).resolves.toMatchObject({ state: "logged-in" });
  });

  it("loads all model pages, filters hidden entries and uses inference slugs", async () => {
    mocks.request.mockResolvedValueOnce({ data: [
      { id: "catalog-entry", model: "model-a", displayName: "Model A" },
      { id: "hidden", displayName: "Hidden", hidden: true },
    ], nextCursor: "page-2" }).mockResolvedValueOnce({ data: [
      { id: "model-b", displayName: "Model B" },
    ], nextCursor: null });
    await expect(listCodexModels()).resolves.toEqual([{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }]);
    expect(mocks.request).toHaveBeenLastCalledWith("model/list", { cursor: "page-2", includeHidden: false });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects repeating catalog cursors instead of looping indefinitely", async () => {
    mocks.request.mockResolvedValue({ data: [], nextCursor: "same-page" });
    await expect(listCodexModels()).rejects.toMatchObject({ key: "codex.invalidCatalog" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("disposes the client after account or model failures", async () => {
    mocks.request.mockRejectedValue(new Error("Disconnected"));
    await expect(readCodexAuth()).rejects.toThrow("Disconnected");
    await expect(listCodexModels()).rejects.toThrow("Disconnected");
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});

describe("Codex browser login", () => {
  it("keeps the process alive until the matching completion notification", async () => {
    mocks.request.mockImplementation(async (method: string) => method === "account/login/start"
      ? { type: "chatgpt", loginId: "our-login", authUrl: "https://auth.openai.com/login" }
      : { account: { type: "chatgpt", email: "trainer@example.com" }, requiresOpenaiAuth: true });
    let browserOpened: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => { browserOpened = resolve; });
    const open = vi.fn(async () => { browserOpened(); });
    const signingIn = loginCodex(open);
    await opened;
    complete("another-login", true);
    expect(mocks.close).not.toHaveBeenCalled();
    complete("our-login", true);
    await expect(signingIn).resolves.toMatchObject({ state: "logged-in", email: "trainer@example.com" });
    expect(open).toHaveBeenCalledWith("https://auth.openai.com/login");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.notifications.size).toBe(0);
    expect(mocks.failures.size).toBe(0);
  });

  it("handles completion arriving before login/start returns", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "account/login/start") {
        complete("fast-login", true);
        return { type: "chatgpt", loginId: "fast-login", authUrl: "https://auth.openai.com/login" };
      }
      return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
    });
    await expect(loginCodex(async () => undefined)).resolves.toMatchObject({ state: "logged-in" });
  });

  it("cleans up a failed login", async () => {
    mocks.request.mockResolvedValue({ type: "chatgpt", loginId: "failed-login", authUrl: "https://auth.openai.com/login" });
    await expect(loginCodex(async () => { complete("failed-login", false); })).rejects.toMatchObject({ key: "codex.loginFailed" });
    expect(mocks.request).toHaveBeenLastCalledWith("account/login/cancel", { loginId: "failed-login" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects when the app-server exits during login", async () => {
    mocks.request.mockResolvedValue({ type: "chatgpt", loginId: "login", authUrl: "https://auth.openai.com/login" });
    await expect(loginCodex(async () => {
      for (const callback of mocks.failures) callback(new Error("App server exited"));
    })).rejects.toThrow("App server exited");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects a browser-launch failure and cancels the pending login", async () => {
    mocks.request.mockResolvedValue({ type: "chatgpt", loginId: "login", authUrl: "https://auth.openai.com/login" });
    await expect(loginCodex(async () => { throw new Error("Cannot open browser"); })).rejects.toThrow("Cannot open browser");
    expect(mocks.request).toHaveBeenLastCalledWith("account/login/cancel", { loginId: "login" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("times out waiting for the callback", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    mocks.request.mockResolvedValue({ type: "chatgpt", loginId: "login", authUrl: "https://auth.openai.com/login" });
    await expect(loginCodex(async () => { timeout.abort(); })).rejects.toMatchObject({ key: "codex.loginTimeout" });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
