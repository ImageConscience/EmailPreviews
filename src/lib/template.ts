/**
 * Placeholder parsing and merging.
 *
 * Syntax:
 *   {{ placeholder_name }}   -> value is HTML-escaped (the default, and what
 *                               you want for subject lines, names, URLs)
 *   {{{ placeholder_name }}} -> value is injected raw, for cells that legitimately
 *                               contain markup (e.g. a <br>-separated address)
 *
 * This module is dependency-free and runs unchanged on the server and in the
 * browser, so the live preview can re-merge on every keystroke without a
 * round trip while the server renders the identical HTML for exports.
 */

const TOKEN =
  /\{\{\{\s*([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\}\}\}|\{\{\s*([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\}\}/g;

/**
 * Sheet headers in the wild are "Hero Image URL", not "hero_image_url".
 * Normalising both sides means a template written against `{{ hero_image_url }}`
 * still finds its column without anyone having to rename anything.
 */
export function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Placeholder names in order of first appearance, de-duplicated. */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(html)) !== null) {
    const name = (match[1] ?? match[2] ?? "").trim();
    if (!name) continue;
    const key = normalizeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Build normalized-key -> value lookup, keeping the first non-empty winner. */
function buildLookup(values: Record<string, string>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(values)) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    const value = rawValue == null ? "" : String(rawValue);
    const existing = lookup.get(key);
    if (existing == null || (existing === "" && value !== "")) lookup.set(key, value);
  }
  return lookup;
}

/**
 * True when `index` falls inside a tag (i.e. between `<` and its `>`), where
 * wrapping a missing placeholder in a <span> would corrupt the markup instead
 * of highlighting it.
 */
function isInsideTag(html: string, index: number): boolean {
  const lastOpen = html.lastIndexOf("<", index);
  if (lastOpen === -1) return false;
  const lastClose = html.lastIndexOf(">", index);
  return lastOpen > lastClose;
}

/** Attributes whose value the browser fetches as an image. */
const IMAGE_ATTRS = new Set(["src", "srcset", "background", "poster", "data-src"]);

/**
 * Name of the attribute a placeholder is the value of, or null when it is not
 * a straightforward `attr="{{ token }}"`. Used to avoid leaving a raw token in
 * an image source, which the browser would otherwise try to fetch as a URL.
 */
function attributeAt(html: string, index: number): string | null {
  if (!isInsideTag(html, index)) return null;
  let i = index - 1;
  while (i >= 0 && /[\s"']/.test(html[i])) i -= 1;
  if (i < 0 || html[i] !== "=") return null;
  i -= 1;
  while (i >= 0 && /\s/.test(html[i])) i -= 1;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9:_.-]/.test(html[i])) i -= 1;
  const name = html.slice(i + 1, end).toLowerCase();
  return name || null;
}

/** A visible "nothing here yet" image, so the layout still shows the gap. */
function missingImageDataUri(name: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240">' +
    '<rect width="600" height="240" fill="#f3f4f6" stroke="#cbd2da" stroke-width="2" stroke-dasharray="8 6"/>' +
    `<text x="300" y="115" text-anchor="middle" font-family="monospace" font-size="19" fill="#8b95a1">${escapeHtml(name)}</text>` +
    '<text x="300" y="143" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#a8b0ba">no image URL for this row</text>' +
    "</svg>";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 1x1 transparent GIF -- used when gap highlighting is switched off. */
const BLANK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const MISSING_STYLE =
  "background:#fde68a;color:#78350f;border-bottom:1px dashed #b45309;padding:0 2px;border-radius:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em;";

export interface RenderOptions {
  /** Visibly mark placeholders with no value instead of leaving the raw token. */
  highlightMissing?: boolean;
}

export interface RenderResult {
  html: string;
  /** Every placeholder in the template, first-appearance order. */
  placeholders: string[];
  /** Placeholders that received a non-empty value. */
  filled: string[];
  /** Placeholders whose matching column exists but is blank. */
  blank: string[];
  /** Placeholders with no matching column at all. */
  missing: string[];
}

export function renderTemplate(
  html: string,
  values: Record<string, string>,
  options: RenderOptions = {},
): RenderResult {
  const lookup = buildLookup(values);
  const filled = new Set<string>();
  const blank = new Set<string>();
  const missing = new Set<string>();

  TOKEN.lastIndex = 0;
  const merged = html.replace(TOKEN, (match, rawName: string, escName: string, offset: number) => {
    const name = (rawName ?? escName ?? "").trim();
    if (!name) return match;
    const key = normalizeKey(name);
    const value = lookup.get(key);

    if (value == null) {
      missing.add(name);
    } else if (value === "") {
      blank.add(name);
    } else {
      filled.add(name);
      return rawName != null ? value : escapeHtml(value);
    }

    // No usable value. What to leave behind depends on where the token sits:
    // inside an image source a raw token would be fetched as a relative URL
    // (a bogus request, and it reads as a broken image rather than a gap).
    const attribute = attributeAt(html, offset);
    if (attribute && IMAGE_ATTRS.has(attribute)) {
      return options.highlightMissing ? missingImageDataUri(name) : BLANK_IMAGE;
    }
    // With gaps highlighted, show the token so the hole is obvious. With
    // highlighting off the question is "what does this actually look like",
    // and the answer is never a stray {{ token }} mid-paragraph -- an optional
    // slot left empty should simply not be there. The coverage panel still
    // names every blank and unmatched placeholder either way.
    if (!options.highlightMissing) return "";
    if (!isInsideTag(html, offset)) {
      return `<span style="${MISSING_STYLE}" title="No value for &quot;${escapeHtml(name)}&quot;">${escapeHtml(match)}</span>`;
    }
    return match;
  });

  const placeholders = extractPlaceholders(html);
  const order = (set: Set<string>) => placeholders.filter((p) => set.has(p));

  return {
    html: merged,
    placeholders,
    filled: order(filled),
    blank: order(blank),
    missing: order(missing),
  };
}

/**
 * Columns present in the sheet that this template never references.
 * `ignore` drops columns that are deliberately metadata rather than content,
 * so they are not reported as an oversight on every single template.
 */
export function unusedColumns(
  columns: string[],
  placeholders: string[],
  ignore: string[] = [],
): string[] {
  const used = new Set(placeholders.map(normalizeKey));
  const skipped = new Set(ignore.map(normalizeKey));
  return columns.filter((c) => !used.has(normalizeKey(c)) && !skipped.has(normalizeKey(c)));
}

/* ------------------------------------------------------------------ */
/* Per-row template selection                                          */
/* ------------------------------------------------------------------ */

/**
 * Header names understood as "which template does this row belong to".
 *
 * One sheet holding every campaign is easier to maintain than one sheet per
 * template, but only if each row can say how it is meant to be rendered.
 */
const TEMPLATE_COLUMNS = [
  "template",
  "template_name",
  "email_template",
  "default_template",
  "layout",
];

/**
 * Columns that plan or label a campaign rather than fill a template: the
 * subject line, the send month, which option a row is. They are legitimately
 * absent from every template, so reporting them as ignored on each one trains
 * people to stop reading the panel that also flags real mistakes.
 */
const METADATA_COLUMNS = [
  "send_month",
  "month",
  "send_date",
  "option",
  "variant",
  "theme",
  "status",
  "owner",
  "notes",
  "campaign",
  "campaign_name",
];

/**
 * The four things that surround an email without being inside it: the subject
 * line, the preview text beside it in the inbox, and the date and time it goes
 * out.
 *
 * None of them belongs in the email body -- the sending platform sets them all
 * -- but each is part of the campaign that gets written, reviewed and approved
 * along with the copy, so the preview shows them above the render rather than
 * discarding them as columns no template uses.
 */
const ENVELOPE_ALIASES = {
  subject: ["subject", "subject_line"],
  preheader: ["preheader", "pre_header", "preview_text", "preview", "preheader_text"],
  sendDate: ["send_date", "date", "send_day", "scheduled_date", "schedule_date"],
  sendTime: ["send_time", "time", "scheduled_time", "schedule_time"],
};

export interface EnvelopeColumns {
  subject: string | null;
  preheader: string | null;
  sendDate: string | null;
  sendTime: string | null;
}

export function findEnvelopeColumns(columns: string[]): EnvelopeColumns {
  const pick = (names: string[]) =>
    columns.find((column) => names.includes(normalizeKey(column))) ?? null;
  return {
    subject: pick(ENVELOPE_ALIASES.subject),
    preheader: pick(ENVELOPE_ALIASES.preheader),
    sendDate: pick(ENVELOPE_ALIASES.sendDate),
    sendTime: pick(ENVELOPE_ALIASES.sendTime),
  };
}

/** Every column the bar above the render owns, in the order it shows them. */
export function envelopeColumnNames(columns: EnvelopeColumns): string[] {
  return [columns.subject, columns.preheader, columns.sendDate, columns.sendTime].filter(
    (column): column is string => Boolean(column),
  );
}

/** Planning and labelling columns present in this sheet. */
export function metadataColumns(columns: string[]): string[] {
  const wanted = new Set(METADATA_COLUMNS);
  return columns.filter((column) => wanted.has(normalizeKey(column)));
}

/** The column in this sheet that names each row's template, if there is one. */
export function findTemplateColumn(columns: string[]): string | null {
  const wanted = new Set(TEMPLATE_COLUMNS);
  return columns.find((column) => wanted.has(normalizeKey(column))) ?? null;
}

export interface NamedTemplate {
  id: string;
  name: string;
}

/**
 * Resolve a cell value to one of the company's templates. Matching is
 * punctuation- and case-insensitive, and falls back to a containment match so
 * that a sheet saying "Seasonal" still finds a template named "01 Seasonal".
 */
export function matchTemplateName<T extends NamedTemplate>(
  value: string,
  templates: T[],
): T | null {
  const wanted = normalizeKey(value ?? "");
  if (!wanted) return null;

  const exact = templates.find((t) => normalizeKey(t.name) === wanted);
  if (exact) return exact;

  const partial = templates.filter((t) => {
    const name = normalizeKey(t.name);
    return name.includes(wanted) || wanted.includes(name);
  });
  // Only accept a loose match when it is unambiguous.
  return partial.length === 1 ? partial[0] : null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

/** Heuristic: does this value look like an image the preview should thumbnail? */
export function looksLikeImageUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v) && !v.startsWith("//") && !v.startsWith("data:image/")) return false;
  if (v.startsWith("data:image/")) return true;
  return IMAGE_EXT.test(v) || /\/(image|img|photo|cdn|media|assets)\//i.test(v);
}

export function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|\/\/|data:)/i.test(value.trim());
}
