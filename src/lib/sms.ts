/**
 * What a text message costs and what it is missing, before anyone sends it.
 *
 * An email that runs long is a longer email. A text that runs long is several
 * texts, each billed, and the moment one character outside the GSM alphabet
 * appears -- a curly quote pasted from a document, an emoji -- the whole message
 * changes encoding and the allowance per segment falls from 160 characters to
 * 70. Nothing on screen looks different. So the count shown beside the preview
 * is worked out here, the way the carriers do it, rather than as `body.length`.
 *
 * Pure: no database, no platform. The preview, the push and the checks all ask
 * the same function, so they cannot disagree about whether a message fits.
 */

/** The GSM 03.38 basic character set: one septet each. */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** The extension table: still GSM, but each costs two septets (an escape and itself). */
const GSM_EXTENDED = "^{}\\[~]|€\f";

const basic = new Set(Array.from(GSM_BASIC));
const extended = new Set(Array.from(GSM_EXTENDED));

/**
 * Characters that are not GSM but look like it, mapped to what was meant.
 *
 * These are what a copy pasted from a word processor actually contains, and
 * each one silently drops the message to the 70-character encoding. Offered as
 * a suggestion, never applied: changing someone's approved copy behind their
 * back is worse than an expensive text.
 */
const LOOKALIKES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsAnalysis {
  encoding: SmsEncoding;
  /** Characters as a person counts them (code points, so an emoji is one). */
  characters: number;
  /** Septets for GSM-7, UTF-16 code units for UCS-2: what the carrier bills by. */
  units: number;
  /** How many texts this becomes when sent as SMS. */
  segments: number;
  /** The allowance per segment at this length and encoding. */
  perSegment: number;
  /** Units left before the next segment begins. */
  remaining: number;
  /** Each distinct character that forced UCS-2, in order of appearance. */
  nonGsm: string[];
  /** Of those, the ones with an obvious GSM stand-in, and what it is. */
  replacements: { from: string; to: string }[];
}

/**
 * Count a body the way it will be billed as SMS.
 *
 * GSM-7: 160 septets in one segment, 153 each once it splits (the rest is the
 * header that stitches them back together). UCS-2: 70, then 67. Extension
 * characters count twice in GSM-7. In UCS-2 a character outside the basic
 * plane -- most emoji -- is two code units, which is why `units` is not
 * `characters`.
 */
export function analyseSms(body: string): SmsAnalysis {
  const chars = Array.from(body ?? "");
  const nonGsm: string[] = [];
  let septets = 0;

  for (const ch of chars) {
    if (basic.has(ch)) septets += 1;
    else if (extended.has(ch)) septets += 2;
    else if (!nonGsm.includes(ch)) nonGsm.push(ch);
  }

  const encoding: SmsEncoding = nonGsm.length > 0 ? "UCS-2" : "GSM-7";
  const units = encoding === "GSM-7" ? septets : (body ?? "").length;
  const single = encoding === "GSM-7" ? 160 : 70;
  const multi = encoding === "GSM-7" ? 153 : 67;

  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const perSegment = segments <= 1 ? single : multi;
  const remaining = segments === 0 ? single : segments * perSegment - units;

  return {
    encoding,
    characters: chars.length,
    units,
    segments,
    perSegment,
    remaining,
    nonGsm,
    replacements: nonGsm
      .filter((ch) => ch in LOOKALIKES)
      .map((ch) => ({ from: ch, to: LOOKALIKES[ch] })),
  };
}

/**
 * MMS has no segments, only a ceiling.
 *
 * 1,600 characters is the common carrier limit. It is not from either
 * platform's API reference, which states none, so treat it as the industry
 * convention it is: a body past it is refused here rather than sent to find out.
 */
export const MMS_MAX_CHARACTERS = 1600;

/** Image types MMS gateways accept as a matter of course. Others may work; these do. */
const MMS_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif"];

/** Words that tell a subscriber how to stop, in the forms carriers look for. */
const OPT_OUT = /\b(stop|unsubscribe|opt[\s-]?out)\b/i;

export interface SmsCheck {
  /** Things that will make the send fail or break the law. The push refuses these. */
  problems: string[];
  /** Things worth a second look, which the push allows. */
  warnings: string[];
}

export interface SmsDraft {
  body: string;
  /** A public image URL, which makes it an MMS. Empty or absent makes it an SMS. */
  imageUrl?: string | null;
  /**
   * Whether the platform will append its own opt-out wording at send time.
   * When it will, the copy need not carry it; when it will not, it must.
   */
  platformAddsOptOut: boolean;
}

/**
 * What is wrong with this text, in words for the person who has to fix it.
 *
 * Kept to what can be known from the copy alone. Consent, quiet hours in each
 * recipient's zone and the account's sender registration are the platform's to
 * enforce; pretending to check them here would only be believed.
 */
export function checkSms(draft: SmsDraft): SmsCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const body = draft.body ?? "";
  const image = (draft.imageUrl ?? "").trim();

  if (!body.trim()) problems.push("The message has no text.");

  if (image) {
    if (!/^https:\/\//i.test(image)) {
      problems.push("The image has to be a public https:// link the platform can fetch.");
    } else {
      const ext = image.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
      if (!MMS_IMAGE_EXTENSIONS.includes(ext)) {
        warnings.push(
          `The image link does not end in ${MMS_IMAGE_EXTENSIONS.join(", ")}. ` +
            "Carriers accept only those reliably; check it before sending.",
        );
      }
    }
    if (Array.from(body).length > MMS_MAX_CHARACTERS) {
      problems.push(
        `An MMS can carry at most ${MMS_MAX_CHARACTERS.toLocaleString("en-US")} characters; ` +
          `this has ${Array.from(body).length.toLocaleString("en-US")}.`,
      );
    }
  } else {
    const a = analyseSms(body);
    if (a.encoding === "UCS-2") {
      const fixable = a.replacements.map((r) => `${r.from} → ${r.to}`).join(", ");
      warnings.push(
        `${a.nonGsm.map((c) => `“${c}”`).join(" ")} ${a.nonGsm.length === 1 ? "is" : "are"} ` +
          "outside the standard SMS alphabet, so each text holds 70 characters instead of 160." +
          (fixable ? ` Swapping ${fixable} would fix the ones that are just punctuation.` : ""),
      );
    }
    if (a.segments > 1) {
      warnings.push(`This will go out as ${a.segments} texts per subscriber, each billed.`);
    }
  }

  if (!draft.platformAddsOptOut && !OPT_OUT.test(body)) {
    problems.push(
      "Marketing texts must say how to stop them (for example “Reply STOP to opt out”), " +
        "and the platform is not set to add that wording itself.",
    );
  }

  return { problems, warnings };
}
