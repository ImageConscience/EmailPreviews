"use client";

import { useEffect, useState } from "react";

import { listKlaviyoAudiencesAction } from "@/actions/klaviyo";
import type { Audience } from "@/lib/klaviyo";

/**
 * Choosing who a campaign goes to, from the account rather than from memory.
 *
 * The push matches these against Klaviyo by name and refuses anything it cannot
 * find. That is the right behaviour and a poor way to discover a typo -- you
 * find out at the moment you were trying to send. Picking from the real lists
 * takes that whole class of mistake out of existence.
 *
 * What gets stored is the name, so an exported sheet stays readable and can
 * still be filled in by hand. The exception is a name shared by a list and a
 * segment: the push refuses an ambiguous name outright, so the id is stored
 * instead rather than offering something that would then be rejected.
 *
 * One component for the per-row audience and the company default, because the
 * two have to agree about what a stored value means.
 */

export interface AudiencesState {
  audiences: Audience[] | null;
  error: string | null;
}

/** Read once per screen: two choosers should not be two round trips. */
export function useAudiences(companyId: string, enabled = true): AudiencesState {
  const [state, setState] = useState<AudiencesState>({ audiences: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listKlaviyoAudiencesAction(companyId).then((result) => {
      if (!live) return;
      if (result.ok) setState({ audiences: result.audiences ?? [], error: null });
      else setState({ audiences: null, error: result.error ?? "Could not read this account's lists." });
    });
    return () => {
      live = false;
    };
  }, [companyId, enabled]);

  return state;
}

function split(cell: string): string[] {
  return cell.split(",").map((part) => part.trim()).filter(Boolean);
}

export function AudienceChooser({
  state,
  value,
  onChange,
  empty,
  /** Shown greyed where the value is empty and something else supplies it. */
  inherited,
}: {
  state: AudiencesState;
  /** Comma-separated names or ids, as stored. */
  value: string;
  onChange: (next: string) => void;
  empty: string;
  inherited?: string | null;
}) {
  const { audiences, error } = state;
  const chosen = split(value);
  const set = (next: string[]) => onChange(next.join(", "));

  // A value the account does not have: renamed in Klaviyo, or typed before this
  // picker existed. Flagged rather than dropped -- dropping it would silently
  // change who gets the email.
  const missing = (term: string) =>
    audiences !== null &&
    !audiences.some((a) => a.id === term || a.name.toLowerCase() === term.toLowerCase());

  return (
    <div className="aud-body">
      <div className="aud-chips">
        {chosen.map((term) => (
          <span key={term} className={`aud-chip${missing(term) ? " is-missing" : ""}`}>
            {term}
            {missing(term) && <em title="Not a list or segment on this account"> ?</em>}
            <button type="button" aria-label={`Remove ${term}`} onClick={() => set(chosen.filter((t) => t !== term))}>
              ×
            </button>
          </span>
        ))}
        {chosen.length === 0 &&
          (inherited ? (
            <span className="aud-inherited" title="From this company's default audience">
              {inherited}
            </span>
          ) : (
            <span className="aud-none">{empty}</span>
          ))}
      </div>

      {audiences === null && !error && <span className="aud-status">Reading Klaviyo…</span>}

      {audiences !== null && (
        <select
          value=""
          onChange={(event) => {
            const picked = audiences.find((a) => a.id === event.target.value);
            if (!picked) return;
            const sameName = audiences.filter(
              (a) => a.name.toLowerCase() === picked.name.toLowerCase(),
            );
            const term = sameName.length > 1 ? picked.id : picked.name;
            if (!chosen.includes(term)) set([...chosen, term]);
          }}
        >
          <option value="">Add a list or segment…</option>
          {audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
      )}

      {/* Klaviyo unreachable: typing is better than being stuck, and the push
          will say so if a name turns out not to match. */}
      {error && (
        <input
          type="text"
          value={value}
          placeholder="Names, comma separated"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
