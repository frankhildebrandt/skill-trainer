import { LocalizedError } from "../shared/localized-error";
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  const lanes = Math.max(1, Math.min(limit, items.length));

  async function lane(): Promise<void> {
    for (;;) {
      if (failed) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index] as T, index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new LocalizedError("diagnostics.cancelled");
    error.name = "AbortError";
    throw error;
  }
}
