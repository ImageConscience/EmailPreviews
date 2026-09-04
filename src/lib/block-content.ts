/**
 * Turning a whole email document into something an HTML block can hold.
 *
 * The templates in this app are complete documents -- doctype, head, body --
 * because that is what a preview and a `.html` download need to be. A Klaviyo
 * HTML block sits inside a page Klaviyo has already built, so it wants the
 * middle of ours and none of the wrapper.
 *
 * Three things have to survive the trip, and each is a decision rather than a
 * detail.
 */

export interface BlockContent {
  html: string;
  /** Anything worth telling someone before they push it. */
  notes: string[];
}

/** Everything between the body tags, or the whole thing if there are none. */
function bodyOf(document: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(document);
  return match ? match[1] : document;
}

/** The `<style>` elements from the head, kept whole. */
function headStyles(document: string): string[] {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(document);
  if (!head) return [];
  return [...head[1].matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]);
}

/**
 * The hidden div that carries preview text in a standalone email.
 *
 * Klaviyo sets the preview text on the campaign message itself, so ours would
 * be a second one -- and two preheaders do not replace each other, they
 * concatenate, so the inbox line reads the same sentence twice.
 */
function stripPreheader(html: string): { html: string; removed: boolean } {
  const preheader = /<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/i;
  const match = preheader.exec(html);
  // Only the leading one, and only if it really is the hidden preheader: a
  // `display:none` div further down is somebody's collapsing element.
  if (!match || match.index > 400) return { html, removed: false };
  return { html: html.replace(match[0], ""), removed: true };
}

/**
 * Prepare a rendered document for an HTML block.
 *
 * The `<style>` block comes along, moved into the fragment. Email clients are
 * inconsistent about a `<style>` outside the head, but the alternative is worse
 * and quieter: every media query in these templates is what makes a four-up
 * grid stack on a phone, and dropping them would produce an email that looks
 * right in the desktop preview and is unreadable on the device most people
 * open it on. Kept, and flagged, so it gets checked with a test send rather
 * than assumed either way.
 */
export function toBlockContent(document: string): BlockContent {
  const notes: string[] = [];

  const styles = headStyles(document);
  const stripped = stripPreheader(bodyOf(document));
  if (stripped.removed) {
    notes.push("The template's hidden preheader was removed; Klaviyo's own preview text is used instead.");
  }

  if (styles.length > 0) {
    notes.push(
      "The template's <style> block, which carries the mobile layout rules, was moved into the HTML " +
        "block. Send yourself a test and open it on a phone the first time you use a template.",
    );
  }

  const html = [...styles, stripped.html.trim()].join("\n").trim();
  return { html, notes };
}

/** The comment that says which HTML block the content belongs in. */
export const CONTENT_MARKER = "EMAILPREVIEWS:CONTENT";

interface HtmlBlock {
  data?: { content?: string };
  type?: string;
  content_type?: string;
}

/**
 * Find the HTML block to fill, anywhere in a drag-and-drop definition.
 *
 * Two ways to say which one, in this order:
 *
 * 1. The block contains the marker comment. Explicit, and the only thing that
 *    works once a template has more than one HTML block.
 * 2. There is exactly one HTML block in the whole template. Nothing to be
 *    ambiguous about, so nothing to configure -- setup for the common case is
 *    "drop an HTML block in and save".
 *
 * Anything else is refused rather than guessed at, because guessing wrong means
 * a client's campaign has the content in the wrong place and the chrome
 * overwritten.
 */
export function findContentBlock(definition: unknown): { block: HtmlBlock } | { error: string } {
  const blocks: HtmlBlock[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const candidate = node as HtmlBlock & Record<string, unknown>;
    if (candidate.content_type === "block" && candidate.type === "html") blocks.push(candidate);
    Object.values(candidate).forEach(walk);
  };
  walk(definition);

  if (blocks.length === 0) {
    return {
      error:
        "That Klaviyo template has no HTML block. Add one where the email content should go, and " +
        `put \`<!-- ${CONTENT_MARKER} -->\` inside it.`,
    };
  }

  const marked = blocks.filter((b) => (b.data?.content ?? "").includes(CONTENT_MARKER));
  if (marked.length === 1) return { block: marked[0] };
  if (marked.length > 1) {
    return {
      error: `That Klaviyo template has ${marked.length} HTML blocks carrying the marker. Leave it in only one.`,
    };
  }

  if (blocks.length === 1) return { block: blocks[0] };
  return {
    error:
      `That Klaviyo template has ${blocks.length} HTML blocks and none of them carry the marker, so ` +
      `there is no way to tell which one to fill. Put \`<!-- ${CONTENT_MARKER} -->\` inside the right one.`,
  };
}

/**
 * Cut a cloned template's blocks loose from the universal content they came from.
 *
 * A universal block is one piece of content shared by every template using it,
 * so Klaviyo refuses to write back a template that contains one -- an update
 * from a single campaign's copy could redefine a footer everywhere it appears.
 * That is the right rule, and it stops a push dead: the clone inherits the
 * reference, and the clone is what has to be written.
 *
 * Dropping the reference keeps the content and gives up only the link. That is
 * what a clone is for. Each campaign is meant to be a frozen copy of what was
 * approved, so a footer that changes underneath a scheduled send is a thing to
 * avoid rather than to preserve; and the base template, which is where the
 * universal blocks actually live, is never written to at all.
 */
export function detachUniversalBlocks(definition: unknown): number {
  let detached = 0;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.universal_id === "string") {
      delete record.universal_id;
      detached += 1;
    }
    Object.values(record).forEach(walk);
  };

  walk(definition);
  return detached;
}

/**
 * Klaviyo's own identifiers, which it refuses to be told on a create.
 *
 * Self-identity only. `asset_id`, `product_id`, `coupon_id` and their like name
 * something else that exists and have to survive -- they are references, not
 * claims about who this element is.
 */
export const CREATE_FORBIDDEN_KEYS = ["id", "template_id", "data_id"];

/**
 * Take the identifiers off a definition so Klaviyo can assign its own.
 *
 * A definition read from an existing template names itself at every level --
 * the template, the body, each section, row, column, block and style entry --
 * and a create is refused once per identifier it finds.
 *
 * Which keys those are has been guessed wrong twice, so it is no longer only
 * guessed: this removes the ones known to be refused, and the caller retries on
 * whatever else Klaviyo names in the error. Nothing in a definition refers to
 * another part of it by these, so there is nothing to repoint.
 */
export function stripIdentifiers(definition: unknown, keys = CREATE_FORBIDDEN_KEYS): number {
  let removed = 0;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    for (const key of keys) {
      if (key in record) {
        delete record[key];
        removed += 1;
      }
    }
    Object.values(record).forEach(walk);
  };

  walk(definition);
  return removed;
}
