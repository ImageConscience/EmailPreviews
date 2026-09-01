/**
 * Naming a collection in a cell, instead of filling twenty product cells by hand.
 *
 * A row says `grid_collection = 2026-writers-tee-drop | newest | 4` and the four
 * grid tiles fill themselves at render time. The sort is part of the cell rather
 * than a separate column on purpose: it is a per-send decision ("newest for the
 * drop email, manual for the evergreen one"), and a column would have to be
 * filled in on every row that does not care.
 *
 * The expansion is a pre-render step, not a template feature. The placeholder
 * engine is flat key-to-value with no loops, and teaching it loops to serve one
 * case would be a large change to the thing every template depends on. Filling
 * `product_5_title` and friends before substitution leaves the templates exactly
 * as they are, and keeps Highlight gaps honest -- by render time those fields
 * genuinely have values.
 */

export type CollectionOrder =
  | "manual"
  | "newest"
  | "oldest"
  | "price-asc"
  | "price-desc"
  | "title";

export const COLLECTION_ORDERS: CollectionOrder[] = [
  "manual",
  "newest",
  "oldest",
  "price-asc",
  "price-desc",
  "title",
];

/** How each order reads in the UI, and what it does. */
export const ORDER_LABELS: Record<CollectionOrder, string> = {
  manual: "Collection order",
  newest: "Newest first",
  oldest: "Oldest first",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  title: "Title, A–Z",
};

export interface CollectionSpec {
  handle: string;
  order: CollectionOrder;
  /** How many slots to fill. Never more than the block has. */
  limit: number;
  /** Skip this many from the top -- so two blocks can draw from one collection. */
  offset: number;
}

/**
 * Which cell drives which product slots.
 *
 * Both blocks exist because the two halves of a category email are different
 * jobs: 1-4 are the featured tiles that carry badges, 5-8 are the four-up grid.
 * A row can use either, both, or neither.
 */
export interface CollectionBlock {
  field: string;
  slots: number[];
}

export const COLLECTION_BLOCKS: CollectionBlock[] = [
  { field: "featured_collection", slots: [1, 2, 3, 4] },
  { field: "grid_collection", slots: [5, 6, 7, 8] },
];

function toOrder(value: string): CollectionOrder | null {
  const text = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return (COLLECTION_ORDERS as string[]).includes(text) ? (text as CollectionOrder) : null;
}

/**
 * `handle | order | count | skip` -- everything after the handle optional.
 *
 * Returns null for an empty cell, which is the common case and not an error.
 * An unrecognised order is also not an error: the handle is the part that
 * matters, so fall back to the collection's own order rather than filling
 * nothing and leaving someone hunting for a typo in a preview that just
 * looks empty.
 */
export function parseCollectionSpec(value: string, maxSlots: number): CollectionSpec | null {
  const parts = (value ?? "").split("|").map((part) => part.trim());
  const handle = normalizeHandle(parts[0] ?? "");
  if (!handle) return null;

  const order = parts[1] ? (toOrder(parts[1]) ?? "manual") : "manual";
  const limit = clamp(parts[2], maxSlots, maxSlots);
  const offset = clamp(parts[3], 0, 500);

  return { handle, order, limit, offset };
}

function clamp(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/**
 * People paste the address bar, so take the handle out of whatever arrives:
 * a full collection URL, a leading slash, a trailing query.
 */
export function normalizeHandle(input: string): string {
  const text = (input ?? "").trim();
  if (!text) return "";
  const withoutQuery = text.split(/[?#]/)[0];
  const match = withoutQuery.match(/collections\/([^/]+)/i);
  const handle = (match ? match[1] : withoutQuery).replace(/^\/+|\/+$/g, "");
  return handle.toLowerCase();
}

/** Render a spec back into a cell, leaving off anything left at its default. */
export function formatCollectionSpec(spec: CollectionSpec, maxSlots: number): string {
  const parts = [spec.handle];
  const needsLimit = spec.limit !== maxSlots;
  if (spec.order !== "manual" || needsLimit || spec.offset > 0) parts.push(spec.order);
  if (needsLimit || spec.offset > 0) parts.push(String(spec.limit));
  if (spec.offset > 0) parts.push(String(spec.offset));
  return parts.join(" | ");
}

export interface OrderableProduct {
  title: string;
  price: string | null;
  position: number;
  createdOrder: number;
}

/** Price cells are strings ("$45.00", "1,000.00"), so pull a number out. */
export function priceValue(price: string | null): number {
  const n = Number.parseFloat((price ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export function sortForOrder<T extends OrderableProduct>(products: T[], order: CollectionOrder): T[] {
  const sorted = [...products];
  switch (order) {
    case "newest":
      return sorted.sort((a, b) => b.createdOrder - a.createdOrder);
    case "oldest":
      return sorted.sort((a, b) => a.createdOrder - b.createdOrder);
    case "price-asc":
      return sorted.sort((a, b) => priceValue(a.price) - priceValue(b.price));
    case "price-desc":
      return sorted.sort((a, b) => priceValue(b.price) - priceValue(a.price));
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "manual":
    default:
      return sorted.sort((a, b) => a.position - b.position);
  }
}

/**
 * The catalogue stores what the storefront gives, which is a bare "45.00".
 * Cells carry the symbol, so add it here -- and in one place, because the
 * picker and the collection fill writing prices in different shapes was a real
 * difference nobody would have gone looking for.
 */
export function displayPrice(price: string | null | undefined): string {
  const text = (price ?? "").trim();
  if (!text) return "";
  return /^[0-9]/.test(text) ? `$${text}` : text;
}

/**
 * How much product copy a tile will take before it stops being a tile.
 *
 * Shopify descriptions run to whole spec sheets, and a featured slot is a
 * paragraph beside a photo. Klaviyo's own template cut at the same 300.
 */
export const DESCRIPTION_LIMIT = 300;

/**
 * Trim to the limit at a word boundary, with an ellipsis.
 *
 * Only ever applied to text coming out of the catalogue. A description typed
 * into the cell is left exactly as written -- someone who wrote 400 words of
 * copy meant them, and silently cutting it would be the app overruling the
 * person using it.
 */
export function summarize(text: string, limit = DESCRIPTION_LIMIT): string {
  const clean = (text ?? "").trim();
  if (clean.length <= limit) return clean;

  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  // A limit that lands mid-word backs up to the last space, unless that would
  // throw away most of the text (a single very long token).
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.\u2014\u2013-]+$/, "")}\u2026`;
}

export interface FillProduct {
  title: string;
  price: string | null;
  url: string;
  imageUrl: string | null;
  description?: string | null;
}

/**
 * Write a collection's products into product_N_* keys.
 *
 * A slot that already has a value is left alone. That is the rule that makes
 * the feature usable rather than all-or-nothing: pin the one tile you care
 * about, let the collection fill the rest around it.
 */
export function applyFill(
  values: Record<string, string>,
  slots: number[],
  products: FillProduct[],
): Record<string, string> {
  const next = { ...values };
  let index = 0;

  for (const slot of slots) {
    const keys = {
      title: `product_${slot}_title`,
      price: `product_${slot}_price`,
      url: `product_${slot}_url`,
      image: `product_${slot}_image`,
      description: `product_${slot}_description`,
    };
    // Any hand-entered field claims the slot -- title alone is enough to mean
    // "this one is mine".
    const taken = Object.values(keys).some((key) => (next[key] ?? "").trim() !== "");
    if (taken) continue;

    const product = products[index++];
    if (!product) continue;

    next[keys.title] = product.title;
    next[keys.price] = displayPrice(product.price);
    next[keys.url] = product.url;
    next[keys.image] = product.imageUrl ?? "";
    next[keys.description] = summarize(product.description ?? "");
  }

  return next;
}
