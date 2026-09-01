"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import {
  StoreError,
  fetchAllCollections,
  fetchAllProducts,
  fetchCollectionProducts,
  normalizeShopDomain,
} from "@/lib/shopify";
import {
  type CollectionSpec,
  type FillProduct,
  sortForOrder,
} from "@/lib/collection-spec";
import { parseRecord, parseStringArray } from "@/lib/json";
import { rowLabel } from "@/lib/campaign";

export interface SyncResult {
  ok: boolean;
  error?: string;
  added?: number;
  updated?: number;
  removed?: number;
  total?: number;
  collections?: number;
  /** Set when products synced but the collections feed is unavailable. */
  collectionNote?: string;
}

/** Point a company at its storefront. Clearing the domain empties the cache. */
export async function saveShopDomainAction(
  companyId: string,
  domain: string,
): Promise<{ ok: boolean; error?: string; domain?: string }> {
  try {
    await requireCompanyAccess(companyId, "admin");
    const normalized = normalizeShopDomain(domain);

    if (normalized && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
      return { ok: false, error: `"${domain}" does not look like a domain.` };
    }

    if (!normalized) {
      await prisma.$transaction([
        prisma.catalogProduct.deleteMany({ where: { companyId } }),
        prisma.company.update({
          where: { id: companyId },
          data: { shopDomain: null, catalogSyncedAt: null },
        }),
      ]);
      revalidatePath(`/c/${companyId}/integrations`);
      return { ok: true, domain: "" };
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { shopDomain: normalized },
    });
    revalidatePath(`/c/${companyId}/integrations`);
    return { ok: true, domain: normalized };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that." };
  }
}

/**
 * Refresh the product cache from the storefront.
 *
 * Products that have gone from the store are removed rather than left behind:
 * a picker that offers something delisted puts a dead link in an email.
 */
export async function syncCatalogAction(companyId: string): Promise<SyncResult> {
  try {
    await requireCompanyAccess(companyId, "member");
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { shopDomain: true },
    });
    if (!company?.shopDomain) {
      return { ok: false, error: "No storefront is set for this company yet." };
    }

    const products = await fetchAllProducts(company.shopDomain);
    if (products.length === 0) {
      return {
        ok: false,
        error: `${company.shopDomain} returned no products. If the store is live, its product feed may be turned off.`,
      };
    }

    const existing = await prisma.catalogProduct.findMany({
      where: { companyId },
      select: { externalId: true },
    });
    const had = new Set(existing.map((product) => product.externalId));
    const now = new Set(products.map((product) => product.externalId));

    await prisma.$transaction([
      ...products.map((product) =>
        prisma.catalogProduct.upsert({
          where: { companyId_externalId: { companyId, externalId: product.externalId } },
          create: { companyId, ...product, syncedAt: new Date() },
          update: { ...product, syncedAt: new Date() },
        }),
      ),
      prisma.catalogProduct.deleteMany({
        where: { companyId, externalId: { notIn: products.map((p) => p.externalId) } },
      }),
      prisma.company.update({
        where: { id: companyId },
        data: { catalogSyncedAt: new Date() },
      }),
    ]);

    const collectionResult = await syncCollections(companyId, company.shopDomain);

    revalidatePath(`/c/${companyId}/integrations`);
    return {
      ok: true,
      collections: collectionResult.count,
      collectionNote: collectionResult.note,
      added: products.filter((product) => !had.has(product.externalId)).length,
      updated: products.filter((product) => had.has(product.externalId)).length,
      removed: [...had].filter((id) => !now.has(id)).length,
      total: products.length,
    };
  } catch (error) {
    if (error instanceof StoreError) return { ok: false, error: error.message };
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "The sync failed. Try again in a moment." };
  }
}

export interface ProductOption {
  id: string;
  title: string;
  price: string | null;
  url: string;
  imageUrl: string | null;
  available: boolean;
  productType: string | null;
}

/** Products matching what has been typed, newest-synced first. */
export async function searchProductsAction(
  companyId: string,
  query: string,
): Promise<ProductOption[]> {
  await requireCompanyAccess(companyId);
  const needle = query.trim();

  const products = await prisma.catalogProduct.findMany({
    where: {
      companyId,
      ...(needle
        ? {
            OR: [
              { title: { contains: needle, mode: "insensitive" } },
              { tags: { contains: needle, mode: "insensitive" } },
              { productType: { contains: needle, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ available: "desc" }, { title: "asc" }],
    take: 60,
    select: {
      id: true,
      title: true,
      price: true,
      url: true,
      imageUrl: true,
      available: true,
      productType: true,
    },
  });
  return products;
}

/* ------------------------------------------------------------------ */
/* Relinking existing rows to the catalog                              */
/* ------------------------------------------------------------------ */

export interface RelinkChange {
  sheetName: string;
  rowLabel: string;
  group: string;
  field: string;
  from: string;
  to: string;
}

export interface RelinkReport {
  ok: boolean;
  error?: string;
  /** Product tiles whose link was recognised and can be refreshed. */
  matched: number;
  /** Rows that would change at all. */
  rows: number;
  /** Individual cell changes. */
  changes: number;
  /** Handles in the sheets that no longer exist in the store. */
  unmatched: string[];
  sample: RelinkChange[];
  applied?: boolean;
}

/** "https://shop/products/subway-art?v=2" -> "subway-art" */
function handleOf(url: string): string | null {
  const match = /\/products\/([^/?#]+)/.exec(url);
  return match ? match[1].toLowerCase() : null;
}

const GROUP = /^product[_ -]?(\d+)[_ -]?url$/i;
const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * Re-point every product tile in every sheet at the synced catalog.
 *
 * The sheets were built from Klaviyo's rendering, which resolves products to
 * `*.myshopify.com` and to whatever price and image were current that day. This
 * walks the stored links, finds each product by its handle, and refreshes the
 * tile from the cache -- customer-facing URL, current price, current image.
 *
 * `apply` false reports what would change and writes nothing.
 */
export async function relinkProductsAction(
  companyId: string,
  apply: boolean,
): Promise<RelinkReport> {
  const empty: RelinkReport = { ok: true, matched: 0, rows: 0, changes: 0, unmatched: [], sample: [] };
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const products = await prisma.catalogProduct.findMany({ where: { companyId } });
    if (products.length === 0) {
      return { ...empty, ok: false, error: "Nothing is cached yet — sync the storefront first." };
    }
    const byHandle = new Map(products.map((product) => [product.handle.toLowerCase(), product]));

    const sheets = await prisma.contentSheet.findMany({
      where: { companyId },
      include: { rows: { orderBy: { position: "asc" } } },
    });

    const report: RelinkReport = { ...empty, unmatched: [], sample: [], applied: apply };
    const unmatched = new Set<string>();
    const writes: { rowId: string; previous: string; next: Record<string, string> }[] = [];

    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        const data = parseRecord(row.data);
        const next = { ...data };
        let touchedRow = false;

        for (const key of Object.keys(data)) {
          const match = GROUP.exec(norm(key));
          if (!match) continue;
          const handle = handleOf(data[key] ?? "");
          if (!handle) continue;

          const product = byHandle.get(handle);
          if (!product) {
            unmatched.add(handle);
            continue;
          }
          report.matched += 1;

          const group = `product_${match[1]}`;
          const wanted: Record<string, string> = {
            [`${group}_url`]: product.url,
            [`${group}_image`]: product.imageUrl ?? "",
            [`${group}_title`]: product.title,
            [`${group}_price`]: product.price ? `$${product.price}` : "",
          };

          for (const [wantedKey, value] of Object.entries(wanted)) {
            // Only columns the sheet already has, and only a real change. An
            // empty replacement is skipped: losing a value to a gap in the
            // catalog would be worse than a slightly stale one.
            const column = Object.keys(data).find((c) => norm(c) === wantedKey);
            if (!column || !value) continue;
            const from = data[column] ?? "";
            if (from === value) continue;

            next[column] = value;
            touchedRow = true;
            report.changes += 1;
            if (report.sample.length < 12) {
              report.sample.push({
                sheetName: sheet.name,
                rowLabel: rowLabel(data, parseStringArray(sheet.columns)),
                group,
                field: column,
                from,
                to: value,
              });
            }
          }
        }

        if (touchedRow) {
          report.rows += 1;
          writes.push({ rowId: row.id, previous: row.data, next });
        }
      }
    }

    report.unmatched = [...unmatched].sort();

    if (apply && writes.length > 0) {
      // Each row keeps its previous values as a revision, exactly as a hand
      // edit would, so this is undoable row by row from History.
      await prisma.$transaction(
        writes.flatMap((write) => [
          prisma.rowRevision.create({
            data: {
              rowId: write.rowId,
              data: write.previous,
              changedById: access.user.id,
              note: "Relinked to the product catalog",
            },
          }),
          prisma.sheetRow.update({
            where: { id: write.rowId },
            data: { data: JSON.stringify(write.next) },
          }),
        ]),
      );
      revalidatePath(`/c/${companyId}/integrations`);
    }

    return report;
  } catch (error) {
    if (error instanceof AuthError) return { ...empty, ok: false, error: error.message };
    return { ...empty, ok: false, error: "Could not check the sheets." };
  }
}

/**
 * Collections, and which products sit in each.
 *
 * Deliberately not fatal: a theme can serve /products.json while having the
 * collections feed switched off, and a product sync that already succeeded
 * should not be reported as a failure because of it.
 */
async function syncCollections(
  companyId: string,
  domain: string,
): Promise<{ count: number; note?: string }> {
  let collections;
  try {
    collections = await fetchAllCollections(domain);
  } catch {
    return { count: 0, note: `${domain} did not return a collection list.` };
  }
  if (collections.length === 0) {
    return { count: 0, note: `${domain} published no collections.` };
  }

  // Map Shopify ids to our rows once, so membership can be written by id.
  const products = await prisma.catalogProduct.findMany({
    where: { companyId },
    select: { id: true, externalId: true },
  });
  const idOf = new Map(products.map((product) => [product.externalId, product.id]));

  let stored = 0;
  for (const collection of collections) {
    let members;
    try {
      members = await fetchCollectionProducts(domain, collection.handle);
    } catch {
      continue;
    }

    const row = await prisma.catalogCollection.upsert({
      where: { companyId_handle: { companyId, handle: collection.handle } },
      create: { companyId, ...collection, syncedAt: new Date() },
      update: { ...collection, syncedAt: new Date() },
    });

    // Membership is small and order-sensitive; replacing it wholesale is both
    // simpler and correct when a product is removed or the order is changed.
    await prisma.catalogCollectionProduct.deleteMany({ where: { collectionId: row.id } });
    const links = members
      .map((member, position) => ({ productId: idOf.get(member.externalId), position }))
      .filter((link): link is { productId: string; position: number } => Boolean(link.productId))
      .map((link) => ({ collectionId: row.id, ...link }));
    if (links.length > 0) {
      await prisma.catalogCollectionProduct.createMany({ data: links });
    }
    stored++;
  }

  await prisma.catalogCollection.deleteMany({
    where: { companyId, handle: { notIn: collections.map((c) => c.handle) } },
  });

  return { count: stored };
}

export interface CollectionOption {
  handle: string;
  title: string;
  count: number;
}

/** The collections a row can name, for the picker. */
export async function listCollectionsAction(companyId: string): Promise<CollectionOption[]> {
  await requireCompanyAccess(companyId);
  const rows = await prisma.catalogCollection.findMany({
    where: { companyId },
    orderBy: { title: "asc" },
    select: { handle: true, title: true, _count: { select: { products: true } } },
  });
  return rows.map((row) => ({
    handle: row.handle,
    title: row.title,
    count: row._count.products,
  }));
}

export interface ResolvedCollection {
  handle: string;
  title: string | null;
  products: FillProduct[];
  /** Total in the collection, so the UI can say "4 of 37". */
  available: number;
}

/**
 * The products a spec resolves to, already ordered and cut to the limit.
 *
 * Out-of-stock products are kept rather than dropped: the storefront feed is a
 * cache that can be hours old, and silently swapping a tile because of a stale
 * availability flag is worse than showing what the collection actually holds.
 */
export async function resolveCollectionAction(
  companyId: string,
  spec: CollectionSpec,
): Promise<ResolvedCollection> {
  await requireCompanyAccess(companyId);

  const collection = await prisma.catalogCollection.findUnique({
    where: { companyId_handle: { companyId, handle: spec.handle } },
    select: {
      title: true,
      products: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          product: {
            select: { title: true, price: true, url: true, imageUrl: true, syncedAt: true },
          },
        },
      },
    },
  });

  if (!collection) {
    return { handle: spec.handle, title: null, products: [], available: 0 };
  }

  const items = collection.products.map((link, index) => ({
    title: link.product.title,
    price: link.product.price,
    url: link.product.url,
    imageUrl: link.product.imageUrl,
    position: link.position,
    // The storefront feed gives no created date, but it returns products
    // newest-first, so the collection's own order is the best proxy we have.
    createdOrder: collection.products.length - index,
  }));

  const ordered = sortForOrder(items, spec.order).slice(spec.offset, spec.offset + spec.limit);

  return {
    handle: spec.handle,
    title: collection.title,
    available: collection.products.length,
    products: ordered.map(({ title, price, url, imageUrl }) => ({ title, price, url, imageUrl })),
  };
}
