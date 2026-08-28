"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { mediaPath } from "@/lib/media";

export async function deleteMediaAction(companyId: string, assetId: string): Promise<void> {
  await requireCompanyAccess(companyId, "admin");
  await prisma.mediaAsset.deleteMany({ where: { id: assetId, companyId } });
  revalidatePath(`/c/${companyId}/media`);
}

export interface MediaItem {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  uploadedBy: string;
  createdAt: string;
}

/**
 * Absolute origin for image URLs.
 *
 * These end up in sent email, where a relative path means nothing, so they must
 * be absolute. Derived from the request unless APP_URL pins it, which matters
 * once a custom domain is in front of the app.
 */
async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The company's images, newest first, with absolute URLs ready to paste. */
export async function listMediaAction(companyId: string): Promise<MediaItem[]> {
  await requireCompanyAccess(companyId);
  const base = await appOrigin();
  const assets = await prisma.mediaAsset.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sha256: true,
      filename: true,
      mimeType: true,
      size: true,
      width: true,
      height: true,
      createdAt: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
  return assets.map((asset) => ({
    id: asset.id,
    url: `${base}${mediaPath(asset.sha256, asset.mimeType)}`,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    uploadedBy: asset.uploadedBy?.name ?? asset.uploadedBy?.email ?? "Unknown",
    createdAt: asset.createdAt.toISOString(),
  }));
}
