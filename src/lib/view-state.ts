"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Filter and view settings that live in the URL.
 *
 * One mechanism doing two jobs. In the URL they survive a reload and leaving
 * the page and coming back, and the address bar becomes something you can paste
 * to a colleague -- "look at September, artist spotlights only, no hidden items"
 * is a link rather than a paragraph of instructions. In localStorage they come
 * back when you return to the tab with a bare URL, so your own working state is
 * not reset every time you move between Overview and Preview.
 *
 * The URL always wins over what was stored: a link someone sends must show them
 * what it says, not what the recipient happened to be looking at last.
 *
 * Only values that differ from the defaults are written, so a URL stays short
 * enough to read and to paste. The address is updated with history.replaceState
 * rather than the router: this is the same page with a different view of it, so
 * it should neither reload the route nor leave a trail of history entries as
 * someone types in a search box. The trade-off is deliberate -- Back leaves the
 * page rather than undoing the last filter change.
 */

type State = Record<string, string>;

function storageKeyFor(scope: string): string {
  return `emailpreviews:view:${scope}`;
}

function readStored(scope: string): State | null {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as State;
  } catch {
    // Private mode, cleared storage, or a value written by an older build.
    return null;
  }
}

function resolve<T extends State>(defaults: T, stored: State | null, search: string): T {
  const params = new URLSearchParams(search);
  const next = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const fromUrl = params.get(key);
    if (fromUrl !== null) {
      next[key as keyof T] = fromUrl as T[keyof T];
    } else if (stored && typeof stored[key] === "string") {
      next[key as keyof T] = stored[key] as T[keyof T];
    }
  }
  return next;
}

export interface ViewState<T extends State> {
  state: T;
  /** Change one or more settings. */
  set: (patch: Partial<T>) => void;
  /** True once the URL and stored state have been read, after first paint. */
  ready: boolean;
  /** The shareable address for what is on screen right now. */
  href: () => string;
}

/** Put the settings that differ from the defaults into the address bar. */
function publish<T extends State>(next: T, defaults: T): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(next)) {
    // Anything at its default is implied, and leaving it out keeps the
    // address readable.
    if (value === defaults[key]) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

export function useViewState<T extends State>(scope: string, defaults: T): ViewState<T> {
  // Defaults on the server and on first paint, so the markup matches; the real
  // values arrive in the effect below, since localStorage cannot be read during
  // render and reading the URL there would differ between server and client.
  const [state, setState] = useState<T>(defaults);
  const [ready, setReady] = useState(false);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    const restored = resolve(defaultsRef.current, readStored(scope), window.location.search);
    setState(restored);
    // Arriving on a bare URL restores the last view from storage; the address
    // has to say so, or copying the link would share the defaults instead of
    // what is on screen.
    publish(restored, defaultsRef.current);
    setReady(true);

    // Back and forward should move the view, not just the address bar.
    const onPop = () => setState(resolve(defaultsRef.current, null, window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [scope]);

  const set = useCallback((patch: Partial<T>) => {
    setState((previous) => {
      const next = { ...previous, ...patch };

      publish(next, defaultsRef.current);

      try {
        window.localStorage.setItem(storageKeyFor(scope), JSON.stringify(next));
      } catch {
        // Storage being unavailable costs the convenience, not the feature.
      }
      return next;
    });
  }, [scope]);

  const href = useCallback(() => window.location.href, []);

  return { state, set, ready, href };
}

/** "1"/"0" in a URL is shorter and clearer than "true"/"false". */
export const flag = (on: boolean): string => (on ? "1" : "0");
export const isOn = (value: string): boolean => value === "1";

/**
 * "What is left for me to do", which is a different question from "what is
 * approved". Per-viewer by design: two people working the same queue should
 * each see their own remainder.
 */
export type MineFilter = "" | "todo" | "done";

/**
 * The one filter that does not travel in a link.
 *
 * Every other setting here is shareable because it means the same thing to
 * whoever opens it. This one does not: pasted to a colleague, "not approved by
 * me" would quietly re-point at them and show a different list than the sender
 * saw. So it lives in localStorage only -- it survives a reload and a break
 * mid-queue, which is what it is for, and a shared link carries the view
 * without it.
 *
 * Keyed by person as well as company, and shared between the overview and the
 * preview: someone working a queue sets it once and it follows them between
 * the two views rather than being two settings that can disagree.
 */
export function useMineFilter(
  companyId: string,
  userId: string,
): [MineFilter, (next: MineFilter) => void] {
  const [mine, setMine] = useState<MineFilter>("");
  const key = `emailpreviews:mine:${companyId}:${userId}`;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "todo" || stored === "done") setMine(stored);
    } catch {
      // Storage unavailable costs the convenience, not the page.
    }
  }, [key]);

  const set = useCallback(
    (next: MineFilter) => {
      setMine(next);
      try {
        if (next) window.localStorage.setItem(key, next);
        else window.localStorage.removeItem(key);
      } catch {
        /* as above */
      }
    },
    [key],
  );

  return [mine, set];
}

/**
 * A remembered id that no longer names anything, treated as no choice.
 *
 * View state outlives the things it points at. A sheet filter is stored in
 * localStorage and republished into the URL on every visit, so it survives the
 * sheet being deleted or replaced by a re-upload -- and then quietly matches
 * nothing. The page is not broken and does not say it is: it filters everything
 * out and the control beside it reads "All sheets", because a `select` cannot
 * show an option that is not there.
 *
 * Falling back is right rather than clever here. The thing the filter named is
 * gone, so the honest reading of "show me that sheet" is "show me everything".
 */
export function validId(stored: string, known: string[], fallback = ""): string {
  return known.includes(stored) ? stored : fallback;
}

/**
 * Whether a collapsible rail is open.
 *
 * Kept out of the URL on purpose, unlike the filters beside it. How wide
 * somebody wants their own sidebar is not part of what a shared link is saying,
 * and a colleague opening a pasted view should get their own layout back rather
 * than inheriting the sender's.
 */
export function useRail(key: string, initial = true): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(initial);
  const storageKey = `emailpreviews:rail:${key}`;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "open" || stored === "shut") setOpen(stored === "open");
    } catch {
      // Storage unavailable costs the preference, not the page.
    }
  }, [storageKey]);

  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        window.localStorage.setItem(storageKey, next ? "open" : "shut");
      } catch {
        /* as above */
      }
    },
    [storageKey],
  );

  return [open, set];
}
