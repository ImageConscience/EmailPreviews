import { approvalFingerprint } from "@/lib/fingerprint";
import { audienceSlots, findAudienceColumns, findEnvelopeColumns } from "@/lib/template";
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

/** The default sheet columns naming who a send goes to; aliases are accepted. */
export const AUDIENCE_COLUMN = "audience";
export const EXCLUDE_COLUMN = "audience_exclude";

export interface CompanyPushSettings {
  fromEmail: string | null;
  baseTemplateId: string | null;
  timezone: string | null;
  connected: boolean;
  /** Where sends go when a row does not say otherwise. */
  audience?: string | null;
  audienceExclude?: string | null;
}

export interface RowForPush {
  /** The row's stored JSON, as written, for fingerprinting. */
  data: string;
  values: Record<string, string>;
  columns: string[];
  hiddenAt: Date | null;
  approvals: ApprovalForPush[];
}

export interface ApprovalForPush {
  templateId: string;
  contentHash: string;
  userId: string;
  /** Admin or owner on this company: the sign-off the gate actually turns on. */
  admin: boolean;
  user: { name: string | null; email: string };
}

/** One approver, for showing who has signed off beside the push button. */
export interface Approver {
  userId: string;
  name: string;
  admin: boolean;
  /** Given against an earlier version of the row or template. */
  stale: boolean;
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
  /** Everyone who has signed off in this template, current or not. */
  approvers: Approver[];
  audience: string;
  /** True when the audience came from the company default, not the row. */
  audienceInherited: boolean;
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
  // Resolved the same way the preview resolves it, so a sheet whose column is
  // called "list" gets one answer from both.
  const audienceKeys = audienceSlots(findAudienceColumns(row.columns));
  // The row wins; the company default fills in. Most campaigns for a client go
  // to the same place, and writing that into every row would be both busywork
  // and a way to make every sign-off stale the moment it was done.
  const ownAudience = (row.values[audienceKeys.audience] ?? "").trim();
  const audience = ownAudience || (company.audience ?? "").trim();
  const audienceInherited = !ownAudience && audience !== "";
  const campaignName = (row.values.campaign ?? row.values.campaign_name ?? "").trim() || subject;
  const contentHash = approvalFingerprint(row.data, template.id, template.updatedAt);

  // Company-level first: these stop every row, and saying so once per row would
  // be a wall of the same sentence.
  if (!company.connected) blockers.push("This company is not connected to Klaviyo.");
  if (!company.baseTemplateId) blockers.push("No Klaviyo base template is set.");
  if (!company.fromEmail) blockers.push("No from-address is set.");

  if (row.hiddenAt) blockers.push("The row is hidden.");

  /**
   * One current admin sign-off opens the gate.
   *
   * It used to take every approval on the row being current, which read as
   * strict and behaved as brittle: preparing a row for a push edits it, and
   * that edit staled the very approvals the push then demanded. The person
   * doing the preparing is the person trusted to send, so their sign-off on
   * what is now on screen is the thing worth requiring. A colleague's older
   * approval is still shown -- it just no longer stops the send.
   */
  const mine = row.approvals.filter((a) => a.templateId === template.id);
  const approvers: Approver[] = mine.map((a) => ({
    userId: a.userId,
    name: a.user.name ?? a.user.email,
    admin: a.admin,
    stale: a.contentHash !== contentHash,
  }));
  const currentAdmins = approvers.filter((a) => a.admin && !a.stale);

  if (currentAdmins.length === 0) {
    if (mine.length === 0) {
      blockers.push("Nobody has approved it in this template.");
    } else if (!approvers.some((a) => a.admin)) {
      blockers.push("No admin has approved it in this template.");
    } else {
      const who = approvers.filter((a) => a.admin).map((a) => a.name).join(", ");
      blockers.push(`${who} approved an earlier version; an admin has to sign off on this one.`);
    }
  }

  if (!subject) blockers.push("It has no subject line.");
  if (!audience) {
    blockers.push(
      `It has no “${audienceKeys.audience}”, and no default audience is set for this company.`,
    );
  }

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
    approvers,
    audience,
    audienceInherited,
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
