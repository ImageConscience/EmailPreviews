import { approvalFingerprint } from "@/lib/fingerprint";
import { findEnvelopeColumns } from "@/lib/template";
import { DEFAULT_TIMEZONE, describe, zonedToUtc } from "@/lib/zone";

/**
 * Whether a row could be pushed, and if not, what is missing.
 *
 * One place, read by two: the list that decides what to show, and the push
 * that decides what to allow. Two copies of these rules would drift, and the
 * way they would drift is a row the list offers and the push then refuses --
 * which reads as the tool being broken rather than the row being incomplete.
 *
 * Nothing here talks to Klaviyo. It answers what can be known from the row, the
 * template and the company's settings, so a list of two hundred rows costs no
 * API calls; the checks that need the live account (does this audience exist)
 * happen once, at the push.
 */

/** Sheet columns naming who a send goes to. */
export const AUDIENCE_COLUMN = "audience";
export const EXCLUDE_COLUMN = "audience_exclude";

export interface CompanyPushSettings {
  fromEmail: string | null;
  baseTemplateId: string | null;
  timezone: string | null;
  connected: boolean;
}

export interface RowForPush {
  /** The row's stored JSON, as written, for fingerprinting. */
  data: string;
  values: Record<string, string>;
  columns: string[];
  hiddenAt: Date | null;
  approvals: { templateId: string; contentHash: string; user: { name: string | null; email: string } }[];
}

export interface TemplateForPush {
  id: string;
  name: string;
  updatedAt: Date;
}

export interface Eligibility {
  /** Ready to push as a draft. */
  ok: boolean;
  /** Ready to push and schedule -- which additionally needs a send time. */
  canSchedule: boolean;
  /** Why not, in the order worth fixing them. Empty when `ok`. */
  blockers: string[];
  campaignName: string;
  subject: string;
  audience: string;
  /** The instant the row asks for, if it names one. */
  sendAt: Date | null;
  /** That instant as a person in the company's zone reads it. */
  sendAtLabel: string | null;
  /** Set when the wall-clock time needs a second look. */
  warning?: string;
  /** The fingerprint of what would be pushed. */
  contentHash: string;
}

export function checkEligibility(
  row: RowForPush,
  template: TemplateForPush,
  company: CompanyPushSettings,
): Eligibility {
  const blockers: string[] = [];
  const envelope = findEnvelopeColumns(row.columns);
  const get = (column: string | null | undefined) => (column ? (row.values[column] ?? "").trim() : "");

  const subject = get(envelope.subject);
  const audience = (row.values[AUDIENCE_COLUMN] ?? "").trim();
  const campaignName = (row.values.campaign ?? row.values.campaign_name ?? "").trim() || subject;
  const contentHash = approvalFingerprint(row.data, template.id, template.updatedAt);

  // Company-level first: these stop every row, and saying so once per row would
  // be a wall of the same sentence.
  if (!company.connected) blockers.push("This company is not connected to Klaviyo.");
  if (!company.baseTemplateId) blockers.push("No Klaviyo base template is set.");
  if (!company.fromEmail) blockers.push("No from-address is set.");

  if (row.hiddenAt) blockers.push("The row is hidden.");

  const mine = row.approvals.filter((a) => a.templateId === template.id);
  if (mine.length === 0) {
    blockers.push("Nobody has approved it in this template.");
  } else {
    const stale = mine.filter((a) => a.contentHash !== contentHash);
    if (stale.length > 0) {
      const who = stale.map((a) => a.user.name ?? a.user.email).join(", ");
      blockers.push(`${who} approved an earlier version.`);
    }
  }

  if (!subject) blockers.push("It has no subject line.");
  if (!audience) blockers.push(`It has no “${AUDIENCE_COLUMN}” value.`);

  // The send time is not required for a draft, so a missing one is not a
  // blocker -- it only decides whether scheduling is on the table.
  const zone = company.timezone ?? DEFAULT_TIMEZONE;
  const date = get(envelope.sendDate);
  const time = get(envelope.sendTime);
  let sendAt: Date | null = null;
  let warning: string | undefined;

  if (date) {
    const when = zonedToUtc(date, time, zone);
    if (!when.utc) blockers.push(`“${date} ${time}”.trim() is not a date and time this can read.`);
    else {
      sendAt = when.utc;
      warning = when.warning;
    }
  }

  const ok = blockers.length === 0;
  return {
    ok,
    canSchedule: ok && sendAt !== null && sendAt.getTime() > Date.now(),
    blockers,
    campaignName,
    subject,
    audience,
    sendAt,
    sendAtLabel: sendAt ? describe(sendAt, zone) : null,
    warning,
    contentHash,
  };
}

/** Why scheduling in particular is unavailable, for a row that can be drafted. */
export function scheduleBlocker(check: Eligibility): string | null {
  if (!check.ok) return "It cannot be pushed at all yet.";
  if (!check.sendAt) return "Scheduling needs a send date and time; this row has none.";
  if (check.sendAt.getTime() <= Date.now()) return "That send time has already passed.";
  return null;
}
