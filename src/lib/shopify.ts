/**
 * Reading a company's products off its own storefront.
 *
 * Shopify publishes `/products.json` on every storefront with no credential at
 * all, which is why this needs nothing more from the user than the domain. The
 * catch is that it is paged: 30 per request by default, 250 at most, and the
 * only way through is `?page=N` until a page comes back empty.
 *
 * Klaviyo would have been the other candidate -- the products are synced there
 * -- but its Catalog API only serves `$custom` catalogs, and a store on the
 * native Shopify integration reads back empty.
 */

export interface StoreProduct {
  externalId: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  url: string;
  imageUrl: string | null;
  price: string | null;
  available: boolean;
  tags: string;
}

/** Shopify's cap. Asking for more is silently clamped, so ask for exactly it. */
const PAGE_SIZE = 250;
/** 20,000 products is far past any campaign use, and stops a runaway loop. */
const MAX_PAGES = 80;
const TIMEOUT_MS = 15000;

export class StoreError extends Error {}

/**
 * "https://Shop.MyStore.com/collections/all" -> "shop.mystore.com".
 * People paste whatever is in the address bar, so take the host out of it.
 */
export function normalizeShopDomain(input: string): string {
  const text = input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const host = text.split("@").pop() ?? "";
  return host.toLowerCase().replace(/:\d+$/, "");
}

interface RawVariant {
  price?: string;
  available?: boolean;
}
interface RawProduct {
  id?: number | string;
  handle?: string;
  title?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: { src?: string }[];
  variants?: RawVariant[];
}

/**
 * The price to show for a product with many variants.
 *
 * The one a shopper would actually pay: the cheapest that is in stock, falling
 * back to the cheapest overall when everything is sold out. Taking variants[0]
 * would show whichever size happens to be listed first.
 */
function priceOf(variants: RawVariant[]): { price: string | null; available: boolean } {
  const numeric = variants
    .map((variant) => ({ variant, value: Number(variant.price) }))
    .filter((entry) => Number.isFinite(entry.value));
  if (numeric.length === 0) return { price: null, available: false };

  const inStock = numeric.filter((entry) => entry.variant.available);
  const pool = inStock.length > 0 ? inStock : numeric;
  const cheapest = pool.reduce((low, entry) => (entry.value < low.value ? entry : low));
  return { price: cheapest.variant.price ?? null, available: inStock.length > 0 };
}

function toProduct(raw: RawProduct, domain: string): StoreProduct | null {
  const externalId = raw.id == null ? "" : String(raw.id);
  const handle = raw.handle ?? "";
  if (!externalId || !handle) return null;

  const { price, available } = priceOf(raw.variants ?? []);
  const tags = Array.isArray(raw.tags) ? raw.tags.join(", ") : (raw.tags ?? "");

  return {
    externalId,
    handle,
    title: raw.title?.trim() || handle,
    vendor: raw.vendor ?? "",
    productType: raw.product_type ?? "",
    url: `https://${domain}/products/${handle}`,
    imageUrl: raw.images?.[0]?.src ?? null,
    price,
    available,
    tags,
  };
}

async function fetchPage(domain: string, page: number): Promise<RawProduct[]> {
  const url = `https://${domain}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new StoreError(
      `Could not reach ${domain}. Check the domain, and that the store is online.`,
    );
  }

  if (response.status === 404) {
    throw new StoreError(
      `${domain} has no public product feed. The storefront may be password-protected, or /products.json disabled.`,
    );
  }
  if (!response.ok) {
    throw new StoreError(`${domain} answered with HTTP ${response.status}.`);
  }

  // A password-protected store answers 200 with an HTML login page, so the
  // content type is the thing that actually tells you it did not work.
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new StoreError(
      `${domain} returned a web page rather than product data — it is probably password-protected.`,
    );
  }

  const body = (await response.json()) as { products?: RawProduct[] };
  if (!Array.isArray(body.products)) {
    throw new StoreError(`${domain} returned something unexpected instead of a product list.`);
  }
  return body.products;
}

/** Every published product on the storefront, walking the pages to the end. */
export async function fetchAllProducts(domain: string): Promise<StoreProduct[]> {
  const products: StoreProduct[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await fetchPage(domain, page);
    if (raw.length === 0) break;

    for (const item of raw) {
      const product = toProduct(item, domain);
      // Some stores keep serving the last page forever rather than an empty
      // one; a repeat id means we have already been here.
      if (!product || seen.has(product.externalId)) continue;
      seen.add(product.externalId);
      products.push(product);
    }
    if (raw.length < PAGE_SIZE) break;
  }

  return products;
}

/* ---------------------------------------------------------------------------
 * Collections
 *
 * `/collections.json` lists them, and `/collections/<handle>/products.json`
 * gives each one's products *in the collection's own order* -- which is the
 * whole point, since that order is the merchandising decision the store
 * already made. Both are public, both page the same way as /products.json.
 * ------------------------------------------------------------------------- */

export interface StoreCollection {
  externalId: string;
  handle: string;
  title: string;
  productCount: number;
}

interface RawCollection {
  id?: number | string;
  handle?: string;
  title?: string;
  products_count?: number;
}

async function fetchJson(url: string, domain: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new StoreError(`Could not reach ${domain}.`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new StoreError(`${domain} answered with HTTP ${response.status}.`);
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new StoreError(`${domain} returned a web page rather than data — it may be password-protected.`);
  }
  return response.json();
}

/** Every published collection on the storefront. */
export async function fetchAllCollections(domain: string): Promise<StoreCollection[]> {
  const collections: StoreCollection[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = (await fetchJson(
      `https://${domain}/collections.json?limit=${PAGE_SIZE}&page=${page}`,
      domain,
    )) as { collections?: RawCollection[] } | null;

    // Some themes disable the collections feed even though products.json works.
    if (!body || !Array.isArray(body.collections)) break;
    if (body.collections.length === 0) break;

    for (const raw of body.collections) {
      const id = raw.id == null ? "" : String(raw.id);
      const handle = (raw.handle ?? "").trim();
      if (!id || !handle || seen.has(id)) continue;
      seen.add(id);
      collections.push({
        externalId: id,
        handle,
        title: (raw.title ?? handle).trim(),
        productCount: typeof raw.products_count === "number" ? raw.products_count : 0,
      });
    }
    if (body.collections.length < PAGE_SIZE) break;
  }

  return collections;
}

/**
 * One collection's products, in the storefront's own order.
 *
 * The order matters more than it looks: it is what the store's merchandiser
 * arranged, so preserving it is what lets "manual" mean anything downstream.
 */
export async function fetchCollectionProducts(
  domain: string,
  handle: string,
): Promise<StoreProduct[]> {
  const products: StoreProduct[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = (await fetchJson(
      `https://${domain}/collections/${encodeURIComponent(handle)}/products.json?limit=${PAGE_SIZE}&page=${page}`,
      domain,
    )) as { products?: RawProduct[] } | null;

    if (!body || !Array.isArray(body.products) || body.products.length === 0) break;

    for (const item of body.products) {
      const product = toProduct(item, domain);
      if (!product || seen.has(product.externalId)) continue;
      seen.add(product.externalId);
      products.push(product);
    }
    if (body.products.length < PAGE_SIZE) break;
  }

  return products;
}
