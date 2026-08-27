"use client";

import type { EnvelopeColumns } from "@/lib/template";

/**
 * Subject line and preview text, shown above the render.
 *
 * These are what the recipient sees before opening anything, so they are
 * reviewed and approved with the rest of the copy -- but they are set by the
 * sending platform rather than living in the email body, which is why they sit
 * outside the rendered frame instead of being placeholders inside it.
 */
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
  if (!columns.subject && !columns.preheader) return null;

  const field = (
    key: string | null,
    label: string,
    className: string,
    placeholder: string,
  ) => (
    <div className={`env-row ${className}`}>
      <span className="env-label">{label}</span>
      {key ? (
        <input
          type="text"
          value={values[key] ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(key, e.target.value)}
          title={
            (values[key] ?? "") !== (baseline[key] ?? "")
              ? "Edited — save to keep this"
              : undefined
          }
          style={
            (values[key] ?? "") !== (baseline[key] ?? "")
              ? { borderColor: "var(--accent)" }
              : undefined
          }
        />
      ) : (
        <span className="env-missing">
          No {label.toLowerCase()} column in this sheet
        </span>
      )}
    </div>
  );

  return (
    <div className="envelope" style={{ maxWidth: width ? `${width}px` : "100%" }}>
      {field(columns.subject, "Subject", "subject", "Subject line")}
      {field(columns.preheader, "Preview", "preheader", "Preview text shown beside the subject")}
    </div>
  );
}
