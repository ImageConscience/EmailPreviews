"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { StoreError, fetchAllProducts, normalizeShopDomain } from "@/lib/shopify";

export interface SyncResult {
  ok: boolean;
  error?: string;
  added?: number;
  updated?: number;
  removed?: number;
  total?: number;
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

    revalidatePath(`/c/${companyId}/integrations`);
    return {
      ok: true,
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
