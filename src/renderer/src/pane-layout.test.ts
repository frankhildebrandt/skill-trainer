import { describe, expect, it } from "vitest";
import { clampSizes, DEFAULT_SIZES, feedMax, PANE_LIMITS, panelMax, readSizes } from "./pane-layout";

describe("clampSizes", () => {
  it("keeps sizes that already fit", () => {
    expect(clampSizes({ panel: 300, feed: 420 }, 1400)).toEqual({ panel: 300, feed: 420 });
  });

  it("enforces the minimum of each pane", () => {
    expect(clampSizes({ panel: 10, feed: 10 }, 1400)).toEqual({ panel: PANE_LIMITS.panelMin, feed: PANE_LIMITS.feedMin });
  });

  it("shrinks the feed first so the log pane keeps its minimum", () => {
    const next = clampSizes({ panel: 300, feed: 900 }, 1100);
    expect(next.panel).toBe(300);
    expect(1100 - 2 * PANE_LIMITS.handle - next.panel - next.feed).toBe(PANE_LIMITS.logsMin);
  });

  it("caps the side panel so feed and logs still fit", () => {
    const next = clampSizes({ panel: 2000, feed: 0 }, 1000);
    expect(next.panel).toBe(panelMax(1000));
    expect(next.feed).toBe(PANE_LIMITS.feedMin);
    expect(next.panel + next.feed + PANE_LIMITS.logsMin + 2 * PANE_LIMITS.handle).toBeLessThanOrEqual(1000);
  });

  it("never goes below the minimums on a tiny window", () => {
    expect(clampSizes({ panel: 400, feed: 400 }, 300)).toEqual({ panel: PANE_LIMITS.panelMin, feed: PANE_LIMITS.feedMin });
  });
});

describe("feedMax", () => {
  it("leaves room for the log pane", () => {
    expect(feedMax(300, 1400)).toBe(1400 - 2 * PANE_LIMITS.handle - 300 - PANE_LIMITS.logsMin);
  });
});

describe("readSizes", () => {
  it("falls back to the defaults on missing or broken input", () => {
    expect(readSizes(null)).toEqual(DEFAULT_SIZES);
    expect(readSizes("{")).toEqual(DEFAULT_SIZES);
    expect(readSizes('{"panel":"x","feed":3}')).toEqual(DEFAULT_SIZES);
  });

  it("reads stored sizes", () => {
    expect(readSizes('{"panel":320,"feed":480}')).toEqual({ panel: 320, feed: 480 });
  });
});
