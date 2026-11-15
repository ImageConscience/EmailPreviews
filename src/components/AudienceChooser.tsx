"use client";

import { useEffect, useState } from "react";

import { listAudiencesAction } from "@/actions/esp";
import { listSmsAudiencesAction } from "@/actions/sms";
import type { EspAudience } from "@/lib/esp/types";

/**
 * Choosing who a campaign goes to, from the account rather than from memory.
 *
 * Which account that is depends on the company's chosen platform; this asks for
 * audiences and is told which platform answered, so none of it has to know
 * whether lists and segments came from Klaviyo or Attentive.
 *
 * The push matches these against the platform by name and refuses anything it
 * cannot find. That is the right behaviour and a poor way to discover a typo -- you
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
 *
 * Email and texts are fed by different hooks and the same picker. Where the
 * list comes from differs -- Klaviyo is asked live, Attentive's segments are a
 * copy a Claude session last saved, since this app holds no Attentive key --
 * and that difference is shown rather than hidden: a stale list that looks live
 * is how somebody sends to a segment that no longer means what they think.
 */

export interface AudiencesState {
  audiences: EspAudience[] | null;
  error: string | null;
  /** Whichever platform answered, for the sentences below. */
  provider: string;
  /**
   * Where this list came from and how fresh it is, where that is not obvious.
   *
   * Null for a list read live. Set for one read from a saved copy, and for an
   * empty list, which otherwise reads as "this account has no segments" when
   * the truth is "nobody has synced them yet".
   */
  note?: string | null;
}

const WAITING: AudiencesState = {
  audiences: null,
  error: null,
  // Until the answer arrives there is nothing truthful to name, and naming the
  // wrong platform for a moment would be worse than naming none.
  provider: "the sending platform",
  note: null,
};

const PLATFORM: Record<string, string> = { klaviyo: "Klaviyo", attentive: "Attentive" };

/** Who this company can email. Read once per screen: two choosers, one trip. */
export function useAudiences(companyId: string, enabled = true): AudiencesState {
  const [state, setState] = useState<AudiencesState>(WAITING);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listAudiencesAction(companyId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setState({ audiences: result.audiences ?? [], error: null, provider: result.provider });
      } else {
        setState({
          audiences: null,
          error: result.error ?? "Could not read this account's lists.",
          provider: result.provider,
        });
      }
    });
    return () => {
      live = false;
    };
  }, [companyId, enabled]);

  return state;
}

/**
 * Who this company can text.
 *
 * A separate hook rather than a flag on the one above, because texting is a
 * separate choice: a company can mail through Klaviyo and text through
 * Attentive, so the two lists can come from two platforms at once and must not
 * share a cache.
 */
export function useSmsAudiences(companyId: string, enabled = true): AudiencesState {
  const [state, setState] = useState<AudiencesState>(WAITING);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void listSmsAudiencesAction(companyId).then((result) => {
      if (!live) return;
      const provider = PLATFORM[result.source ?? ""] ?? "the texting platform";
      if (!result.ok) {
        setState({
          audiences: null,
          error: result.error ?? "Could not read this account's lists.",
          provider,
        });
        return;
      }
      const audiences = result.audiences ?? [];
      setState({ audiences, error: null, provider, note: smsNote(result.source, audiences.length, result.syncedAt) });
    });
    return () => {
      live = false;
    };
  }, [companyId, enabled]);

  return state;
}

/**
 * What to say under a texting picker about where its list came from.
 *
 * Klaviyo is asked live and needs no explanation. Attentive's list is whatever
 * a Claude session last saved through the connector, so it has an age, and when
 * it is empty the useful sentence is how to fill it rather than the fact that
 * it is empty.
 */
function smsNote(source: string | null | undefined, count: number, syncedAt?: string | null): string | null {
  if (source !== "attentive") {
    return source === "klaviyo" && count === 0
      ? "This Klaviyo account has no lists or segments."
      : null;
  }
  if (count === 0) {
    return "No Attentive segments saved yet. Ask Claude to sync this company's Attentive segments.";
  }
  const when = syncedAt ? new Date(syncedAt).toLocaleDateString() : null;
  return `Attentive segments as Claude last saved them${when ? `, ${when}` : ""}.`;
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
  /**
   * Hold the picker: show what is chosen, offer nothing and change nothing.
   *
   * For the case where the list on screen is about to stop applying -- a
   * platform switch that has not been saved yet -- when offering it would be
   * offering names the other platform has never heard of.
   */
  disabled,
}: {
  state: AudiencesState;
  /** Comma-separated names or ids, as stored. */
  value: string;
  onChange: (next: string) => void;
  empty: string;
  inherited?: string | null;
  disabled?: boolean;
}) {
  const { audiences, error, provider, note } = state;
  const chosen = split(value);
  const set = (next: string[]) => onChange(next.join(", "));

  // A value the account does not have: renamed on the platform, or typed before
  // this picker existed. Flagged rather than dropped -- dropping it would silently
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
            {!disabled && (
              <button type="button" aria-label={`Remove ${term}`} onClick={() => set(chosen.filter((t) => t !== term))}>
                ×
              </button>
            )}
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

      {audiences === null && !error && !disabled && (
        <span className="aud-status">Reading {provider}…</span>
      )}

      {/* Nothing to choose from: the note says why, and offering an empty menu
          would only look broken. */}
      {audiences !== null && audiences.length > 0 && !disabled && (
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

      {/* The platform is unreachable: typing is better than being stuck, and the
          push will say so if a name turns out not to match. */}
      {error && !disabled && (
        <input
          type="text"
          value={value}
          placeholder="Names, comma separated"
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {note && !error && <span className="aud-status">{note}</span>}
    </div>
  );
}
