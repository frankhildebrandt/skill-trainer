export const PROVIDERS = {
  cursor: { label: "Cursor", baseUrl: "", apiKeyEnv: "" },
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

export function restoreProvider(raw: unknown): ProviderConfig {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const kind = typeof value.kind === "string" && Object.hasOwn(PROVIDERS, value.kind) ? value.kind as ProviderKind : "cursor";
  return {
    kind,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : PROVIDERS[kind].baseUrl,
    apiKeyEnv: typeof value.apiKeyEnv === "string" ? value.apiKeyEnv : PROVIDERS[kind].apiKeyEnv,
  };
}
