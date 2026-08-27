"use client";

import { useState } from "react";
import { toggleApprovalAction } from "@/actions/approvals";
import type { ApprovalView } from "@/lib/approval";

const MAX_BUBBLES = 5;

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Sign-off for the row currently on screen, in the template currently on
 * screen. The pair matters: the same copy in a different layout is a different
 * email, and is approved separately.
 */
export function ApprovalBar({
  companyId,
  rowId,
  templateId,
  currentUserId,
  approvals,
  dirty,
  onChange,
}: {
  companyId: string;
  rowId: string | null;
  templateId: string;
  currentUserId: string;
  approvals: ApprovalView[];
  /** Unsaved edits are pending, so there is nothing settled to approve. */
  dirty: boolean;
  onChange: (approvals: ApprovalView[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = approvals.find((a) => a.userId === currentUserId);
  const mineIsStale = Boolean(mine?.stale);
  const current = approvals.filter((a) => !a.stale);
  const stale = approvals.filter((a) => a.stale);
  const shown = approvals.slice(0, MAX_BUBBLES);
  const overflow = approvals.length - shown.length;

  const toggle = async () => {
    if (!rowId || !templateId || saving) return;
    setSaving(true);
    setError(null);
    const result = await toggleApprovalAction(companyId, rowId, templateId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record that.");
      return;
    }
    onChange(result.approvals ?? []);
  };

  if (!rowId || !templateId) return null;

  return (
    <div className="approval">
      <button
        type="button"
        className={`btn btn-sm btn-approve${mine && !mineIsStale ? " is-approved" : ""}`}
        onClick={() => void toggle()}
        disabled={saving || dirty}
        title={
          dirty
            ? "Save your changes first — an approval records one specific version"
            : mineIsStale
              ? "You approved an earlier version — sign off on this one"
              : mine
                ? "Withdraw your approval"
                : "Approve this row in this template"
        }
      >
        {saving ? "…" : mineIsStale ? "Re-approve" : mine ? "✓ Approved" : "Approve"}
      </button>

      {approvals.length > 0 ? (
        <div className="avatars">
          {shown.map((a) => (
            <span
              key={a.userId}
              className={`av${a.stale ? " stale" : ""}`}
              style={{ background: `hsl(${a.hue} 58% 42%)` }}
              title={`${a.name} — ${when(a.at)}${a.stale ? " (before the latest edit)" : ""}`}
            >
              {a.initials}
            </span>
          ))}
          {overflow > 0 && (
            <span
              className="av more"
              title={approvals
                .slice(MAX_BUBBLES)
                .map((a) => a.name)
                .join(", ")}
            >
              +{overflow}
            </span>
          )}
        </div>
      ) : (
        <span className="none">No approvals yet</span>
      )}

      {stale.length > 0 && (
        <span className="stale-note" title="These were given before the latest edit">
          {current.length}/{approvals.length} current
        </span>
      )}
      {error && (
        <span className="stale-note" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
