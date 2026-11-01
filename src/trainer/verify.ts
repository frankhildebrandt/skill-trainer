import { translate, type Translate } from "../shared/i18n";
import { spawn } from "node:child_process";

export interface VerifyResult {
  exitCode: number | null;
  output: string;
}

export function runVerify(command: string, cwd: string, timeoutMs: number, signal: AbortSignal, t: Translate = (key, values) => translate("de", key, values)): Promise<VerifyResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ exitCode: null, output: t("diagnostics.verifyCancelled") });
      return;
    }

    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const take = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 20_000) output = output.slice(-20_000);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ exitCode: null, output: err.message });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, output: output.trim() });
    });
  });
}
