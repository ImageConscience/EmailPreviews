"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findTemplateColumn,
  looksLikeImageUrl,
  looksLikeUrl,
  matchTemplateName,
  normalizeKey,
  renderTemplate,
  unusedColumns as computeUnusedColumns,
} from "@/lib/template";
import { saveRowAction } from "@/actions/content";
import { PreviewFrame } from "./PreviewFrame";
import { ApprovalBar } from "./ApprovalBar";
import type { ApprovalView } from "@/lib/approval";

export interface TemplateSummary {
  id: string;
  name: string;
  placeholderCount: number;
}

export interface SheetSummary {
  id: string;
  name: string;
  rowCount: number;
}

interface SheetPayload {
  id: string;
  name: string;
  columns: string[];
  totalRows: number;
  truncated: boolean;
  rows: {
    id: string;
    position: number;
    updatedAt: string;
    data: Record<string, string>;
    approvals: (ApprovalView & { templateId: string })[];
  }[];
}

interface TemplatePayload {
  id: string;
  name: string;
  html: string;
  placeholders: string[];
}

interface Revision {
  id: string;
  changedAt: string;
  note: string | null;
  by: string;
  data: Record<string, string>;
}

interface Field {
  /** Name shown to the user: the placeholder as written in the template. */
  label: string;
  /** Key the value is stored under in the row -- the sheet column when one matches. */
  key: string;
  inTemplate: boolean;
  hasColumn: boolean;
}

/** Rendered above the fields rather than among them; it selects the template. */
interface RowTemplateInfo {
  /** The sheet column naming each row's template, if the sheet has one. */
  column: string | null;
  /** Raw cell value for the current row. */
  value: string;
  /** The template that value resolves to, if any. */
  matched: TemplateSummary | null;
  /** A value was given but matches no template the company has yet. */
  unresolved: boolean;
}

const DEVICES = [
  { id: "mobile", label: "Mobile", width: 390 },
  { id: "desktop", label: "Desktop", width: 680 },
  { id: "full", label: "Full", width: null },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

const LABEL_HINTS = ["subject", "headline", "title", "name", "campaign", "product"];

function rowLabel(data: Record<string, string>, columns: string[]): string {
  for (const hint of LABEL_HINTS) {
    const column = columns.find((c) => normalizeKey(c).includes(hint));
    const value = column ? data[column]?.trim() : "";
    if (value) return value;
  }
  const first = columns.find((c) => data[c]?.trim());
  return first ? data[first].trim() : "(empty row)";
}

function isDirty(draft: Record<string, string>, baseline: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(draft), ...Object.keys(baseline)]);
  for (const key of keys) {
    if ((draft[key] ?? "") !== (baseline[key] ?? "")) return true;
  }
  return false;
}

export function PreviewWorkspace({
  companyId,
  currentUserId,
  templates,
  sheets,
  initialTemplateId,
  initialSheetId,
  initialRowId,
}: {
  companyId: string;
  currentUserId: string;
  templates: TemplateSummary[];
  sheets: SheetSummary[];
  initialTemplateId?: string;
  initialSheetId?: string;
  initialRowId?: string;
}) {
  const [templateId, setTemplateId] = useState(initialTemplateId ?? templates[0]?.id ?? "");
  const [sheetId, setSheetId] = useState(initialSheetId ?? sheets[0]?.id ?? "");
  const [rowId, setRowId] = useState(initialRowId ?? "");

  const [template, setTemplate] = useState<TemplatePayload | null>(null);
  const [sheet, setSheet] = useState<SheetPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const [device, setDevice] = useState<DeviceId>("desktop");
  const [highlightMissing, setHighlightMissing] = useState(true);
  const [filter, setFilter] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);

  const wantedRowId = useRef(initialRowId);
  /** Row whose default template has already been applied, so a manual pick sticks. */
  const templateAppliedFor = useRef<string | null>(null);
  const [showOtherFields, setShowOtherFields] = useState(false);
  const [showAllUnused, setShowAllUnused] = useState(false);

  /* ---------------- data loading ---------------- */

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/c/${companyId}/templates/${templateId}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error)))))
      .then((data: TemplatePayload) => {
        if (!cancelled) setTemplate(data);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message || "Could not load that template.");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, templateId]);

  useEffect(() => {
    if (!sheetId) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/c/${companyId}/sheets/${sheetId}`)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error)))))
      .then((data: SheetPayload) => {
        if (cancelled) return;
        setSheet(data);
        const preferred = data.rows.find((r) => r.id === wantedRowId.current);
        setRowId(preferred?.id ?? data.rows[0]?.id ?? "");
        wantedRowId.current = undefined;
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message || "Could not load that sheet.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, sheetId]);

  const currentRow = useMemo(
    () => sheet?.rows.find((row) => row.id === rowId) ?? null,
    [sheet, rowId],
  );

  /* ---------------- field mapping ---------------- */

  /** The sheet column that names each row's template, if the sheet has one. */
  const templateColumn = useMemo(
    () => (sheet ? findTemplateColumn(sheet.columns) : null),
    [sheet],
  );

  /**
   * The template this row asks for, read from the saved row.
   *
   * Deliberately not derived from `draft`: the draft is reset by an effect, so
   * on the first render after switching rows it still holds the previous row's
   * values, and auto-selection would apply the previous row's template.
   */
  const rowDefaultTemplate = useMemo(() => {
    if (!templateColumn || !currentRow) return { matched: null, unresolved: false };
    const value = (currentRow.data[templateColumn] ?? "").trim();
    const matched = matchTemplateName(value, templates);
    return { matched, unresolved: Boolean(value) && !matched };
  }, [templateColumn, currentRow, templates]);

  const rowTemplate = useMemo<RowTemplateInfo>(() => {
    if (!templateColumn || !currentRow) {
      return { column: templateColumn, value: "", matched: null, unresolved: false };
    }
    const value = (draft[templateColumn] ?? currentRow.data[templateColumn] ?? "").trim();
    const matched = matchTemplateName(value, templates);
    return { column: templateColumn, value, matched, unresolved: Boolean(value) && !matched };
  }, [templateColumn, currentRow, draft, templates]);

  /**
   * One sheet holds every campaign, so a template's own fields are a minority of
   * the columns. They are listed on their own; the rest fold away.
   */
  const { templateFields, otherFields } = useMemo(() => {
    const columns = sheet?.columns ?? [];
    const byKey = new Map(columns.map((c) => [normalizeKey(c), c]));
    const claimed = new Set<string>();
    const inTemplate: Field[] = [];
    const rest: Field[] = [];

    for (const placeholder of template?.placeholders ?? []) {
      const column = byKey.get(normalizeKey(placeholder));
      if (column) claimed.add(column);
      inTemplate.push({
        label: placeholder,
        key: column ?? placeholder,
        inTemplate: true,
        hasColumn: Boolean(column),
      });
    }
    for (const column of columns) {
      // The template column is offered as a picker above, not as a text field.
      if (claimed.has(column) || column === templateColumn) continue;
      rest.push({ label: column, key: column, inTemplate: false, hasColumn: true });
    }
    return { templateFields: inTemplate, otherFields: rest };
  }, [template, sheet, templateColumn]);

  const fields = useMemo(
    () => [...templateFields, ...otherFields],
    [templateFields, otherFields],
  );

  // Reset the draft whenever the selected row (or the field set) changes.
  useEffect(() => {
    if (!currentRow) {
      setDraft({});
      setBaseline({});
      return;
    }
    const next: Record<string, string> = { ...currentRow.data };
    for (const field of fields) if (!(field.key in next)) next[field.key] = "";
    setDraft(next);
    setBaseline({ ...currentRow.data });
    setStatus(null);
    setRevisions(null);
  }, [currentRow, fields]);

  /**
   * Each row carries its own template, so moving between rows shows every
   * campaign the way it is meant to look without anyone picking from a list.
   * The choice is applied once per row, so a deliberate change to a different
   * template stays put until you move to another row.
   */
  useEffect(() => {
    if (!currentRow) return;
    if (templateAppliedFor.current === currentRow.id) return;
    templateAppliedFor.current = currentRow.id;

    if (rowDefaultTemplate.matched) {
      setTemplateId(rowDefaultTemplate.matched.id);
    } else if (rowDefaultTemplate.unresolved && templates[0]) {
      // Named a template that does not exist yet -- fall back to the first.
      setTemplateId(templates[0].id);
    }
  }, [currentRow, rowDefaultTemplate, templates]);

  /** Sign-off is per row and template, so only this pair's approvals show. */
  const rowApprovals = useMemo(
    () => (currentRow?.approvals ?? []).filter((a) => a.templateId === templateId),
    [currentRow, templateId],
  );

  const applyApprovals = useCallback(
    (next: ApprovalView[]) => {
      if (!currentRow) return;
      setSheet((previous) =>
        previous
          ? {
              ...previous,
              rows: previous.rows.map((row) =>
                row.id === currentRow.id
                  ? {
                      ...row,
                      approvals: [
                        ...row.approvals.filter((a) => a.templateId !== templateId),
                        ...next.map((a) => ({ ...a, templateId })),
                      ],
                    }
                  : row,
              ),
            }
          : previous,
      );
    },
    [currentRow, templateId],
  );

  /** True when what is on screen is not what this row asks for. */
  const templateOverridden = Boolean(
    rowTemplate.matched && templateId && rowTemplate.matched.id !== templateId,
  );

  const dirty = useMemo(() => isDirty(draft, baseline), [draft, baseline]);

  /* ---------------- rendering ---------------- */

  const result = useMemo(() => {
    if (!template) {
      return { html: "", placeholders: [], filled: [], blank: [], missing: [] };
    }
    return renderTemplate(template.html, draft, { highlightMissing });
  }, [template, draft, highlightMissing]);

  const unusedColumnNames = useMemo(() => {
    if (!template || !sheet) return [];
    // The template column steers the preview rather than filling it, so it is
    // never an oversight that a template does not reference it.
    return computeUnusedColumns(
      sheet.columns,
      template.placeholders,
      templateColumn ? [templateColumn] : [],
    );
  }, [template, sheet, templateColumn]);

  const visibleRows = useMemo(() => {
    if (!sheet) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return sheet.rows;
    return sheet.rows.filter((row) =>
      Object.values(row.data).some((value) => value.toLowerCase().includes(needle)),
    );
  }, [sheet, filter]);

  /* ---------------- actions ---------------- */

  const confirmDiscard = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("You have unsaved changes to this row. Discard them?");
  }, [dirty]);

  const selectRow = useCallback(
    (id: string) => {
      if (id === rowId || !confirmDiscard()) return;
      setRowId(id);
    },
    [rowId, confirmDiscard],
  );

  const step = useCallback(
    (delta: number) => {
      if (!sheet) return;
      const index = sheet.rows.findIndex((row) => row.id === rowId);
      const next = sheet.rows[index + delta];
      if (next) selectRow(next.id);
    },
    [sheet, rowId, selectRow],
  );

  const save = useCallback(async () => {
    if (!currentRow || saving) return;
    setSaving(true);
    setStatus(null);

    // Only send values that exist or were actually typed, so an untouched
    // unmapped placeholder does not silently add an empty column to the sheet.
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value !== "" || key in baseline) payload[key] = value;
    }

    const response = await saveRowAction(companyId, currentRow.id, payload);
    setSaving(false);

    if (!response.ok) {
      setStatus({ kind: "error", message: response.error ?? "Could not save." });
      return;
    }
    setBaseline({ ...payload });
    setSheet((previous) =>
      previous
        ? {
            ...previous,
            rows: previous.rows.map((row) =>
              row.id === currentRow.id
                ? {
                    ...row,
                    data: { ...payload },
                    updatedAt: response.updatedAt ?? row.updatedAt,
                    // The saved content is no longer what anyone signed off on.
                    approvals: row.approvals.map((a) => ({ ...a, stale: true })),
                  }
                : row,
            ),
          }
        : previous,
    );
    setRevisions(null);
    setStatus({ kind: "ok", message: "Saved." });
  }, [companyId, currentRow, draft, baseline, saving]);

  const loadHistory = useCallback(async () => {
    if (!currentRow) return;
    setShowHistory((open) => !open);
    if (revisions) return;
    const response = await fetch(`/api/c/${companyId}/rows/${currentRow.id}/revisions`);
    if (response.ok) {
      const data = (await response.json()) as { revisions: Revision[] };
      setRevisions(data.revisions);
    }
  }, [companyId, currentRow, revisions]);

  const copyHtml = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result.html);
      setStatus({ kind: "ok", message: "Merged HTML copied to clipboard." });
    } catch {
      setStatus({ kind: "error", message: "Your browser blocked clipboard access." });
    }
  }, [result.html]);

  const downloadHtml = useCallback(() => {
    const blob = new Blob([result.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const base = `${template?.name ?? "preview"}-${currentRow ? currentRow.position + 1 : 0}`;
    link.href = url;
    link.download = `${base.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }, [result.html, template, currentRow]);

  // Cmd/Ctrl+S saves, which is what anyone editing copy will reach for.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  // Guard against closing the tab mid-edit.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ---------------- empty states ---------------- */

  if (templates.length === 0 || sheets.length === 0) {
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <h3>Two things are needed before you can preview</h3>
            <p>
              {templates.length === 0 && (
                <>
                  You have no templates yet.{" "}
                  <Link href={`/c/${companyId}/templates/new`}>Add one</Link>.
                  <br />
                </>
              )}
              {sheets.length === 0 && (
                <>
                  You have no content sheets yet.{" "}
                  <Link href={`/c/${companyId}/sheets`}>Upload a .csv or .xlsx</Link>.
                </>
              )}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const rowIndex = sheet ? sheet.rows.findIndex((row) => row.id === rowId) : -1;
  const deviceWidth = DEVICES.find((d) => d.id === device)?.width ?? null;

  return (
    <div className="workspace">
      {/* ---------- left: pickers ---------- */}
      <aside className="ws-pane">
        <div className="ws-section">
          <h3>Template</h3>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.placeholderCount})
              </option>
            ))}
          </select>
          {templateOverridden && rowTemplate.matched && (
            <p className="hint" style={{ marginTop: 6 }}>
              This row asks for <strong>{rowTemplate.matched.name}</strong>.{" "}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ padding: "1px 6px" }}
                onClick={() => setTemplateId(rowTemplate.matched!.id)}
              >
                Use it
              </button>
            </p>
          )}
          {rowTemplate.unresolved && (
            <p className="hint" style={{ marginTop: 6, color: "var(--warn)" }}>
              This row asks for &ldquo;{rowTemplate.value}&rdquo;, which does not exist yet &mdash;
              showing {templates[0]?.name}.
            </p>
          )}
          {template && (
            <p className="hint">
              <Link href={`/c/${companyId}/templates/${template.id}`}>Edit this template</Link>
            </p>
          )}
        </div>

        <div className="ws-section">
          <h3>Content sheet</h3>
          <select
            value={sheetId}
            onChange={(e) => {
              if (!confirmDiscard()) return;
              setSheetId(e.target.value);
            }}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.rowCount})
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter rows…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>

        {loading ? (
          <div className="ws-section hint">Loading rows…</div>
        ) : (
          <ul className="rowlist">
            {visibleRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === rowId ? "selected" : ""}
                  onClick={() => selectRow(row.id)}
                >
                  {row.approvals.some((a) => !a.stale) && (
                    <span
                      title="Has a current approval"
                      style={{ color: "var(--ok)", marginRight: 5, fontWeight: 700 }}
                    >
                      ✓
                    </span>
                  )}
                  {rowLabel(row.data, sheet?.columns ?? [])}
                  <span className="sub">
                    Row {row.position + 1}
                    {templateColumn && row.data[templateColumn]?.trim()
                      ? ` \u00b7 ${row.data[templateColumn].trim()}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
            {visibleRows.length === 0 && (
              <li>
                <div className="ws-section hint">No rows match “{filter}”.</div>
              </li>
            )}
          </ul>
        )}

        {sheet?.truncated && (
          <div className="ws-section hint">
            Showing the first {sheet.rows.length} of {sheet.totalRows} rows.
          </div>
        )}
      </aside>

      {/* ---------- centre: the preview ---------- */}
      <section className="ws-stage">
        <div className="ws-toolbar">
          <div className="row" style={{ gap: 4 }}>
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`btn btn-sm ${device === d.id ? "btn-primary" : ""}`}
                onClick={() => setDevice(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>

          <label className="row" style={{ gap: 5, fontSize: 13, color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={highlightMissing}
              onChange={(e) => setHighlightMissing(e.target.checked)}
              style={{ width: "auto" }}
            />
            Highlight gaps
          </label>

          <div className="spacer" />

          <button type="button" className="btn btn-sm" onClick={() => step(-1)} disabled={rowIndex <= 0}>
            ← Prev
          </button>
          <span className="hint" style={{ marginTop: 0 }}>
            {rowIndex >= 0 && sheet ? `${rowIndex + 1} / ${sheet.rows.length}` : "—"}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => step(1)}
            disabled={!sheet || rowIndex < 0 || rowIndex >= sheet.rows.length - 1}
          >
            Next →
          </button>

          <button type="button" className="btn btn-sm" onClick={copyHtml}>
            Copy HTML
          </button>
          <button type="button" className="btn btn-sm" onClick={downloadHtml}>
            Download
          </button>

          <ApprovalBar
            companyId={companyId}
            rowId={currentRow?.id ?? null}
            templateId={templateId}
            currentUserId={currentUserId}
            approvals={rowApprovals}
            dirty={dirty}
            onChange={applyApprovals}
          />
        </div>

        {loadError && (
          <div style={{ padding: 14 }}>
            <div className="alert alert-error" style={{ marginBottom: 0 }}>
              {loadError}
            </div>
          </div>
        )}

        <div className="ws-canvas">
          {template ? (
            <PreviewFrame html={result.html} maxWidth={deviceWidth} />
          ) : (
            <div className="empty">Select a template to preview.</div>
          )}
        </div>
      </section>

      {/* ---------- right: content editor ---------- */}
      <aside className="ws-pane">
        <div className="ws-section">
          <h3>Coverage</h3>
          <div className="coverage">
            <div className="grp">
              <span className="badge badge-ok">{result.filled.length} filled</span>{" "}
              {result.blank.length > 0 && (
                <span className="badge badge-warn">{result.blank.length} blank</span>
              )}{" "}
              {result.missing.length > 0 && (
                <span className="badge badge-danger">{result.missing.length} unmatched</span>
              )}
            </div>
            {result.missing.length > 0 && (
              <div className="grp">
                <strong style={{ color: "var(--danger)" }}>No column for</strong>
                <div className="chiplist">
                  {result.missing.map((name) => (
                    <span key={name} className="chip chip-missing">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.blank.length > 0 && (
              <div className="grp">
                <strong style={{ color: "var(--warn)" }}>Blank value</strong>
                <div className="chiplist">
                  {result.blank.map((name) => (
                    <span key={name} className="chip chip-blank">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {unusedColumnNames.length > 0 && (
              <div className="grp">
                <strong>Columns this template ignores</strong>
                <div className="chiplist">
                  {(showAllUnused ? unusedColumnNames : unusedColumnNames.slice(0, 6)).map(
                    (name) => (
                      <span key={name} className="chip chip-unused">
                        {name}
                      </span>
                    ),
                  )}
                  {unusedColumnNames.length > 6 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "1px 6px", fontSize: 11 }}
                      onClick={() => setShowAllUnused((open) => !open)}
                    >
                      {showAllUnused ? "show fewer" : `+${unusedColumnNames.length - 6} more`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {currentRow ? (
          <>
            <div className="field-editor">
              {rowTemplate.column && (
                <div className="fld" style={{ background: "var(--surface-2)" }}>
                  <div className="fld-head">
                    <span className="fld-name" title={rowTemplate.column}>
                      {rowTemplate.column}
                    </span>
                    <span className="badge badge-accent">row template</span>
                    <div className="spacer" />
                    {(draft[rowTemplate.column] ?? "") !==
                      (baseline[rowTemplate.column] ?? "") && (
                      <span className="badge badge-accent">edited</span>
                    )}
                  </div>
                  <select
                    value={rowTemplate.matched ? rowTemplate.matched.name : rowTemplate.value}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft((previous) => ({ ...previous, [rowTemplate.column!]: value }));
                      const next = matchTemplateName(value, templates);
                      if (next) setTemplateId(next.id);
                    }}
                  >
                    <option value="">(none — keep whatever is selected)</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                    {rowTemplate.unresolved && (
                      <option value={rowTemplate.value}>
                        {rowTemplate.value} (not found)
                      </option>
                    )}
                  </select>
                  <div className="hint">Which template this row is previewed in by default.</div>
                </div>
              )}

              {templateFields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={draft[field.key] ?? ""}
                  changed={(draft[field.key] ?? "") !== (baseline[field.key] ?? "")}
                  onChange={(value) =>
                    setDraft((previous) => ({ ...previous, [field.key]: value }))
                  }
                />
              ))}

              {otherFields.length > 0 && (
                <>
                  <div className="fld" style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ width: "100%", justifyContent: "flex-start" }}
                      onClick={() => setShowOtherFields((open) => !open)}
                    >
                      {showOtherFields ? "▾" : "▸"} Other columns ({otherFields.length})
                    </button>
                    {!showOtherFields && (
                      <div className="hint" style={{ marginTop: 4 }}>
                        Columns this template does not use — usually another template&rsquo;s fields.
                      </div>
                    )}
                  </div>
                  {showOtherFields &&
                    otherFields.map((field) => (
                      <FieldRow
                        key={field.key}
                        field={field}
                        value={draft[field.key] ?? ""}
                        changed={(draft[field.key] ?? "") !== (baseline[field.key] ?? "")}
                        onChange={(value) =>
                          setDraft((previous) => ({ ...previous, [field.key]: value }))
                        }
                      />
                    ))}
                </>
              )}

              {fields.length === 0 && <div className="ws-section hint">No fields to edit.</div>}
            </div>

            {showHistory && (
              <div className="ws-section">
                <h3>Edit history</h3>
                {revisions === null ? (
                  <p className="hint">Loading…</p>
                ) : revisions.length === 0 ? (
                  <p className="hint">No edits yet — this row is as imported.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {revisions.map((revision) => (
                      <li key={revision.id} className="hint" style={{ marginBottom: 6 }}>
                        {new Date(revision.changedAt).toLocaleString()} · {revision.by}
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ marginLeft: 6 }}
                          onClick={() => {
                            if (!confirmDiscard()) return;
                            setDraft((previous) => ({ ...previous, ...revision.data }));
                          }}
                        >
                          Load into editor
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="sticky-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setDraft({ ...baseline })}
                disabled={!dirty || saving}
              >
                Revert
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadHistory()}>
                History
              </button>
              <div className="spacer" style={{ flex: 1 }} />
              {status && (
                <span
                  className="hint"
                  style={{
                    marginTop: 0,
                    color: status.kind === "ok" ? "var(--ok)" : "var(--danger)",
                  }}
                >
                  {status.message}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="ws-section hint">Select a row to edit its content.</div>
        )}
      </aside>
    </div>
  );
}

function FieldRow({
  field,
  value,
  changed,
  onChange,
}: {
  field: Field;
  value: string;
  changed: boolean;
  onChange: (value: string) => void;
}) {
  // Plenty of image CDNs serve extensionless URLs, so rather than guess from
  // the URL alone, every URL value is probed by actually loading it. A probe
  // that succeeds is an image and gets a thumbnail; one that fails only raises
  // a warning if the URL looked like an image, so a plain link never false-alarms.
  //
  // The probe result is tagged with the value it belongs to rather than reset
  // in an effect: a cached or `data:` image fires onLoad during commit, before
  // an effect would run, and a reset effect would clobber the result.
  const [probe, setProbe] = useState<{ value: string; state: "loaded" | "failed" } | null>(null);
  const isUrl = looksLikeUrl(value);
  const state = probe?.value === value ? probe.state : "idle";

  const showThumb = state === "loaded";
  const showBroken = state === "failed" && looksLikeImageUrl(value);

  return (
    <div className="fld">
      <div className="fld-head">
        <span className="fld-name" title={field.key}>
          {field.label}
        </span>
        {!field.inTemplate && <span className="badge">unused</span>}
        {field.inTemplate && !field.hasColumn && (
          <span className="badge badge-danger" title="No matching column in this sheet">
            no column
          </span>
        )}
        <div className="spacer" />
        {changed && <span className="badge badge-accent">edited</span>}
      </div>

      <textarea
        value={value}
        rows={value.length > 70 ? 3 : 1}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={!looksLikeUrl(value)}
      />

      {isUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={value}
            src={value}
            alt=""
            onLoad={() => setProbe({ value, state: "loaded" })}
            onError={() => setProbe({ value, state: "failed" })}
            style={
              showThumb
                ? {
                    maxWidth: "100%",
                    maxHeight: 110,
                    marginTop: 7,
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    display: "block",
                  }
                : { display: "none" }
            }
          />
          {/* Nothing is shown until the probe resolves, so a plain link URL
              never leaves an empty box behind. */}
          {showBroken && (
            <div className="thumb">
              <span className="meta" style={{ color: "var(--danger)" }}>
                Image did not load — check this URL before sending.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
