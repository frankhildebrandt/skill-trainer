export interface ClockRun {
  startedAt?: number;
  endedAt?: number;
  trajectory?: { score: { durationMs: number } };
}

export function runDuration(run: ClockRun, now: number): string {
  const ms =
    run.trajectory && run.trajectory.score.durationMs > 0
      ? run.trajectory.score.durationMs
      : run.startedAt
        ? Math.max(0, (run.endedAt ?? now) - run.startedAt)
        : 0;
  if (ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}
