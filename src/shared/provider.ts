export const PROVIDERS = {
  cursor: { label: "Cursor", baseUrl: "", apiKeyEnv: "" },
  codex: { label: "Codex App Server", baseUrl: "", apiKeyEnv: "" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", apiKeyEnv: "" },
  mlx: { label: "MLX", baseUrl: "http://localhost:8080/v1", apiKeyEnv: "" },
  lmstudio: { label: "LM Studio", baseUrl: "http://localhost:1234/v1", apiKeyEnv: "" },
  compatible: { label: "OpenAI-compatible", baseUrl: "http://localhost:8000/v1", apiKeyEnv: "" },
} as const;

export type ProviderKind = keyof typeof PROVIDERS;
export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl?: string;
  /** Name only. The secret is read in the main process and never saved in sessions. */
  apiKeyEnv?: string;
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

/** Restores endpoint configurations and the original Cursor/Codex string settings. */
export function restoreProvider(raw: unknown): ProviderConfig {
  const value = typeof raw === "string" ? { kind: raw } : raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const kind = isProviderKind(value.kind) ? value.kind : "cursor";
  return {
    kind,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : PROVIDERS[kind].baseUrl,
    apiKeyEnv: typeof value.apiKeyEnv === "string" ? value.apiKeyEnv : PROVIDERS[kind].apiKeyEnv,
  };
}
