"use client";

import { AudienceChooser, useAudiences } from "@/components/AudienceChooser";
import type { AudienceColumns, AudienceSlots, EnvelopeColumns, EnvelopeSlots } from "@/lib/template";

/**
 * Subject line, preview text and the send date and time, shown above the render.
 *
 * These are what surrounds the email rather than what is in it: the first two
 * are what the recipient sees before opening anything, the other two decide
 * when they see it. All four are set by the sending platform rather than living
 * in the email body, which is why they sit outside the rendered frame instead
 * of being placeholders inside it -- and all four are campaign decisions that
 * get reviewed and approved with the copy, which is why they are here at all.
 *
 * All four always show, even when the sheet has no column for them. Every
 * campaign has a subject and a moment it goes out whether or not whoever built
 * the spreadsheet thought to add a column; typing here creates one on save.
 */

/** yyyy-mm-dd, the only thing a date input will accept or give back. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** hh:mm, optionally with seconds. */
const ISO_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export function EnvelopeFields({
  slots,
  known,
  audience,
  values,
  baseline,
  width,
  highlightMissing,
  onChange,
}: {
  /** The key each field reads and writes: the sheet's column, or the default. */
  slots: EnvelopeSlots;
  /** Which of them the sheet actually had, for the "will be added" note. */
  known: EnvelopeColumns;
  /**
   * Who it goes to -- only when the company is connected to Klaviyo. Without an
   * account there is nowhere for an audience to mean anything, and asking every
   * company for one would put a required-looking field in front of people whose
   * work ends at the approval.
   */
  audience: {
    companyId: string;
    slots: AudienceSlots;
    known: AudienceColumns;
    /** The company default, shown where the row names nobody. */
    fallback: { audience: string; exclude: string };
  } | null;
  values: Record<string, string>;
  baseline: Record<string, string>;
  /** Match the width of the frame below, so the two read as one object. */
  width: number | null;
  /**
   * When gaps are highlighted, the placeholder text describes what belongs in
   * an empty field. With highlighting off the question is what this actually
   * looks like, and grey hint text sitting where a subject line goes reads like
   * a subject line -- so it goes away.
   */
  highlightMissing: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const field = (
    key: string,
    label: string,
    className: string,
    hint: string,
    /**
     * A native picker only when the cell is already in the format it emits.
     * A sheet that says "8/27/26" would come back from a date input empty, so
     * anything it cannot represent stays a plain text box and keeps its value.
     */
    nativeType?: { type: "date" | "time"; accepts: RegExp },
  ) => {
    const value = values[key] ?? "";
    const edited = value !== (baseline[key] ?? "");
    const type =
      nativeType && (value === "" || nativeType.accepts.test(value)) ? nativeType.type : "text";

    return (
      <div className={`env-row ${className}`}>
        <span className="env-label">{label}</span>
        <input
          type={type}
          value={value}
          placeholder={highlightMissing ? hint : ""}
          onChange={(event) => onChange(key, event.target.value)}
          title={edited ? "Edited — save to keep this" : undefined}
          style={edited ? { borderColor: "var(--accent)" } : undefined}
        />
      </div>
    );
  };

  /** Fields the sheet has no column for yet, named once under the bar. */
  const newColumns = [
    ...(Object.keys(slots) as (keyof EnvelopeSlots)[])
      .filter((slot) => !known[slot] && (values[slots[slot]] ?? "") !== "")
      .map((slot) => slots[slot]),
    ...(audience
      ? (Object.keys(audience.slots) as (keyof AudienceSlots)[])
          .filter((slot) => !audience.known[slot] && (values[audience.slots[slot]] ?? "") !== "")
          .map((slot) => audience.slots[slot])
      : []),
  ];

  return (
    <div className="envelope" style={{ maxWidth: width ? `${width}px` : "100%" }}>
      {field(slots.subject, "Subject", "subject", "Subject line")}
      {field(slots.preheader, "Preview", "preheader", "Preview text shown beside the subject")}
      <div className="env-row env-schedule">
        <span className="env-label">Send</span>
        <div className="env-schedule-fields">
          {field(slots.sendDate, "Date", "env-inline", "yyyy-mm-dd", {
            type: "date",
            accepts: ISO_DATE,
          })}
          {field(slots.sendTime, "Time", "env-inline", "hh:mm", {
            type: "time",
            accepts: ISO_TIME,
          })}
        </div>
      </div>
      {audience && (
        <AudienceRow
          companyId={audience.companyId}
          slots={audience.slots}
          fallback={audience.fallback}
          values={values}
          onChange={onChange}
        />
      )}
      {newColumns.length > 0 && (
        <p className="env-note">
          Saving adds {newColumns.length === 1 ? "a new column" : "new columns"} to this sheet:{" "}
          {newColumns.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audience                                                            */
/* ------------------------------------------------------------------ */

/**
 * Who this row goes to, when there is a Klaviyo account to send it through.
 *
 * Leaving both empty is the ordinary case: the company default covers it, and
 * it is shown greyed here so the answer is visible on the row it applies to.
 * Filling one in is the exception -- one campaign that goes somewhere else.
 */
function AudienceRow({
  companyId,
  slots,
  fallback,
  values,
  onChange,
}: {
  companyId: string;
  slots: AudienceSlots;
  fallback: { audience: string; exclude: string };
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const state = useAudiences(companyId);

  return (
    <div className="env-row env-audience">
      <span className="env-label">Audience</span>
      <div className="aud-fields">
        <div className="aud-field">
          <span className="env-label aud-label">To</span>
          <AudienceChooser
            state={state}
            value={values[slots.audience] ?? ""}
            onChange={(next) => onChange(slots.audience, next)}
            empty="Nobody yet — a send needs at least one"
            inherited={fallback.audience || null}
          />
        </div>
        <div className="aud-field">
          <span className="env-label aud-label">Excluding</span>
          <AudienceChooser
            state={state}
            value={values[slots.exclude] ?? ""}
            onChange={(next) => onChange(slots.exclude, next)}
            empty="No exclusions"
            inherited={fallback.exclude || null}
          />
        </div>
        {state.error && (
          <p className="env-note" style={{ color: "var(--danger)" }}>{state.error}</p>
        )}
      </div>
    </div>
  );
}
