import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clampSizes, DEFAULT_SIZES, feedMax, PANE_LIMITS, panelMax, readSizes, type PaneSizes } from "./pane-layout";

const STORAGE_KEY = "skill-trainer.panes";

export function usePaneSizes(container: RefObject<HTMLElement | null>) {
  const [stored, setStored] = useState<PaneSizes>(() => readSizes(safeRead()));
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [container]);

  useEffect(() => {
    const timer = setTimeout(() => safeWrite(JSON.stringify(stored)), 200);
    return () => clearTimeout(timer);
  }, [stored]);

  const sizes = width > 0 ? clampSizes(stored, width) : stored;

  const setPanel = useCallback(
    (panel: number) => setStored((prev) => (width > 0 ? clampSizes({ ...prev, panel }, width) : { ...prev, panel })),
    [width],
  );
  const setFeed = useCallback(
    (feed: number) => setStored((prev) => (width > 0 ? clampSizes({ ...prev, feed }, width) : { ...prev, feed })),
    [width],
  );

  return {
    sizes,
    setPanel,
    setFeed,
    limits: {
      panel: { min: PANE_LIMITS.panelMin, max: panelMax(width), initial: DEFAULT_SIZES.panel },
      feed: { min: PANE_LIMITS.feedMin, max: feedMax(sizes.panel, width), initial: DEFAULT_SIZES.feed },
    },
  };
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  initial,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  initial: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("is-resizing", dragging);
    return () => document.body.classList.remove("is-resizing");
  }, [dragging]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startValue: value };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onChange(drag.current.startValue + event.clientX - drag.current.startX);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") onChange(value - step);
    else if (event.key === "ArrowRight") onChange(value + step);
    else if (event.key === "Home") onChange(min);
    else if (event.key === "End") onChange(max);
    else if (event.key === "Enter") onChange(initial);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · ziehen, Doppelklick setzt zurück`}
      className={dragging ? "resizer dragging" : "resizer"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
    >
      <span className="grip" aria-hidden="true" />
    </div>
  );
}

function safeRead(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeWrite(value: string) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable; the layout then resets on the next start.
  }
}
