"use client";

import type { EnvelopeColumns } from "@/lib/template";

/**
 * Subject line, preview text and the send date and time, shown above the render.
 *
 * These are what surrounds the email rather than what is in it: the first two
 * are what the recipient sees before opening anything, the other two decide
 * when they see it. All four are set by the sending platform rather than living
 * in the email body, which is why they sit outside the rendered frame instead
 * of being placeholders inside it -- and all four are campaign decisions that
 * get reviewed and approved with the copy, which is why they are here at all.
 */

/** yyyy-mm-dd, the only thing a date input will accept or give back. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** hh:mm, optionally with seconds. */
const ISO_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export function EnvelopeFields({
  columns,
  values,
  baseline,
  width,
  onChange,
}: {
  columns: EnvelopeColumns;
  values: Record<string, string>;
  baseline: Record<string, string>;
  /** Match the width of the frame below, so the two read as one object. */
  width: number | null;
  onChange: (key: string, value: string) => void;
}) {
  if (!columns.subject && !columns.preheader && !columns.sendDate && !columns.sendTime) {
    return null;
  }

  const field = (
    key: string | null,
    label: string,
    className: string,
    placeholder: string,
    /**
     * A native picker only when the cell is already in the format it emits.
     * A sheet that says "8/27/26" would come back from a date input empty, so
     * anything it cannot represent stays a plain text box and keeps its value.
     */
    nativeType?: { type: "date" | "time"; accepts: RegExp },
  ) => {
    const value = key ? (values[key] ?? "") : "";
    const edited = key ? value !== (baseline[key] ?? "") : false;
    const type =
      nativeType && (value === "" || nativeType.accepts.test(value)) ? nativeType.type : "text";

    return (
      <div className={`env-row ${className}`}>
        <span className="env-label">{label}</span>
        {key ? (
          <input
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(key, e.target.value)}
            title={edited ? "Edited — save to keep this" : undefined}
            style={edited ? { borderColor: "var(--accent)" } : undefined}
          />
        ) : (
          <span className="env-missing">No {label.toLowerCase()} column in this sheet</span>
        )}
      </div>
    );
  };

  return (
    <div className="envelope" style={{ maxWidth: width ? `${width}px` : "100%" }}>
      {field(columns.subject, "Subject", "subject", "Subject line")}
      {field(columns.preheader, "Preview", "preheader", "Preview text shown beside the subject")}
      {(columns.sendDate || columns.sendTime) && (
        <div className="env-row env-schedule">
          <span className="env-label">Send</span>
          <div className="env-schedule-fields">
            {columns.sendDate &&
              field(columns.sendDate, "Date", "env-inline", "yyyy-mm-dd", {
                type: "date",
                accepts: ISO_DATE,
              })}
            {columns.sendTime &&
              field(columns.sendTime, "Time", "env-inline", "hh:mm", {
                type: "time",
                accepts: ISO_TIME,
              })}
          </div>
        </div>
      )}
    </div>
  );
}
