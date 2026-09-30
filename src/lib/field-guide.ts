import {
  DERIVED_FIELDS,
  derivedSlotField,
  packedExpansions,
} from "@/lib/derived";
import {
  audienceColumnNames,
  envelopeColumnNames,
  findAudienceColumns,
  findEnvelopeColumns,
  normalizeKey,
} from "@/lib/template";

/**
 * What a caller outside the browser needs to know to fill a template in.
 *
 * Every mechanical fact here is *computed* from the template's own HTML and
 * from the modules that implement the behaviour -- never written down. A list
 * of rules kept by hand is a list that goes stale the first time somebody adds
 * a template, and a stale rule is worse than no rule: it is believed. The prose
 * in `guidance` is the exception, because judgement cannot be derived.
 */

/** Same shape as `extractPlaceholders`, but keeping the brace count. */
const TOKEN =
  /\{\{\{\s*([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\}\}\}|\{\{\s*([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\}\}/g;

export type FieldKind =
  /** Ordinary copy. Fill it in. */
  | "content"
  /** Rendered as raw HTML rather than escaped. */
  | "raw_html"
  /** The app works this out. Leave it blank unless overriding deliberately. */
  | "derived"
  /** Not a value at all -- a switch the template reads. Never write to it. */
  | "switch";

export interface FieldNote {
  name: string;
  kind: FieldKind;
  note?: string;
}

export interface PackedShortcut {
  cell: string;
  fills: string[];
  note: string;
}

export interface TemplateGuide {
  templateId: string;
  templateName: string;
  /** Every placeholder the template prints, annotated. */
  fields: FieldNote[];
  /** One cell that fills several fields, where this template uses them. */
  shortcuts: PackedShortcut[];
  /** Row-level fields that are not in any template. */
  envelope: string[];
  audience: string[];
  /** What a row needs before it can go to Klaviyo. */
  requiredToPush: string[];
  /** Hand-written, per template. Judgement, not mechanics. */
  guidance: string | null;
}

/**
 * Split a template's placeholders into what a writer should fill, what the app
 * fills for them, and what they must not touch.
 */
export function describeFields(html: string): FieldNote[] {
  const raw = new Set<string>();
  const order: string[] = [];
  const seen = new Set<string>();

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(html)) !== null) {
    const name = (match[1] ?? match[2] ?? "").trim();
    if (!name) continue;
    const key = normalizeKey(name);
    // A field printed raw anywhere is a field that takes HTML, even if it is
    // also printed escaped somewhere else: the looser of the two is what a
    // caller has to satisfy.
    if (match[1] != null) raw.add(key);
    if (seen.has(key)) continue;
    seen.add(key);
    order.push(name);
  }

  return order.map((name) => {
    const key = normalizeKey(name);

    const slot = derivedSlotField(name);
    if (slot === "suppress") {
      return {
        name,
        kind: "switch" as const,
        note: "Set by the app from whether the slot has anything in it. Never write to it.",
      };
    }
    if (slot === "show") {
      return {
        name,
        kind: "derived" as const,
        note: "Worked out from the slot's own price and the membership discount. Leave blank.",
      };
    }
    if (DERIVED_FIELDS.includes(key)) {
      return {
        name,
        kind: "derived" as const,
        note:
          key === "retail_price"
            ? "Taken from product_1_price when blank. Leave blank unless the shop price is wrong."
            : "Retail less the membership discount (20% by default), rounded to whole dollars. Leave blank.",
      };
    }
    if (raw.has(key)) {
      return {
        name,
        kind: "raw_html" as const,
        note: "Rendered as raw HTML -- a <br> works here. Every other field is escaped and would print the tag.",
      };
    }
    return { name, kind: "content" as const };
  });
}

/** Packed cells worth mentioning: the ones that fill fields this template prints. */
export function describeShortcuts(fields: FieldNote[]): PackedShortcut[] {
  const present = new Set(fields.map((f) => normalizeKey(f.name)));
  const out: PackedShortcut[] = [];
  for (const [cell, fills] of Object.entries(packedExpansions())) {
    const used = fills.filter((f) => present.has(normalizeKey(f)));
    if (used.length === 0) continue;
    out.push({
      cell,
      fills: used,
      note:
        cell === "swatches"
          ? "One comma-separated cell instead of filling each swatch. A field written out in full wins."
          : "One cell as `name | count | note | color | tint`. A field written out in full wins.",
    });
  }
  return out;
}

/**
 * The fields that surround an email without being inside any template, named
 * as this sheet actually spells them.
 */
export function describeRowFields(columns: string[]) {
  return {
    envelope: envelopeColumnNames(findEnvelopeColumns(columns)),
    audience: audienceColumnNames(findAudienceColumns(columns)),
  };
}

/**
 * What the push gate actually insists on, phrased for somebody filling a row.
 *
 * Kept short and true rather than complete: the approval rule is a person's job,
 * not a writer's, so it is stated but not elaborated.
 */
export function requiredToPush(envelope: { subject: string; sendDate: string }): string[] {
  return [
    `${envelope.subject} -- a campaign with no subject line cannot be pushed.`,
    "An audience -- either on the row, or the company default set under Integrations.",
    `${envelope.sendDate} -- only needed to schedule. A draft can go without one.`,
    "One current admin approval, given in the app after the content is written.",
  ];
}
