"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { pushToKlaviyoAction, type PushMode } from "@/actions/push";
import { describe, zonedToUtc } from "@/lib/zone";
import { flag, isOn, useViewState, validId } from "@/lib/view-state";

export interface PushedState {
  campaignId: string;
  campaignName: string;
  status: string;
  scheduledFor: string | null;
  audienceNames: string;
  pushedAt: string;
  pushedBy: string | null;
  /** The row has been edited since it was pushed, so Klaviyo holds older content. */
  stale: boolean;
}

export interface PushItem {
  rowId: string;
  sheetId: string;
  sheetName: string;
  templateId: string;
  templateName: string;
  title: string;
  subject: string;
  campaignName: string;
  audience: string;
  /** The audience came from the company default rather than this row. */
  audienceInherited: boolean;
  /** Who has signed off in this template, current or not. */
  approvers: { name: string; initials: string; hue: number; admin: boolean; stale: boolean }[];
  /** The send instant the row asks for, if it names one. */
  sendAt: string | null;
  sendAtLabel: string | null;
  /** The sheet's own cells, which the dialog can edit. */
  sheetDate: string;
  sheetTime: string;
  /** Whether that instant is real and still in the future. */
  canSchedule: boolean;
  /** The row names a send time that has already gone by. */
  past: boolean;
  warning: string | null;
  pushed: PushedState | null;
}

/**
 * The push queue.
 *
 * Everything on this list is already eligible -- the server filtered it -- so
 * the screen does not spend space explaining why things are missing. What it
 * does spend space on is the two facts you need before pressing a button that
 * writes into a client's account: which account, and what has already been
 * pushed. Rows that are already in Klaviyo stay on the list rather than
 * vanishing, because "did that go over?" is the question this screen exists to
 * answer as much as "send this one".
 */
export function PushBoard({
  companyId,
  items,
  accountName,
  fromLabel,
  timezone,
  ready,
}: {
  companyId: string;
  items: PushItem[];
  accountName: string;
  fromLabel: string;
  timezone: string;
  ready: boolean;
}) {
  const router = useRouter();
  const initial = useMemo(
    () => ({ sheet: "", pushed: flag(true) }),
    [],
  );
  const { state, set } = useViewState(`push:${companyId}`, initial);

  const sheets = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) seen.set(item.sheetId, item.sheetName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [items]);

  // A remembered filter can name a sheet that has since been deleted or
  // re-uploaded, and a filter matching nothing shows an empty screen with no
  // hint as to why.
  const sheet = validId(state.sheet, sheets.map((s) => s.id));
  const showPushed = isOn(state.pushed);

  const visible = items.filter(
    (item) => (!sheet || item.sheetId === sheet) && (showPushed || !item.pushed),
  );

  const [open, setOpen] = useState<PushItem | null>(null);

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Push to Klaviyo</h1>
          <p>
            Into <strong>{accountName}</strong>, from {fromLabel}. Send times are read as{" "}
            {timezone.replace("_", " ")}.
          </p>
        </div>
      </div>

      {!ready && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-pad">
            <p className="hint" style={{ margin: 0, color: "var(--danger)" }}>
              This account still needs a from-address and a base template before anything can be
              pushed. Set them under{" "}
              <Link href={`/c/${companyId}/integrations`}>Settings → Integrations</Link>.
            </p>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={sheet}
          onChange={(e) => set({ sheet: e.target.value })}
          style={{ width: "auto", maxWidth: 260 }}
          aria-label="Sheet"
        >
          <option value="">All sheets</option>
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, alignItems: "center", margin: 0 }}>
          <input
            type="checkbox"
            checked={showPushed}
            onChange={(e) => set({ pushed: flag(e.target.checked) })}
          />
          <span className="hint" style={{ margin: 0 }}>Show ones already pushed</span>
        </label>
        <div className="spacer" />
        <span className="hint" style={{ margin: 0 }}>
          {visible.length} of {items.length} ready
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="empty">
            <h3>Nothing is ready to push</h3>
            <p>
              A row appears here once it is approved in its template and has a subject and an{" "}
              <code>audience</code>. The{" "}
              <Link href={`/c/${companyId}/overview`}>overview</Link> shows what is still waiting on
              a sign-off.
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 14, overflowX: "auto" }}>
          <table className="ov-table">
            <thead>
              <tr>
                <th className="tight">Send</th>
                <th>Campaign</th>
                <th className="tight">Sign-off</th>
                <th className="tight">Audience</th>
                <th className="tight">In Klaviyo</th>
                <th className="tight" />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={`${item.rowId}:${item.templateId}`}>
                  <td className="tight ov-when">
                    {item.sendAtLabel ? (
                      <>
                        <strong>{item.sendAtLabel}</strong>
                        {item.past && <span className="ov-time">date has passed</span>}
                      </>
                    ) : (
                      <span className="ov-nodate">No date</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/c/${companyId}/preview?sheet=${item.sheetId}&row=${item.rowId}`}
                      className="ov-title"
                    >
                      {item.campaignName || item.title}
                    </Link>
                    <div className="ov-sub">
                      {[item.subject, item.templateName, item.sheetName].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="tight">
                    <Approvers people={item.approvers} />
                  </td>
                  <td className="tight">
                    <span
                      className="badge"
                      title={item.audienceInherited ? "From this company's default audience" : undefined}
                    >
                      {item.audience}
                      {item.audienceInherited && " *"}
                    </span>
                  </td>
                  <td className="tight">
                    <PushedCell item={item} />
                  </td>
                  <td className="tight">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!ready}
                      onClick={() => setOpen(item)}
                    >
                      {item.pushed ? "Push again" : "Push…"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <PushDialog
          companyId={companyId}
          item={open}
          accountName={accountName}
          timezone={timezone}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

/**
 * Who has signed this off, in the same dots the calendar uses.
 *
 * A dotted outline means the sign-off predates the latest edit. Those no longer
 * hold the push up -- one current admin approval is the gate -- but they are
 * still worth seeing: it is the difference between a row two people have read
 * and a row one person waved through.
 */
function Approvers({
  people,
}: {
  people: { name: string; initials: string; hue: number; admin: boolean; stale: boolean }[];
}) {
  if (people.length === 0) return <span className="hint">—</span>;
  return (
    <span className="push-dots">
      {people.map((person, i) => (
        <span
          key={`${person.initials}-${i}`}
          className={`av${person.stale ? " stale" : ""}${person.admin ? " is-admin" : ""}`}
          style={{ background: `hsl(${person.hue} 58% 42%)` }}
          title={
            `${person.name}${person.admin ? " (admin)" : ""}` +
            (person.stale ? " — approved an earlier version" : "")
          }
        >
          {person.initials}
        </span>
      ))}
    </span>
  );
}

/** What Klaviyo already holds for this row, and whether it is still current. */
function PushedCell({ item }: { item: PushItem }) {
  if (!item.pushed) return <span className="hint">—</span>;
  const { pushed } = item;
  const label = pushed.status === "scheduled" ? "Scheduled" : "Draft";
  return (
    <div>
      <span className={`badge ${pushed.status === "scheduled" ? "badge-ok" : ""}`}>{label}</span>
      {pushed.stale && (
        <div className="ov-sub" style={{ color: "var(--danger)" }}>
          Edited since — push again
        </div>
      )}
      <div className="ov-sub">
        {new Date(pushed.pushedAt).toLocaleDateString()}
        {pushed.pushedBy ? ` · ${pushed.pushedBy}` : ""}
      </div>
    </div>
  );
}

/**
 * The last thing between a row and a client's customers.
 *
 * Draft and Schedule are one dialog rather than two buttons on the row: the
 * difference between them is the whole decision, and it should be made while
 * looking at who it goes to and when, not from a table cell. Schedule is only
 * offered when the row names a time that has not passed, because a scheduled
 * campaign with no time is not something Klaviyo will accept and not something
 * this screen should pretend to offer.
 */
function PushDialog({
  companyId,
  item,
  accountName,
  timezone,
  onClose,
  onDone,
}: {
  companyId: string;
  item: PushItem;
  accountName: string;
  timezone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<PushMode>("draft");
  const [date, setDate] = useState(item.sheetDate);
  const [time, setTime] = useState(item.sheetTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);

  // The send time is read live rather than taken from the row, because these
  // inputs can change it: what Schedule offers has to answer to what is on
  // screen, not to what the sheet said when the page was drawn.
  const when = date ? zonedToUtc(date, time, timezone) : { utc: null, warning: undefined };
  const canSchedule = Boolean(when.utc && when.utc.getTime() > Date.now());
  const label = when.utc ? describe(when.utc, timezone) : null;
  const changed = date !== item.sheetDate || time !== item.sheetTime;
  const unreadable = Boolean(date) && !when.utc;

  // Losing the Schedule option while it is selected would otherwise leave the
  // button saying "Push and schedule" over a time nothing can schedule.
  const effectiveMode: PushMode = canSchedule ? mode : "draft";

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await pushToKlaviyoAction(
        companyId,
        item.rowId,
        item.templateId,
        effectiveMode,
        changed ? { date, time } : undefined,
      );
      if (!result.ok) {
        setError(result.error ?? "Could not push.");
        return;
      }
      setNotes(result.notes ?? []);
      setDone(true);
    } catch {
      // The push either reached Klaviyo or it did not, and from here there is
      // no way to tell which -- so say so rather than inviting a second press
      // that could make a second campaign.
      setError(
        "Lost contact with the server part-way through. Check the campaign in Klaviyo before " +
          "pushing again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{done ? "Pushed" : "Push to Klaviyo"}</h2>
        </div>

        <div className="card-pad">
          {done ? (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{item.campaignName || item.title}</strong> is in {accountName} as a{" "}
                {effectiveMode === "scheduled" ? "scheduled campaign" : "draft"}.
              </p>
              {notes?.map((note, i) => (
                <p key={i} className="hint">
                  {note}
                </p>
              ))}
              <button type="button" className="btn btn-primary" onClick={onDone}>
                Done
              </button>
            </>
          ) : (
            <>
              <dl className="push-facts">
                <dt>Campaign</dt>
                <dd>{item.campaignName || item.title}</dd>
                <dt>Subject</dt>
                <dd>{item.subject}</dd>
                <dt>To</dt>
                <dd>
                  {item.audience}
                  {item.audienceInherited && (
                    <span className="hint" style={{ display: "block", fontWeight: 400 }}>
                      This company&rsquo;s default — the row does not name one.
                    </span>
                  )}
                </dd>
                <dt>Account</dt>
                <dd>{accountName}</dd>
              </dl>

              {/*
                The sheet is where a send time lives, so this is prefilled from
                it and writes back to it. Editing here is for the change you
                make with your hand already on the push button -- not a second
                place for a send time to be kept.
              */}
              <div className="push-when">
                <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                  <label className="field" style={{ margin: 0 }}>
                    <span>Send date</span>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </label>
                  <label className="field" style={{ margin: 0 }}>
                    <span>Time</span>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </label>
                  {changed && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setDate(item.sheetDate);
                        setTime(item.sheetTime);
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <p className="hint">
                  {unreadable ? (
                    <span style={{ color: "var(--danger)" }}>
                      That is not a date and time this can read.
                    </span>
                  ) : label ? (
                    <>Goes out {label}.</>
                  ) : (
                    "No send time. It can be pushed as a draft and dated later."
                  )}
                </p>
                {changed && !unreadable && (
                  <p className="hint" style={{ color: "var(--accent)" }}>
                    This also changes the sheet, which is where the send time lives.{" "}
                    {item.sheetDate || item.sheetTime
                      ? `It currently says ${[item.sheetDate, item.sheetTime].filter(Boolean).join(" ")}.`
                      : "It currently has none."}
                  </p>
                )}
              </div>

              {when.warning && (
                <p className="hint" style={{ color: "var(--danger)" }}>{when.warning}</p>
              )}
              {item.pushed?.status === "scheduled" ? (
                <p className="hint" style={{ color: "var(--danger)" }}>
                  This is already scheduled in Klaviyo. Klaviyo will not let a queued campaign be
                  edited, so pushing again takes it out of the queue first — choose Schedule if it
                  should go back in.
                </p>
              ) : (
                item.pushed && (
                  <p className="hint">
                    This row is already in Klaviyo as a draft. Pushing again replaces its content
                    rather than creating a second campaign.
                  </p>
                )
              )}

              <fieldset className="push-modes">
                <legend className="hint" style={{ margin: 0 }}>What should happen</legend>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    checked={effectiveMode === "draft"}
                    onChange={() => setMode("draft")}
                  />
                  <span>
                    <strong>Draft</strong>
                    <span className="hint">
                      Created in Klaviyo and left alone. It carries its send time if the row has
                      one, but nothing sends until somebody schedules it.
                    </span>
                  </span>
                </label>
                <label className={canSchedule ? "" : "is-off"}>
                  <input
                    type="radio"
                    name="mode"
                    checked={effectiveMode === "scheduled"}
                    disabled={!canSchedule}
                    onChange={() => setMode("scheduled")}
                  />
                  <span>
                    <strong>Schedule</strong>
                    <span className="hint">
                      {canSchedule ? (
                        <>Klaviyo will send this to {item.audience} at {label}.</>
                      ) : unreadable ? (
                        "That date and time cannot be read."
                      ) : when.utc ? (
                        "That send time has already passed. Pick a later one."
                      ) : (
                        "Scheduling needs a send date and time. Set one above."
                      )}
                    </span>
                  </span>
                </label>
              </fieldset>

              {effectiveMode === "scheduled" && (
                <p className="hint" style={{ color: "var(--danger)" }}>
                  This puts a real send in {accountName}&rsquo;s queue.
                </p>
              )}
              {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}

              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || unreadable}
                  onClick={() => void run()}
                >
                  {busy
                    ? "Talking to Klaviyo…"
                    : effectiveMode === "scheduled"
                      ? "Push and schedule"
                      : "Push as draft"}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
