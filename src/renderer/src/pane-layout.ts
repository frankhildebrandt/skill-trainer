export interface PaneSizes {
  panel: number;
  feed: number;
}

export const PANE_LIMITS = {
  panelMin: 248,
  panelMax: 560,
  feedMin: 260,
  logsMin: 340,
  handle: 1,
} as const;

export const DEFAULT_SIZES: PaneSizes = { panel: 304, feed: 440 };

/** Fits both sizes into the layout width so the log pane never drops below its minimum. */
export function clampSizes(sizes: PaneSizes, total: number): PaneSizes {
  const room = Math.max(0, total - 2 * PANE_LIMITS.handle);
  const panelMax = Math.min(PANE_LIMITS.panelMax, room - PANE_LIMITS.feedMin - PANE_LIMITS.logsMin);
  const panel = clamp(sizes.panel, PANE_LIMITS.panelMin, Math.max(PANE_LIMITS.panelMin, panelMax));
  const feedMax = room - panel - PANE_LIMITS.logsMin;
  const feed = clamp(sizes.feed, PANE_LIMITS.feedMin, Math.max(PANE_LIMITS.feedMin, feedMax));
  return { panel: Math.round(panel), feed: Math.round(feed) };
}

export function feedMax(panel: number, total: number): number {
  return Math.max(PANE_LIMITS.feedMin, total - 2 * PANE_LIMITS.handle - panel - PANE_LIMITS.logsMin);
}

export function panelMax(total: number): number {
  const room = total - 2 * PANE_LIMITS.handle - PANE_LIMITS.feedMin - PANE_LIMITS.logsMin;
  return Math.max(PANE_LIMITS.panelMin, Math.min(PANE_LIMITS.panelMax, room));
}

export function readSizes(raw: string | null): PaneSizes {
  if (!raw) return DEFAULT_SIZES;
  try {
    const parsed = JSON.parse(raw) as Partial<PaneSizes>;
    const panel = Number(parsed.panel);
    const feed = Number(parsed.feed);
    if (!Number.isFinite(panel) || !Number.isFinite(feed)) return DEFAULT_SIZES;
    return { panel, feed };
  } catch {
    return DEFAULT_SIZES;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
