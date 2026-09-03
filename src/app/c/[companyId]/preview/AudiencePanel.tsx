"use client";

import { AudienceChooser, useAudiences } from "@/components/AudienceChooser";
import type { AudienceColumns, AudienceSlots } from "@/lib/template";

/**
 * Who this row goes to, at the head of the rail.
 *
 * Not in the bar above the render: that bar is what surrounds the email, and it
 * is already four fields deep before you reach the email itself. An audience is
 * a fact about the send rather than about what the send looks like, and putting
 * it here costs the render no vertical space at all.
 *
 * Leaving both empty is the ordinary case. The company default covers it and is
 * shown greyed, so the answer is visible on the row it applies to; filling one
 * in is the exception -- the one campaign that goes somewhere else.
 */
export function AudiencePanel({
  companyId,
  slots,
  known,
  fallback,
  values,
  onChange,
}: {
  companyId: string;
  slots: AudienceSlots;
  /** Which of them the sheet already has a column for. */
  known: AudienceColumns;
  /** The company default, shown where the row names nobody. */
  fallback: { audience: string; exclude: string };
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const state = useAudiences(companyId);

  // Same promise the envelope bar makes: a field the sheet has no column for
  // becomes one on save, and says so first.
  const newColumns = (Object.keys(slots) as (keyof AudienceSlots)[])
    .filter((slot) => !known[slot] && (values[slots[slot]] ?? "") !== "")
    .map((slot) => slots[slot]);

  return (
    <div className="ws-section aud-panel">
      <h3>Audience</h3>
      <div className="aud-field">
        <span className="aud-label">To</span>
        <AudienceChooser
          state={state}
          value={values[slots.audience] ?? ""}
          onChange={(next) => onChange(slots.audience, next)}
          empty="Nobody yet — a send needs at least one"
          inherited={fallback.audience || null}
        />
      </div>
      <div className="aud-field">
        <span className="aud-label">Excluding</span>
        <AudienceChooser
          state={state}
          value={values[slots.exclude] ?? ""}
          onChange={(next) => onChange(slots.exclude, next)}
          empty="No exclusions"
          inherited={fallback.exclude || null}
        />
      </div>
      {newColumns.length > 0 && (
        <p className="aud-note">
          Saving adds {newColumns.length === 1 ? "a column" : "columns"} to this sheet:{" "}
          {newColumns.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </p>
      )}
      {state.error && <p className="aud-error">{state.error}</p>}
    </div>
  );
}
