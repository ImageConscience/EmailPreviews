"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  defaultRange,
  formatIso,
  inRange,
  rangeIsOpen,
  shiftIso,
  todayIso,
  type DateRange,
} from "@/lib/campaign";

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
  templates,
  sheets,
}: {
  companyId: string;
  items: OverviewItem[];
  templates: { id: string; name: string }[];
  sheets: { id: string; name: string }[];
}) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [search, setSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [sheetFilter, setSheetFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [range, setRange] = useState<DateRange>(() => defaultRange());
  /** First of the month the calendar is showing. */
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));

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
  }, [items, search, showHidden, sheetFilter, templateFilter]);

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
        </div>
        <div className="card">
          <div className="empty">
            <h3>Nothing to show yet</h3>
            <p>
              Upload a content sheet under <Link href={`/c/${companyId}/sheets`}>Content</Link> and
              every row will appear here.
            </p>
          </div>
        </div>
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

        {view === "list" && (
          <>
            <label className="field" style={{ marginBottom: 0, flex: "0 1 150px" }}>
              <span>From</span>
              <input
                type="date"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label className="field" style={{ marginBottom: 0, flex: "0 1 150px" }}>
              <span>To</span>
              <input
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
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
                onChange={(e) => setRange((r) => ({ ...r, includeUndated: e.target.checked }))}
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

function SignOff({ item }: { item: OverviewItem }) {
  if (item.hidden) return <span className="badge">Hidden</span>;
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
                    className={`cal-item${item.hidden ? " is-hidden" : ""}${item.approvals > 0 ? " is-approved" : ""}`}
                    title={`${item.title}${item.templateName ? ` — ${item.templateName}` : ""}`}
                  >
                    {item.sendTime && <span className="cal-time">{item.sendTime}</span>}
                    {item.title}
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
                >
                  {item.title}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
