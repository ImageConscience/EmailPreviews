import { normalizeKey } from "./template";

/**
 * How a row describes itself outside the render.
 *
 * The preview rail, the overview list and the calendar all have to name the
 * same row the same way, or moving between them feels like moving between
 * three different tools. This is that one description.
 */

const LABEL_HINTS = ["subject", "headline", "title", "name", "campaign", "product"];

/** The one line that identifies a row: its subject, or the best thing it has. */
export function rowLabel(data: Record<string, string>, columns: string[]): string {
  for (const hint of LABEL_HINTS) {
    const column = columns.find((c) => normalizeKey(c).includes(hint));
    const value = column ? data[column]?.trim() : "";
    if (value) return value;
  }
  const first = columns.find((c) => data[c]?.trim());
  return first ? data[first].trim() : "(empty row)";
}

/**
 * The second line under a row. With one sheet holding every month and three
 * options each, "Row 27" identifies nothing -- the send month and which option
 * it is are what you actually navigate by.
 */
export function rowSubLabel(
  data: Record<string, string>,
  position: number,
  templateColumn: string | null,
): string {
  const find = (names: string[]) => {
    const key = Object.keys(data).find((c) => names.includes(normalizeKey(c)));
    return key ? data[key]?.trim() : "";
  };
  const month = find(["send_month", "month", "send_date"]);
  const option = find(["option", "variant"]);
  const template = templateColumn ? data[templateColumn]?.trim() : "";

  const parts = [
    month || `Row ${position + 1}`,
    option ? (option.length <= 2 ? `Option ${option}` : option) : "",
    template,
  ].filter(Boolean);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Send dates                                                          */
/* ------------------------------------------------------------------ */

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Read a send date out of a cell as `yyyy-mm-dd`, or null when there is none.
 *
 * Sheets are typed by people, so `2026-08-27` and `8/27/2026` both turn up.
 * Anything else is left as no date rather than guessed at: a filter that
 * quietly drops rows it misread is worse than one that admits it cannot tell.
 * Parsing is textual on purpose -- `new Date("2026-08-27")` is UTC midnight,
 * which is the day before in every American timezone.
 */
export function parseSendDate(value: string | undefined | null): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  const iso = ISO.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31
      ? `${y}-${m}-${d}`
      : null;
  }

  const us = US.exec(text);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  return null;
}

/** Today as `yyyy-mm-dd` in the viewer's own timezone, not UTC. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `yyyy-mm-dd` a number of days from the given day, calendar-correct. */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(y, m - 1, d + days);
  return todayIso(at);
}

/** A date as people write it in a list: "Thu 27 Aug 2026". */
export function formatIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface DateRange {
  /** Inclusive `yyyy-mm-dd`, or "" for open-ended. */
  from: string;
  /** Inclusive `yyyy-mm-dd`, or "" for open-ended. */
  to: string;
  /** Rows whose send date is empty or unreadable. */
  includeUndated: boolean;
}

/** The range the app opens with: the next month of sends, undated included. */
export function defaultRange(now: Date = new Date()): DateRange {
  const from = todayIso(now);
  return { from, to: shiftIso(from, 30), includeUndated: true };
}

export function inRange(sendDate: string | null, range: DateRange): boolean {
  if (!sendDate) return range.includeUndated;
  if (range.from && sendDate < range.from) return false;
  if (range.to && sendDate > range.to) return false;
  return true;
}

/** True when the range is not filtering anything out. */
export function rangeIsOpen(range: DateRange): boolean {
  return !range.from && !range.to && range.includeUndated;
}
