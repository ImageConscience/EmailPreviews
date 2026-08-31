"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  envelopeColumnNames,
  findEnvelopeColumns,
  findTemplateColumn,
  looksLikeImageUrl,
  looksLikeUrl,
  matchTemplateName,
  metadataColumns,
  normalizeKey,
  renderTemplate,
  unusedColumns as computeUnusedColumns,
} from "@/lib/template";
import { saveRowAction, toggleRowHiddenAction } from "@/actions/content";
import {
  defaultRange,
  inRange,
  parseSendDate,
  rangeIsOpen,
  rowLabel,
  rowSubLabel,
  type DateRange,
} from "@/lib/campaign";
import { PreviewFrame } from "./PreviewFrame";
import { ApprovalBar } from "./ApprovalBar";
import { EnvelopeFields } from "./EnvelopeFields";
import { ImagePicker } from "./ImagePicker";
import { ProductPicker } from "./ProductPicker";
import type { ProductOption } from "@/actions/catalog";
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
    hiddenAt: string | null;
    hiddenBy: string | null;
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

/** Filter value for rows whose template cell is empty or names nothing real. */
const UNASSIGNED_ROWS = "__unassigned__";

/**
 * Fields named product_<n>_<part> are one tile, filled together.
 *
 * The convention comes from the templates themselves rather than being imposed
 * here: a tile is an image, a title, a price and a link that all describe the
 * same thing, so picking the thing should fill all four.
 */
const PRODUCT_FIELD = /^product[_ -]?(\d+)[_ -]?(image|title|price|url|link|badge|description)$/i;

function productGroupOf(key: string): string | null {
  const match = PRODUCT_FIELD.exec(normalizeKey(key));
  return match ? `product_${match[1]}` : null;
}

/**
 * The cells a picked product fills. Only parts the sheet actually has are
 * touched -- a template with no price slot should not gain a stray column, and
 * a description written by hand is not overwritten by the store's own blurb.
 */
function productFill(group: string, product: ProductOption): Record<string, string> {
  return {
    [`${group}_image`]: product.imageUrl ?? "",
    [`${group}_title`]: product.title,
    [`${group}_price`]: product.price ? `$${product.price}` : "",
    [`${group}_url`]: product.url,
  };
}

/* Inline so they inherit the button's colour and need no network request. */
const EYE = (
  <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M1.7 10S4.9 4.6 10 4.6 18.3 10 18.3 10 15.1 15.4 10 15.4 1.7 10 1.7 10Z" />
    <circle cx="10" cy="10" r="2.4" />
  </svg>
);
const EYE_OFF = (
  <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M7.9 5c.68-.16 1.38-.24 2.1-.24 5.1 0 8.3 5.24 8.3 5.24a15 15 0 0 1-2.4 2.94M4.6 6.3A15 15 0 0 0 1.7 10s3.2 5.4 8.3 5.4c1.5 0 2.83-.47 3.96-1.14" />
    <path d="M8.4 8.5a2.4 2.4 0 0 0 3.3 3.4" />
    <path d="M2.6 2.6l14.8 14.8" />
  </svg>
);

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
  /** "" is every row; otherwise a template id, or UNASSIGNED_ROWS. */
  const [templateFilter, setTemplateFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [range, setRange] = useState<DateRange>(() => defaultRange());
  const [hiding, setHiding] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
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

  /**
   * Subject, preview text, send date and send time: shown above the render
   * rather than inside it, because none of them is part of the email body.
   */
  const envelopeColumns = useMemo(
    () => findEnvelopeColumns(sheet?.columns ?? []),
    [sheet],
  );
  const envelopeKeys = useMemo(() => envelopeColumnNames(envelopeColumns), [envelopeColumns]);

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
      // The template picker and the envelope fields each have their own place
      // in the UI, so they are not repeated as text fields here.
      if (claimed.has(column) || column === templateColumn) continue;
      if (envelopeKeys.includes(column)) continue;
      rest.push({ label: column, key: column, inTemplate: false, hasColumn: true });
    }
    return { templateFields: inTemplate, otherFields: rest };
  }, [template, sheet, templateColumn, envelopeKeys]);

  const fields = useMemo(
    () => [...templateFields, ...otherFields],
    [templateFields, otherFields],
  );

  /**
   * One "Product" button per tile, not per cell.
   *
   * A tile has four or five fields and the button does the same thing on all of
   * them, so it hangs off a single one: the title, which is what a person reads
   * to know which tile they are looking at, or the image when there is no
   * title field.
   */
  const productAnchors = useMemo(() => {
    const best = new Map<string, { key: string; rank: number }>();
    for (const field of templateFields) {
      const group = productGroupOf(field.key);
      if (!group) continue;
      const part = normalizeKey(field.key).slice(group.length + 1);
      const rank = part === "title" ? 0 : part === "image" ? 1 : 2;
      const held = best.get(group);
      if (!held || rank < held.rank) best.set(group, { key: field.key, rank });
    }
    return new Set([...best.values()].map((entry) => entry.key));
  }, [templateFields]);

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

  /**
   * Write a picked product across its whole tile.
   *
   * Only keys the row already knows about are set, so picking a product cannot
   * invent columns the sheet does not have.
   */
  const pickProduct = useCallback((group: string, product: ProductOption) => {
    setDraft((previous) => {
      const next = { ...previous };
      for (const [key, value] of Object.entries(productFill(group, product))) {
        const match = Object.keys(previous).find((k) => normalizeKey(k) === normalizeKey(key));
        if (match) next[match] = value;
      }
      return next;
    });
  }, []);

  /**
   * Hide the row on screen, or bring it back. Hiding does not move you off it:
   * you want to see what you just hid, and one more click undoes it.
   */
  const toggleHidden = useCallback(async () => {
    if (!currentRow) return;
    setHiding(true);
    const next = !currentRow.hiddenAt;
    const result = await toggleRowHiddenAction(companyId, currentRow.id, next);
    setHiding(false);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error ?? "Could not change that." });
      return;
    }
    setSheet((previous) =>
      previous
        ? {
            ...previous,
            rows: previous.rows.map((row) =>
              row.id === currentRow.id
                ? { ...row, hiddenAt: result.hiddenAt ?? null, hiddenBy: result.hiddenBy ?? null }
                : row,
            ),
          }
        : previous,
    );
    setStatus({
      kind: "ok",
      message: next ? "Hidden. It stays under “Show hidden”." : "Showing again.",
    });
  }, [companyId, currentRow]);

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
    return computeUnusedColumns(sheet.columns, template.placeholders, [
      ...(templateColumn ? [templateColumn] : []),
      ...envelopeKeys,
      ...metadataColumns(sheet.columns),
    ]);
  }, [template, sheet, templateColumn, envelopeKeys]);

  /**
   * Which template each row asks for, resolved once. Used to narrow the rail --
   * with every campaign on one sheet, "show me the artist spotlights" is how
   * you navigate, and it is a different question from which template is on
   * screen.
   */
  const rowTemplateIds = useMemo(() => {
    const byRow = new Map<string, string | null>();
    if (!sheet || !templateColumn) return byRow;
    for (const row of sheet.rows) {
      const matched = matchTemplateName(row.data[templateColumn] ?? "", templates);
      byRow.set(row.id, matched?.id ?? null);
    }
    return byRow;
  }, [sheet, templateColumn, templates]);

  const sendDateColumn = envelopeColumns.sendDate;

  const visibleRows = useMemo(() => {
    if (!sheet) return [];
    const needle = filter.trim().toLowerCase();
    return sheet.rows.filter((row) => {
      // The row you are looking at never vanishes underneath you -- hiding it
      // would leave the editor pointed at something not in the list.
      const isCurrent = row.id === rowId;
      if (row.hiddenAt && !showHidden && !isCurrent) return false;
      if (!isCurrent && sendDateColumn) {
        if (!inRange(parseSendDate(row.data[sendDateColumn]), range)) return false;
      }
      if (templateFilter) {
        const assigned = rowTemplateIds.get(row.id) ?? null;
        if (templateFilter === UNASSIGNED_ROWS ? assigned !== null : assigned !== templateFilter) {
          return false;
        }
      }
      if (!needle) return true;
      return Object.values(row.data).some((value) => value.toLowerCase().includes(needle));
    });
  }, [sheet, filter, templateFilter, rowTemplateIds, showHidden, rowId, sendDateColumn, range]);

  const hiddenCount = useMemo(
    () => (sheet?.rows ?? []).filter((row) => row.hiddenAt).length,
    [sheet],
  );

  /** How many rows each template owns, so the filter can say so up front. */
  const rowsPerTemplate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of rowTemplateIds.values()) {
      const key = id ?? UNASSIGNED_ROWS;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rowTemplateIds]);

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
          {templateColumn ? (
            <>
              <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
                <option value="">All templates ({sheet?.rows.length ?? 0})</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({rowsPerTemplate.get(t.id) ?? 0})
                  </option>
                ))}
                {(rowsPerTemplate.get(UNASSIGNED_ROWS) ?? 0) > 0 && (
                  <option value={UNASSIGNED_ROWS}>
                    Unassigned ({rowsPerTemplate.get(UNASSIGNED_ROWS)})
                  </option>
                )}
              </select>
              <p className="hint">
                Narrows the list below to the rows using that template. Each row still
                previews in whichever template it asks for.
              </p>
              {templateFilter && currentRow && !visibleRows.some((r) => r.id === currentRow.id) && (
                <p className="hint" style={{ color: "var(--warn)" }}>
                  The row on screen is not in this filter.
                </p>
              )}
            </>
          ) : (
            <p className="hint">
              This sheet has no <code>template</code> column, so there is nothing to filter
              by. Choose what to render under <strong>Template shown</strong> on the right.
            </p>
          )}
        </div>

        <div className="ws-section">
          <h3>Content sheet</h3>
          <select
            value={sheetId}
            onChange={(e) => {
              if (!confirmDiscard()) return;
              // Another sheet has its own mix of templates; carrying the filter
              // over can land you on an empty list for no visible reason.
              setTemplateFilter("");
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

          <label className="check">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>
              Show hidden items{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
            </span>
          </label>
        </div>

        {sendDateColumn && (
          <div className="ws-section">
            <h3>Send date</h3>
            <div className="daterange">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={range.includeUndated}
                onChange={(e) => setRange((r) => ({ ...r, includeUndated: e.target.checked }))}
              />
              <span>No date</span>
            </label>
            {!rangeIsOpen(range) && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 6, padding: "1px 6px" }}
                onClick={() => setRange({ from: "", to: "", includeUndated: true })}
              >
                Clear — show every date
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="ws-section hint">Loading rows…</div>
        ) : (
          <ul className="rowlist">
            {visibleRows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`${row.id === rowId ? "selected" : ""}${row.hiddenAt ? " is-hidden" : ""}`}
                  onClick={() => selectRow(row.id)}
                >
                  {row.hiddenAt && (
                    <span title={`Hidden${row.hiddenBy ? ` by ${row.hiddenBy}` : ""}`} className="row-hidden-mark">
                      {EYE_OFF}
                    </span>
                  )}
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
                    {rowSubLabel(row.data, row.position, templateColumn)}
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

          <button
            type="button"
            className={`btn btn-sm btn-icon ${currentRow?.hiddenAt ? "btn-hidden-on" : ""}`}
            disabled={!currentRow || hiding}
            title={
              currentRow?.hiddenAt
                ? `Hidden${currentRow.hiddenBy ? ` by ${currentRow.hiddenBy}` : ""} — click to show again`
                : "Hide this item: rejected, or not ready to show"
            }
            aria-pressed={Boolean(currentRow?.hiddenAt)}
            onClick={() => void toggleHidden()}
          >
            {currentRow?.hiddenAt ? EYE_OFF : EYE}
            <span className="sr-only">{currentRow?.hiddenAt ? "Show item" : "Hide item"}</span>
          </button>
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
            <div
              className="ws-stack"
              style={{ maxWidth: deviceWidth ? `${deviceWidth}px` : "100%" }}
            >
              {currentRow && (
                <EnvelopeFields
                  columns={envelopeColumns}
                  values={draft}
                  baseline={baseline}
                  width={null}
                  onChange={(key, value) =>
                    setDraft((previous) => ({ ...previous, [key]: value }))
                  }
                />
              )}
              <PreviewFrame html={result.html} maxWidth={null} />
            </div>
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
                  companyId={companyId}
                  field={field}
                  value={draft[field.key] ?? ""}
                  changed={(draft[field.key] ?? "") !== (baseline[field.key] ?? "")}
                  onChange={(value) =>
                    setDraft((previous) => ({ ...previous, [field.key]: value }))
                  }
                  onPickProduct={productAnchors.has(field.key) ? pickProduct : undefined}
                />
              ))}

              {/*
                Which template is on screen. It lives folded away down here on
                purpose: rows pick their own template, so reaching for this is
                the exception, and a stray click on a control beside the row
                list would silently show the wrong layout.
              */}
              <div className="fld" style={{ paddingTop: 12, paddingBottom: 12 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ width: "100%", justifyContent: "flex-start" }}
                  onClick={() => setShowTemplatePicker((open) => !open)}
                >
                  {showTemplatePicker ? "▾" : "▸"} Template shown
                  {template ? `: ${template.name}` : ""}
                  {templateOverridden && " (overridden)"}
                </button>
                {showTemplatePicker && (
                  <>
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      style={{ marginTop: 8 }}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.placeholderCount})
                        </option>
                      ))}
                    </select>
                    <div className="hint" style={{ marginTop: 4 }}>
                      Changes the layout on screen only, until you move to another row.
                      Nothing is saved.
                    </div>
                    {template && (
                      <div className="hint">
                        <Link href={`/c/${companyId}/templates/${template.id}`}>
                          Edit this template
                        </Link>
                      </div>
                    )}
                  </>
                )}
                {templateOverridden && rowTemplate.matched && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    This row asks for <strong>{rowTemplate.matched.name}</strong>.{" "}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: "1px 6px" }}
                      onClick={() => setTemplateId(rowTemplate.matched!.id)}
                    >
                      Use it
                    </button>
                  </div>
                )}
                {rowTemplate.unresolved && (
                  <div className="hint" style={{ marginTop: 6, color: "var(--warn)" }}>
                    This row asks for &ldquo;{rowTemplate.value}&rdquo;, which does not exist
                    yet &mdash; showing {templates[0]?.name}.
                  </div>
                )}
              </div>

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
                        companyId={companyId}
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
                        {/* Notes were stored but never shown, so a bulk change
                            read as an ordinary hand edit. */}
                        {revision.note && <> · {revision.note}</>}
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

const IMAGE_NAMED = /(image|img|photo|picture|logo|banner|thumbnail|artwork)/i;
/** `hero_alt` describes the picture; it does not hold one. */
const DESCRIBES_IMAGE = /(alt|caption|credit|description|_text\b)/i;

/** Fields that hold a picture, by what they are called or what they contain. */
function isImageField(field: Field, value: string): boolean {
  if (DESCRIBES_IMAGE.test(field.label)) return false;
  return IMAGE_NAMED.test(field.label) || looksLikeImageUrl(value);
}

function FieldRow({
  companyId,
  field,
  value,
  changed,
  onChange,
  onPickProduct,
}: {
  companyId: string;
  field: Field;
  value: string;
  changed: boolean;
  onChange: (value: string) => void;
  onPickProduct?: (group: string, product: ProductOption) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pickingProduct, setPickingProduct] = useState(false);
  const productGroup = onPickProduct ? productGroupOf(field.key) : null;
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
        {productGroup && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ padding: "1px 6px", fontSize: 11 }}
            onClick={() => setPickingProduct(true)}
            title="Fill this whole tile from the product catalog"
          >
            Product
          </button>
        )}
        {isImageField(field, value) && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ padding: "1px 6px", fontSize: 11 }}
            onClick={() => setPicking(true)}
            title="Choose from the image library"
          >
            Choose
          </button>
        )}
      </div>

      {pickingProduct && productGroup && (
        <ProductPicker
          companyId={companyId}
          group={productGroup}
          onPick={(product) => onPickProduct?.(productGroup, product)}
          onClose={() => setPickingProduct(false)}
        />
      )}

      {picking && (
        <ImagePicker
          companyId={companyId}
          onPick={(url) => onChange(url)}
          onClose={() => setPicking(false)}
        />
      )}

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
