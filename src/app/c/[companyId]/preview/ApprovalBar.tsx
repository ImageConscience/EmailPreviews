"use client";

import { useState } from "react";
import { toggleApprovalAction } from "@/actions/approvals";
import type { ApprovalView } from "@/lib/approval";
import type { PushMark } from "./PreviewWorkspace";

const MAX_BUBBLES = 5;

/** " on 4 Dec by Sam", when we know. */
function pushedWhen(push: PushMark | null): string {
  if (!push) return "";
  const who = push.pushedBy ? ` by ${push.pushedBy}` : "";
  return ` — pushed ${when(push.pushedAt)}${who}`;
}

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
  push,
  dirty,
  onChange,
}: {
  companyId: string;
  rowId: string | null;
  templateId: string;
  currentUserId: string;
  approvals: ApprovalView[];
  /** What this row is in Klaviyo in this template, if anything. */
  push: PushMark | null;
  /** Unsaved edits are pending, so there is nothing settled to approve. */
  dirty: boolean;
  onChange: (approvals: ApprovalView[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = approvals.find((a) => a.userId === currentUserId);
  const mineIsStale = Boolean(mine?.stale);

  /**
   * Once this pair is in Klaviyo the button stops being a toggle and becomes a
   * statement of where the email got to. It reads "Scheduled" or "Drafted"
   * rather than "Approved" because that is now the more useful fact -- and the
   * approval it went out on is not something to be quietly taken back
   * afterwards. Changing the content is still open: editing the row makes every
   * approval on it stale exactly as before.
   */
  const published =
    push?.status === "scheduled" ? "Scheduled" : push?.status === "draft" ? "Drafted" : null;
  const locked = Boolean(published) && Boolean(mine) && !mineIsStale;
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
        className={
          `btn btn-sm btn-approve${mine && !mineIsStale ? " is-approved" : ""}` +
          (locked ? " is-published" : "")
        }
        onClick={() => void toggle()}
        disabled={saving || dirty || locked}
        title={
          locked
            ? `${published} in Klaviyo${pushedWhen(push)}. The sign-off it went out on cannot be ` +
              "withdrawn; edit the row if it needs changing."
            : dirty
              ? "Save your changes first — an approval records one specific version"
              : mineIsStale
                ? "You approved an earlier version — sign off on this one"
                : mine
                  ? "Withdraw your approval"
                  : "Approve this row in this template"
        }
      >
        {saving
          ? "…"
          : locked
            ? `✓ ${published}`
            : mineIsStale
              ? "Re-approve"
              : mine
                ? "✓ Approved"
                : "Approve"}
      </button>

      {/* Pushed, but this reviewer has not signed off on what is on screen now:
          the button is still theirs to press, so the state is said beside it
          rather than in it. */}
      {published && !locked && (
        <span className="badge badge-sent" title={`In Klaviyo${pushedWhen(push)}`}>
          {published}
          {mineIsStale || approvals.some((a) => a.stale) ? " · edited since" : ""}
        </span>
      )}

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
