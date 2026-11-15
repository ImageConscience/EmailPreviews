import { normalizeKey } from "@/lib/template";

/**
 * Which column of a text sheet means what.
 *
 * A text sheet is small on purpose: a name for the campaign, the message, an
 * optional image (which makes it an MMS), when it goes, and who it goes to.
 * Headers are matched the way email sheets match theirs -- lower-cased, with
 * anything that is not a letter or digit turned into an underscore -- so
 * "Send Date", "send-date" and "send_date" are all the same column.
 *
 * Browser-safe: the Texts page reads rows with this as well as the push.
 */

const ALIASES = {
  name: ["campaign", "campaign_name", "name", "title", "sms_name"],
  body: ["body", "message", "text", "sms", "copy", "sms_body", "message_body", "sms_text"],
  image: ["image", "image_url", "media", "media_url", "mms", "mms_image", "picture", "photo"],
  sendDate: ["send_date", "date", "send_day", "scheduled_date", "schedule_date"],
  sendTime: ["send_time", "time", "scheduled_time", "schedule_time"],
  audience: ["audience", "list", "segment", "audiences", "send_to", "to"],
  exclude: ["audience_exclude", "exclude", "excluded", "suppress", "exclude_audience"],
} as const;

export type SmsField = keyof typeof ALIASES;

/** The header each field writes to when the sheet has none. */
const DEFAULTS: Record<SmsField, string> = {
  name: "campaign",
  body: "body",
  image: "image",
  sendDate: "send_date",
  sendTime: "send_time",
  audience: "audience",
  exclude: "audience_exclude",
};

/** The columns a new text sheet starts with, in the order a person fills them. */
export const SMS_SHEET_COLUMNS = [
  DEFAULTS.name,
  DEFAULTS.sendDate,
  DEFAULTS.sendTime,
  DEFAULTS.body,
  DEFAULTS.image,
  DEFAULTS.audience,
  DEFAULTS.exclude,
];

export const SMS_FIELD_LABELS: Record<SmsField, string> = {
  name: "Campaign name",
  body: "Message",
  image: "Image (makes it an MMS)",
  sendDate: "Send date",
  sendTime: "Send time",
  audience: "Audience",
  exclude: "Exclude",
};

export type SmsSlots = Record<SmsField, string>;

/** For each field, the sheet's own header for it, or the default. */
export function smsSlots(columns: string[]): SmsSlots {
  const out = {} as SmsSlots;
  for (const field of Object.keys(ALIASES) as SmsField[]) {
    const names = ALIASES[field] as readonly string[];
    out[field] = columns.find((c) => names.includes(normalizeKey(c))) ?? DEFAULTS[field];
  }
  return out;
}

export interface SmsRow {
  name: string;
  body: string;
  imageUrl: string;
  sendDate: string;
  sendTime: string;
  audience: string;
  exclude: string;
}

/** A row's values, read through its sheet's headers. */
export function readSmsRow(values: Record<string, string>, slots: SmsSlots): SmsRow {
  const get = (field: SmsField) => (values[slots[field]] ?? "").trim();
  return {
    name: get("name"),
    // Not trimmed inside: line breaks are part of a text.
    body: (values[slots.body] ?? "").replace(/^\s+|\s+$/g, ""),
    imageUrl: get("image"),
    sendDate: get("sendDate"),
    sendTime: get("sendTime"),
    audience: get("audience"),
    exclude: get("exclude"),
  };
}

/** What a row is called wherever a list of texts is shown. */
export function smsLabel(row: SmsRow): string {
  if (row.name) return row.name;
  const first = row.body.split(/\s+/).slice(0, 8).join(" ");
  return first ? (row.body.length > first.length ? `${first}…` : first) : "Untitled text";
}
