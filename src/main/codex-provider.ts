import type { AuthStatus, ModelOption } from "../shared/types";
import { LocalizedError } from "../shared/localized-error";
import { CodexAppServer } from "../trainer/codex-client";

interface AccountResponse {
  account: { type: string; email?: string | null } | null;
  requiresOpenaiAuth: boolean;
}

interface ModelPage {
  data: Array<{ id: string; model?: string; displayName: string; hidden?: boolean }>;
  nextCursor: string | null;
}

interface LoginCompletion {
  loginId: string | null;
  success: boolean;
  error?: string | null;
}

/** Reads the account managed by the locally installed Codex CLI. */
export async function readCodexAuth(): Promise<AuthStatus> {
  const client = await CodexAppServer.connect();
  try {
    return accountStatus(await client.request<AccountResponse>("account/read", { refreshToken: false }));
  } finally {
    await client.close();
  }
}

/** Opens Codex's login page and keeps its callback server alive until login completes. */
export async function loginCodex(openBrowser: (url: string) => Promise<unknown>): Promise<AuthStatus> {
  const signal = AbortSignal.timeout(180_000);
  const client = await CodexAppServer.connect({ signal });
  const completions: LoginCompletion[] = [];
  let notify: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let failure: Error | undefined;
  let loginId: string | undefined;
  let loggedIn = false;
  const unsubscribe = client.subscribe((message) => {
    if (message.method !== "account/login/completed") return;
    completions.push(message.params as LoginCompletion);
    notify?.();
  });
  const unsubscribeFailure = client.subscribeFailure((error) => {
    failure = error;
    notify?.();
  });
  try {
    const login = await client.request<{ type: string; loginId: string; authUrl: string }>("account/login/start", { type: "chatgpt" });
    if (login.type !== "chatgpt" || !login.loginId || !login.authUrl) throw new LocalizedError("codex.loginFailed");
    loginId = login.loginId;
    await openBrowser(login.authUrl);
    const completion = await new Promise<LoginCompletion>((resolve, reject) => {
      const check = () => {
        const done = completions.find((item) => item.loginId === loginId);
        if (done) resolve(done);
        else if (signal.aborted) reject(new LocalizedError("codex.loginTimeout"));
        else if (failure) reject(failure);
      };
      notify = check;
      onAbort = check;
      signal.addEventListener("abort", check, { once: true });
      check();
    });
    if (!completion.success) throw new LocalizedError("codex.loginFailed");
    loggedIn = true;
    return accountStatus(await client.request<AccountResponse>("account/read", { refreshToken: false }));
  } catch (error) {
    if (signal.aborted) throw new LocalizedError("codex.loginTimeout");
    throw error;
  } finally {
    notify = undefined;
    if (onAbort) signal.removeEventListener("abort", onAbort);
    unsubscribe();
    unsubscribeFailure();
    if (loginId && !loggedIn) await client.request("account/login/cancel", { loginId }).catch(() => undefined);
    await client.close();
  }
}

/** Loads every visible catalog page and uses the inference slug as the model ID. */
export async function listCodexModels(): Promise<ModelOption[]> {
  const client = await CodexAppServer.connect();
  try {
    const models = new Map<string, ModelOption>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: ModelPage = await client.request<ModelPage>("model/list", { cursor, includeHidden: false });
      for (const model of page.data) {
        const id = model.model || model.id;
        if (!model.hidden) models.set(id, { id, label: model.displayName || id });
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new LocalizedError("codex.invalidCatalog");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  } finally {
    await client.close();
  }
}

function accountStatus(response: AccountResponse): AuthStatus {
  if (response.account) {
    return { state: "logged-in", email: response.account.email ?? null, via: response.account.type === "apiKey" ? "env" : "login" };
  }
  return { state: response.requiresOpenaiAuth ? "logged-out" : "logged-in", email: null, via: "none" };
}
