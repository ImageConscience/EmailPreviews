"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createEmailAction } from "@/actions/content";
import type { MineFilter } from "@/lib/view-state";
import {
  defaultRange,
  formatIso,
  inRange,
  rangeIsOpen,
  shiftIso,
  todayIso,
  type DateRange,
} from "@/lib/campaign";
import { flag, isOn, useMineFilter, useViewState, validId } from "@/lib/view-state";
import { ShareLink } from "@/components/ShareLink";

export interface OverviewItem {
  rowId: string;
  sheetId: string;
  sheetName: string;
  position: number;
  title: string;
  campaign: string;
  theme: string;
  templateId: string | null;
  templateName: string;
  templateKnown: boolean;
  /** `yyyy-mm-dd`, or null when the row has no readable send date. */
  sendDate: string | null;
  sendTime: string;
  subject: string;
  approvals: number;
  staleApprovals: number;
  /** One per person who has signed off, however many templates they did it in. */
  approvers: { name: string; initials: string; hue: number; stale: boolean }[];
  /** Whether the person looking at this has a current approval on it. */
  approvedByMe: boolean;
  notes: number;
  /** "scheduled" or "draft" once it has gone to Klaviyo. */
  published: string | null;
  hidden: boolean;
  hiddenBy: string | null;
}


const UNASSIGNED = "__unassigned__";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday-first, because a send calendar is a working week. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function OverviewBoard({
  companyId,
  items,
  currentUserId,
  templates,
  sheets,
}: {
  companyId: string;
  items: OverviewItem[];
  currentUserId: string;
  templates: { id: string; name: string }[];
  sheets: { id: string; name: string }[];
}) {
  // Everything here is in the URL, so a view can be reloaded, navigated back
  // to, and pasted to someone else.
  const initial = useMemo(() => {
    const fallback = defaultRange();
    return {
      view: "list",
      q: "",
      template: "",
      sheet: "",
      hidden: flag(false),
      from: fallback.from,
      to: fallback.to,
      undated: flag(fallback.includeUndated),
      month: todayIso().slice(0, 7),
    };
  }, []);
  const { state, set, ready } = useViewState(`overview:${companyId}`, initial);

  const view = state.view === "calendar" ? "calendar" : "list";
  const setView = (next: "list" | "calendar") => set({ view: next });
  const search = state.q;
  const setSearch = (next: string) => set({ q: next });
  // Both filters are remembered across visits, so both can name something that
  // has since been deleted -- and a re-uploaded sheet is a new sheet with a new
  // id, so this happens in ordinary use rather than only after a tidy-up. A
  // stale id used to filter every row out while the control beside it read
  // "All sheets", because a `select` cannot show an option that is not there:
  // an empty page with no filter visibly set and, on a company down to one
  // sheet, no sheet control rendered at all to clear it with.
  const knownSheets = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const knownTemplates = useMemo(() => [UNASSIGNED, ...templates.map((t) => t.id)], [templates]);
  const templateFilter = validId(state.template, knownTemplates);
  const setTemplateFilter = (next: string) => set({ template: next });
  const sheetFilter = validId(state.sheet, knownSheets);
  const setSheetFilter = (next: string) => set({ sheet: next });

  // Say so, and tidy the stored value away so it cannot come back tomorrow.
  const [droppedFilter, setDroppedFilter] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const stale: string[] = [];
    if (state.sheet && !sheetFilter) stale.push("sheet");
    if (state.template && !templateFilter) stale.push("template");
    if (stale.length === 0) return;
    setDroppedFilter(stale.join(" and "));
    set({ ...(stale.includes("sheet") ? { sheet: "" } : {}), ...(stale.includes("template") ? { template: "" } : {}) });
    // Once per arrival: `set` changes the state this reads, so anything else
    // here would fire again on the value it just wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const showHidden = isOn(state.hidden);
  const setShowHidden = (next: boolean) => set({ hidden: flag(next) });
  const month = state.month;
  const setMonth = (next: string) => set({ month: next });

  const range: DateRange = useMemo(
    () => ({ from: state.from, to: state.to, includeUndated: isOn(state.undated) }),
    [state.from, state.to, state.undated],
  );
  const setRange = (next: DateRange) =>
    set({ from: next.from, to: next.to, undated: flag(next.includeUndated) });

  // Shared with the preview, so someone working a queue sets it once.
  const [mine, setMineFilter] = useMineFilter(companyId, currentUserId);

  const hiddenCount = useMemo(() => items.filter((i) => i.hidden).length, [items]);

  /**
   * The list obeys the date range; the calendar has its own navigation and
   * would be empty half the time if it obeyed it too, so it takes everything
   * else and shows the month you are standing on.
   */
  const matchesExceptDate = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (item.hidden && !showHidden) return false;
      if (mine === "todo" && item.approvedByMe) return false;
      if (mine === "done" && !item.approvedByMe) return false;
      if (sheetFilter && item.sheetId !== sheetFilter) return false;
      if (templateFilter) {
        if (templateFilter === UNASSIGNED ? item.templateId !== null : item.templateId !== templateFilter) {
          return false;
        }
      }
      if (!needle) return true;
      return [item.title, item.subject, item.campaign, item.theme, item.templateName]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [items, mine, search, showHidden, sheetFilter, templateFilter]);

  const listed = useMemo(() => {
    const rows = matchesExceptDate.filter((item) => inRange(item.sendDate, range));
    // Dated first, soonest to latest; undated after, in sheet order, because
    // they are the backlog rather than the schedule.
    return rows.sort((a, b) => {
      if (a.sendDate && b.sendDate) {
        if (a.sendDate !== b.sendDate) return a.sendDate.localeCompare(b.sendDate);
        return a.sendTime.localeCompare(b.sendTime);
      }
      if (a.sendDate) return -1;
      if (b.sendDate) return 1;
      return a.sheetName.localeCompare(b.sheetName) || a.position - b.position;
    });
  }, [matchesExceptDate, range]);

  const byDate = useMemo(() => {
    const map = new Map<string, OverviewItem[]>();
    for (const item of matchesExceptDate) {
      if (!item.sendDate) continue;
      const list = map.get(item.sendDate) ?? [];
      list.push(item);
      map.set(item.sendDate, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sendTime.localeCompare(b.sendTime));
    return map;
  }, [matchesExceptDate]);

  const undated = useMemo(
    () => matchesExceptDate.filter((item) => !item.sendDate),
    [matchesExceptDate],
  );

  // Starting an email is a page-head action rather than a row action: it
  // belongs to the list, not to anything in it, and it has to be reachable
  // from the calendar too.
  const [creating, setCreating] = useState(false);

  const href = (item: OverviewItem) => {
    const params = new URLSearchParams({ sheet: item.sheetId, row: item.rowId });
    if (item.templateId) params.set("template", item.templateId);
    return `/c/${companyId}/preview?${params.toString()}`;
  };

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Overview</h1>
            <p>Everything this company has planned, in one place.</p>
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
        <div className="card">
          <div className="empty">
            <h3>Nothing to show yet</h3>
            <p>
              Start one with <strong>+ New</strong>, or upload a content sheet under{" "}
              <Link href={`/c/${companyId}/sheets`}>Content</Link> and every row will appear here.
            </p>
          </div>
        </div>
      {creating && (
        <NewEmailDialog
          companyId={companyId}
          templates={templates}
          sheets={sheets}
          onClose={() => setCreating(false)}
        />
      )}
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {listed.length} of {items.length} {items.length === 1 ? "item" : "items"}
            {hiddenCount > 0 && !showHidden ? ` · ${hiddenCount} hidden` : ""}
          </p>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + New
          </button>
          <span style={{ width: 6 }} />
          <ShareLink />
          <span style={{ width: 6 }} />
          <button
            type="button"
            className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            type="button"
            className={`btn btn-sm ${view === "calendar" ? "btn-primary" : ""}`}
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
        </div>
      </div>

      <div className="card card-pad ov-filters">
        <label className="field" style={{ marginBottom: 0, flex: "2 1 220px" }}>
          <span>Search</span>
          <input
            type="text"
            placeholder="Subject, campaign, template…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="field" style={{ marginBottom: 0, flex: "1 1 170px" }}>
          <span>Template</span>
          <select value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
            <option value="">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={UNASSIGNED}>Unassigned</option>
          </select>
        </label>

        {/* Personal, and labelled so: it filters by whoever is logged in, and
            it is the one control that a shared link does not carry. */}
        <label className="field" style={{ marginBottom: 0, flex: "1 1 170px" }}>
          <span>My sign-off</span>
          <select value={mine} onChange={(e) => setMineFilter(e.target.value as MineFilter)}>
            <option value="">Any sign-off</option>
            <option value="todo">Not approved by me</option>
            <option value="done">Approved by me</option>
          </select>
        </label>

        {sheets.length > 1 && (
          <label className="field" style={{ marginBottom: 0, flex: "1 1 170px" }}>
            <span>Sheet</span>
            <select value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)}>
              <option value="">All sheets</option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {droppedFilter && (
          <p
            className="hint"
            style={{ flexBasis: "100%", margin: "4px 0 0" }}
            role="status"
          >
            A saved {droppedFilter} filter was cleared: what it pointed at no longer
            exists. Uploading a sheet again creates a new one, so a filter set before
            the upload stops matching anything.
          </p>
        )}

        {view === "list" && (
          <>
            <label className="field" style={{ marginBottom: 0, flex: "0 1 150px" }}>
              <span>From</span>
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </label>
            <label className="field" style={{ marginBottom: 0, flex: "0 1 150px" }}>
              <span>To</span>
              <input
                type="date"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </label>
          </>
        )}

        <div className="ov-checks">
          {view === "list" && (
            <label className="check" style={{ marginTop: 0 }}>
              <input
                type="checkbox"
                checked={range.includeUndated}
                onChange={(e) => setRange({ ...range, includeUndated: e.target.checked })}
              />
              <span>No date</span>
            </label>
          )}
          <label className="check" style={{ marginTop: 0 }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            <span>Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ""}</span>
          </label>
          {view === "list" && !rangeIsOpen(range) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setRange({ from: "", to: "", includeUndated: true })}
            >
              Every date
            </button>
          )}
          {view === "list" && rangeIsOpen(range) && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setRange(defaultRange())}
            >
              Next 30 days
            </button>
          )}
        </div>
      </div>

      {view === "list" ? (
        <ListView items={listed} href={href} />
      ) : (
        <CalendarView
          month={month}
          setMonth={setMonth}
          byDate={byDate}
          undated={undated}
          href={href}
        />
      )}

      {creating && (
        <NewEmailDialog
          companyId={companyId}
          templates={templates}
          sheets={sheets}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

function ListView({
  items,
  href,
}: {
  items: OverviewItem[];
  href: (item: OverviewItem) => string;
}) {
  if (items.length === 0) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="empty">
          <h3>Nothing in this range</h3>
          <p>Widen the dates, or clear the filters above.</p>
        </div>
      </div>
    );
  }

  let lastDate: string | null | undefined;

  return (
    <div className="card" style={{ marginTop: 14, overflowX: "auto" }}>
      <table className="ov-table">
        <thead>
          <tr>
            <th className="tight">Send</th>
            <th>Campaign</th>
            <th className="tight">Template</th>
            <th className="tight">Sign-off</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            // One date heading per day, so a list of thirty reads as a schedule.
            const newDay = item.sendDate !== lastDate;
            lastDate = item.sendDate;
            return (
              <tr key={item.rowId} className={item.hidden ? "is-hidden" : ""}>
                <td className="tight ov-when">
                  {newDay ? (
                    item.sendDate ? (
                      <>
                        <strong>{formatIso(item.sendDate)}</strong>
                        {item.sendTime && <span className="ov-time">{item.sendTime}</span>}
                      </>
                    ) : (
                      <span className="ov-nodate">No date</span>
                    )
                  ) : (
                    <span className="ov-time">{item.sendTime || " "}</span>
                  )}
                </td>
                <td>
                  <Link href={href(item)} className="ov-title">
                    {item.title}
                  </Link>
                  <div className="ov-sub">
                    {[item.campaign, item.theme, item.sheetName].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="tight">
                  {item.templateName ? (
                    <span className={`badge ${item.templateKnown ? "" : "badge-warn"}`}>
                      {item.templateName}
                      {item.templateKnown ? "" : " ?"}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td className="tight">
                  <SignOff item={item} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New email                                                           */
/* ------------------------------------------------------------------ */

/**
 * Start an email without leaving the overview.
 *
 * It asks only for what decides what a row *is*: which template it is written
 * against, what it is called, what it says in an inbox, and when it goes. The
 * copy is left for the preview, where you can see what you are typing into.
 *
 * Audience is deliberately absent. It has a company default, and its own
 * picker at the head of the preview rail, so asking for it here would be a
 * third place to set one thing.
 */
function NewEmailDialog({
  companyId,
  templates,
  sheets,
  onClose,
}: {
  companyId: string;
  templates: { id: string; name: string }[];
  sheets: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [sheetId, setSheetId] = useState(sheets[0]?.id ?? "");
  const [campaign, setCampaign] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createEmailAction(companyId, {
        sheetId,
        templateId,
        campaign,
        subject,
        preheader,
        sendDate,
        sendTime,
      });
      if (!result.ok || !result.rowId) {
        setError(result.error ?? "That could not be saved.");
        setBusy(false);
        return;
      }
      // Straight into the preview it was made for: the point of the dialog is
      // to get to the editing, not to add a line to a list.
      const params = new URLSearchParams({
        sheet: result.sheetId ?? sheetId,
        row: result.rowId,
        template: templateId,
      });
      router.push(`/c/${companyId}/preview?${params.toString()}`);
    } catch {
      setError("That could not be saved. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 style={{ margin: 0 }}>New email</h2>
        </div>

        {templates.length === 0 ? (
          <div className="card-pad">
            <p style={{ marginTop: 0 }}>
              An email is written against a template, and this company has none yet. Add one under{" "}
              <Link href={`/c/${companyId}/templates`}>Templates</Link> first.
            </p>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="card-pad" onSubmit={submit}>
            <label className="field">
              <span>Template</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Campaign name</span>
              <input
                type="text"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="What this is called internally"
                required
                autoFocus
              />
            </label>

            <label className="field">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What it says in an inbox"
              />
            </label>

            <label className="field">
              <span>Preview text</span>
              <input
                type="text"
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="The line beside the subject"
              />
            </label>

            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 160px" }}>
                <span>Send date</span>
                <input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
              </label>
              <label className="field" style={{ flex: "1 1 140px" }}>
                <span>Time</span>
                <input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
              </label>
            </div>

            {/* Only worth asking when there is a choice to make. */}
            {sheets.length > 1 && (
              <label className="field">
                <span>Add to sheet</span>
                <select value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
                  {sheets.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <p className="hint">
              This makes the row and opens it in the preview. Everything else — the copy, the
              images, who it goes to — is edited there.
            </p>

            {error && (
              <p className="hint" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Creating…" : "Create and edit"}
              </button>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SignOff({ item }: { item: OverviewItem }) {
  if (item.hidden) return <span className="badge">Hidden</span>;
  // Where it got to beats how many signed off on it: once something is in
  // Klaviyo, that is the answer to "what is happening with this".
  if (item.published) {
    return (
      <span className="badge badge-sent">
        {item.published === "scheduled" ? "Scheduled" : "Drafted"}
      </span>
    );
  }
  if (item.approvals > 0) {
    return (
      <span className="badge badge-ok">
        {item.approvals} approved
        {item.staleApprovals > 0 ? ` · ${item.staleApprovals} stale` : ""}
      </span>
    );
  }
  if (item.staleApprovals > 0) return <span className="badge badge-warn">Needs re-approval</span>;
  return <span className="hint">—</span>;
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

function CalendarView({
  month,
  setMonth,
  byDate,
  undated,
  href,
}: {
  month: string;
  setMonth: (month: string) => void;
  byDate: Map<string, OverviewItem[]>;
  undated: OverviewItem[];
  href: (item: OverviewItem) => string;
}) {
  const [year, monthNumber] = month.split("-").map(Number);
  const today = todayIso();

  /** Six weeks of cells starting on the Monday on or before the 1st. */
  const cells = useMemo(() => {
    const first = new Date(year, monthNumber - 1, 1);
    const weekday = (first.getDay() + 6) % 7; // Sunday is 0; we want Monday 0
    const start = todayIso(new Date(year, monthNumber - 1, 1 - weekday));
    return Array.from({ length: 42 }, (_, i) => shiftIso(start, i));
  }, [year, monthNumber]);

  const shiftMonth = (by: number) => {
    const next = new Date(year, monthNumber - 1 + by, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  };

  const inThisMonth = (iso: string) => iso.slice(0, 7) === month;
  const monthCount = cells.filter(inThisMonth).reduce((n, iso) => n + (byDate.get(iso)?.length ?? 0), 0);

  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <button type="button" className="btn btn-sm" onClick={() => shiftMonth(-1)}>
            ← Prev
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </button>
          <button type="button" className="btn btn-sm" onClick={() => shiftMonth(1)}>
            Next →
          </button>
          <h2 style={{ marginLeft: 6 }}>
            {MONTHS[monthNumber - 1]} {year}
          </h2>
          <div className="spacer" />
          <span className="hint" style={{ marginTop: 0 }}>
            {monthCount} {monthCount === 1 ? "item" : "items"} this month
          </span>
        </div>

        <div className="cal">
          {WEEKDAYS.map((day) => (
            <div key={day} className="cal-head">
              {day}
            </div>
          ))}
          {cells.map((iso) => {
            const dayItems = byDate.get(iso) ?? [];
            return (
              <div
                key={iso}
                className={`cal-day${inThisMonth(iso) ? "" : " outside"}${iso === today ? " is-today" : ""}`}
              >
                <div className="cal-date">{Number(iso.slice(8, 10))}</div>
                {dayItems.map((item) => (
                  <Link
                    key={item.rowId}
                    href={href(item)}
                    className={
                      `cal-item${item.hidden ? " is-hidden" : ""}` +
                      // Published outranks approved: it is the later state, and
                      // the calendar has one colour to spend per item.
                      (item.published ? " is-sent" : item.approvals > 0 ? " is-approved" : "")
                    }
                    title={calendarTitle(item)}
                  >
                    {item.sendTime && <span className="cal-time">{item.sendTime}</span>}
                    {item.title}
                    <Marks item={item} />
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <h2>No send date</h2>
            <div className="spacer" />
            <span className="hint" style={{ marginTop: 0 }}>
              {undated.length} {undated.length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="card-pad">
            <div className="chiplist">
              {undated.map((item) => (
                <Link
                  key={item.rowId}
                  href={href(item)}
                  className={`cal-item${item.hidden ? " is-hidden" : ""}`}
                  style={{ maxWidth: 260 }}
                  title={calendarTitle(item)}
                >
                  {item.title}
                  <Marks item={item} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


/** The colour of a person, matched to the bubble the preview gives them. */
const MAX_DOTS = 4;

/**
 * Who has approved, and whether anyone has said anything.
 *
 * Two corners with two different jobs. Approvals go bottom-right, one dot per
 * person in that person's own colour, so a glance answers "how many, and who"
 * rather than only "somebody". Notes go top-right in a fixed blue, because
 * that one is a yes-or-no question.
 *
 * A stale approval is drawn hollow rather than dropped: it says this person has
 * looked at the row, which is worth knowing, while making clear they have not
 * signed off on what it says now.
 */
function Marks({ item }: { item: OverviewItem }) {
  const shown = item.approvers.slice(0, MAX_DOTS);
  const extra = item.approvers.length - shown.length;
  if (shown.length === 0 && item.notes === 0) return null;
  return (
    <>
      {item.notes > 0 && <span className="mark-note" aria-hidden />}
      {shown.length > 0 && (
        <span className="mark-dots" aria-hidden>
          {shown.map((person, i) => (
            <span
              key={`${person.initials}-${i}`}
              className={`mark-dot${person.stale ? " is-stale" : ""}`}
              style={{ background: `hsl(${person.hue} 58% 42%)` }}
            />
          ))}
          {extra > 0 && <span className="mark-more">+{extra}</span>}
        </span>
      )}
    </>
  );
}

/** Everything the dots stand for, spelled out for the hover and for a reader. */
function calendarTitle(item: OverviewItem): string {
  const lines = [item.title];
  if (item.templateName) lines.push(item.templateName);
  if (item.published) {
    lines.push(item.published === "scheduled" ? "Scheduled in Klaviyo" : "Drafted in Klaviyo");
  }
  if (item.approvers.length > 0) {
    lines.push(
      `Approved by ${item.approvers
        .map((a) => (a.stale ? `${a.name} (earlier version)` : a.name))
        .join(", ")}`,
    );
  }
  if (item.notes > 0) lines.push(`${item.notes} ${item.notes === 1 ? "note" : "notes"}`);
  return lines.join(" — ");
}
