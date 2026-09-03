/**
 * Turning "3 November, 10:00" into an instant.
 *
 * The sheet carries a wall-clock date and time, because that is how a send is
 * decided: "the ninth, ten in the morning". Klaviyo wants an instant. Between
 * the two sits the company's timezone and, twice a year, an hour that does not
 * exist and an hour that happens twice.
 *
 * Getting this wrong is not a rendering bug. A campaign an hour early on the
 * Monday after the clocks change is a real email to real customers at the wrong
 * time, and nothing in the app would look broken afterwards. So the conversion
 * is done by asking the platform what the offset actually was at that instant,
 * rather than by assuming one.
 */

/** New York, because that is where the sends are decided. */
export const DEFAULT_TIMEZONE = "America/New_York";

/** What a given instant reads as on a clock in `timeZone`, as UTC-shaped parts. */
function wallClockAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` yields 24 for midnight in some ICU versions; 24:00 today is
  // 00:00 today for our purposes, since only the difference is used.
  const hour = get("hour") % 24;
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

export interface ZoneResult {
  /** The instant, or null when the input was not a usable date and time. */
  utc: Date | null;
  /** Set when the wall-clock time is worth a second look before it is used. */
  warning?: string;
}

/**
 * `2026-11-01` + `10:00` in New York -> the instant that is.
 *
 * Works by guessing, measuring the error, and correcting: treat the wall clock
 * as if it were UTC, ask what that instant reads as in the zone, and shift by
 * the difference. Twice, because near a transition the first correction can
 * land on the other side of it and change the offset again.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): ZoneResult {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date ?? "").trim());
  if (!day) return { utc: null };

  const clock = /^(\d{1,2}):(\d{2})/.exec((time ?? "").trim() || "00:00");
  if (!clock) return { utc: null };

  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return { utc: null };

  const year = Number(day[1]);
  const month = Number(day[2]);
  const dayOfMonth = Number(day[3]);
  const wanted = Date.UTC(year, month - 1, dayOfMonth, hours, minutes);

  // `Date.UTC` rolls out-of-range parts over rather than refusing them, so a
  // typo of month 13 becomes January of the following year and a send would be
  // scheduled a year late without anything looking wrong. Read the parts back
  // and insist they are the ones that went in.
  const check = new Date(wanted);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== dayOfMonth
  ) {
    return { utc: null };
  }

  let guess = wanted;
  for (let i = 0; i < 2; i += 1) {
    guess = wanted + (guess - wallClockAt(new Date(guess), timeZone));
  }
  const utc = new Date(guess);

  // Having converted, check the answer reads back as the time that was asked
  // for. On the spring-forward morning it will not, because the hour asked for
  // never happens; the platform lands on a real instant either side of the gap,
  // and the send would go out at a time nobody chose.
  if (wallClockAt(utc, timeZone) !== wanted) {
    return {
      utc,
      warning:
        `${date} ${time} does not exist in ${timeZone} — the clocks change that morning. ` +
        `It would send at ${describe(utc, timeZone)} instead.`,
    };
  }

  return { utc };
}

/** The instant as a person in that zone would read it, for confirming a send. */
export function describe(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

/** Zones offered in the settings. Short, and covers where the clients are. */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
  "UTC",
];
