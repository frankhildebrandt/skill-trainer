import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { dedupeRuns, filterCursorRuns, matchSnippet, searchTerms, type CursorRunCatalog, type CursorRunOption, type CursorRuntime } from "@shared/cursor-runs";
import { BrandMark } from "./icons";
import { useI18n } from "./i18n";
import type { Locale } from "@shared/i18n";

type RuntimeFilter = "all" | CursorRuntime;

export function RunPicker() {
  const api = window.trainer;
  const { locale, t } = useI18n();
  const [catalog, setCatalog] = useState<CursorRunCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [runtime, setRuntime] = useState<RuntimeFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloudPending, setCloudPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCloudPending(true);
    setError(null);
    setCloudError(null);
    setCatalog((prev) => prev ? { ...prev, warnings: [] } : null);
    void api.listCursorRuns("local")
      .then((next) => { if (!cancelled) setCatalog((prev) => mergeCatalog(prev, next)); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void api.listCursorRuns("cloud")
      .then((next) => { if (!cancelled) setCatalog((prev) => mergeCatalog(prev, next)); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCloudError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setCloudPending(false); });
    return () => { cancelled = true; };
  }, [api, locale]);

  const runs = catalog?.runs ?? [];
  const visible = useMemo(() => filterCursorRuns(runs, query, runtime), [runs, query, runtime]);
  const selectedRun = visible.find((run) => run.id === selected) ?? null;
  const counts = {
    all: runs.length,
    local: runs.filter((run) => run.runtime === "local").length,
    cloud: runs.filter((run) => run.runtime === "cloud").length,
  };

  useEffect(() => {
    if (visible.length === 0) {
      if (selected) setSelected(null);
      return;
    }
    if (!selected || !visible.some((run) => run.id === selected)) setSelected(visible[0]?.id ?? null);
  }, [visible, selected]);

  function move(delta: number) {
    const index = visible.findIndex((run) => run.id === selected);
    const next = visible[Math.max(0, Math.min(visible.length - 1, index < 0 ? 0 : index + delta))];
    if (!next) return;
    setSelected(next.id);
    document.getElementById(`run-${next.id}`)?.scrollIntoView({ block: "nearest" });
  }

  async function choose(run: CursorRunOption) {
    setChoosing(true);
    try {
      await api.chooseCursorRun(run.prompt);
    } catch (err) {
      setChoosing(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const place = catalog ? catalog.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) : "";

  return (
    <div className="app picker">
      <div className="backdrop" aria-hidden="true">
        <div className="aurora a1" />
        <div className="aurora a2" />
        <div className="aurora a3" />
        <div className="grid-lines" />
        <div className="grain" />
      </div>
      <header className="titlebar">
        <div className="brand">
          <BrandMark />
          <h1>{t("runs.title")}</h1>
        </div>
        <div className="status">{place ? <span className="status-pill">{place}</span> : null}</div>
        <div />
      </header>
      <div className="picker-body">
        <div className="picker-tools">
          <input
            autoFocus
            value={query}
            placeholder={t("runs.searchPlaceholder")}
            aria-label={t("runs.searchLabel")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
              if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
            }}
          />
          <div className="seg" style={{ "--seg-count": 3, "--seg-index": runtime === "local" ? 1 : runtime === "cloud" ? 2 : 0 } as CSSProperties}>
            <span className="seg-thumb" />
            <Filter label={t("runs.all")} count={counts.all} checked={runtime === "all"} onChange={() => setRuntime("all")} />
            <Filter label={t("runs.local")} count={counts.local} checked={runtime === "local"} onChange={() => setRuntime("local")} />
            <Filter label={t("runs.cloud")} count={counts.cloud} checked={runtime === "cloud"} onChange={() => setRuntime("cloud")} />
          </div>
        </div>
        {error ? <p className="budget-error" role="alert">{error}</p> : null}
        {cloudError ? <p className="quiet">{t("runs.cloudError", { message: cloudError })}</p> : null}
        {catalog?.warnings.map((warning) => <p key={warning} className="quiet">{warning}</p>)}
        <div
          className="picker-list"
          role="listbox"
          aria-label={t("runs.title")}
          aria-busy={loading}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
            if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
            if (event.key === "Enter" && selectedRun) { event.preventDefault(); void choose(selectedRun); }
          }}
        >
          {loading ? <p className="quiet picker-empty">{t("runs.loadingLocal")}</p> : null}
          {!loading && cloudPending ? <p className="quiet">{t("runs.loadingCloud")}</p> : null}
          {!loading && !cloudPending && visible.length === 0 ? (
            <p className="quiet picker-empty">
              {t(runs.length === 0 ? "runs.empty" : "runs.noMatch")}
            </p>
          ) : null}
          {visible.map((run) => {
            const active = run.id === selected;
            return (
              <button
                key={run.id}
                id={`run-${run.id}`}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "run-row is-selected" : "run-row"}
                onClick={() => setSelected(run.id)}
                onDoubleClick={() => void choose(run)}
              >
                <span className="run-title"><Highlight text={run.title} query={query} /></span>
                <span className="run-meta">
                  <span className={run.runtime === "cloud" ? "pill ok" : "pill"}>{t(run.runtime === "cloud" ? "runs.cloud" : "runs.local")}</span>
                  <span>{run.place}</span>
                  {run.createdAt ? <time dateTime={new Date(run.createdAt).toISOString()}>{formatWhen(run.createdAt, locale)}</time> : null}
                </span>
                <span className="run-excerpt"><Highlight text={matchSnippet(run, query)} query={query} /></span>
              </button>
            );
          })}
        </div>
      </div>
      <footer className="picker-foot">
        <span className="quiet">{loading ? "…" : t("runs.count", { visible: visible.length.toLocaleString(locale), total: runs.length.toLocaleString(locale) })}</span>
        <div className="actions">
          <button type="button" onClick={() => void api.cancelCursorRun()} disabled={choosing}>{t("runs.close")}</button>
          <button type="button" className="primary" disabled={!selectedRun || choosing} onClick={() => selectedRun && void choose(selectedRun)}>
            {t("runs.apply")}
          </button>
        </div>
      </footer>
    </div>
  );
}

function mergeCatalog(prev: CursorRunCatalog | null, next: CursorRunCatalog): CursorRunCatalog {
  return {
    workspacePath: next.workspacePath || prev?.workspacePath || "",
    runs: dedupeRuns([...(prev?.runs ?? []), ...next.runs]),
    warnings: [...new Set([...(prev?.warnings ?? []), ...next.warnings])],
  };
}

function Filter({ label, count, checked, onChange }: { label: string; count: number; checked: boolean; onChange: () => void }) {
  const { locale } = useI18n();
  return (
    <label>
      <input type="radio" name="runtime" checked={checked} onChange={onChange} />
      {label}
      <span className="seg-count">{count.toLocaleString(locale)}</span>
    </label>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query);
  if (terms.length === 0 || !text) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => (
        terms.some((term) => part.toLocaleLowerCase() === term)
          ? <mark key={index}>{part}</mark>
          : <span key={index}>{part}</span>
      ))}
    </>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatWhen(value: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value);
}
