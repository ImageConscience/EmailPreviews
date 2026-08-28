"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { ACCEPTED_TYPES, MAX_IMAGE_BYTES, mediaPath } from "@/lib/media";
import { digestOf, looksComplete, readDimensions, sniffImageType } from "@/lib/media-server";

export interface UploadState {
  error?: string;
  ok?: string;
}

/**
 * Absolute origin for image URLs.
 *
 * These end up in sent email, where a relative path means nothing, so they
 * must be absolute. Derived from the request unless APP_URL pins it, which
 * matters once a custom domain is in front of the app.
 */
async function origin(): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function uploadMediaAction(
  companyId: string,
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Choose an image to upload." };

    let added = 0;
    let existing = 0;
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        return { error: `"${file.name}" is larger than 8 MB.` };
      }
      const bytes = Buffer.from(await file.arrayBuffer());

      // Trust the bytes, not the browser's label or the file extension.
      const mimeType = sniffImageType(bytes);
      if (!mimeType || !ACCEPTED_TYPES[mimeType]) {
        return {
          error: `"${file.name}" is not a PNG, JPEG, GIF or WebP image. SVG is not accepted: email clients cannot render it.`,
        };
      }

      const sha256 = digestOf(bytes);
      const already = await prisma.mediaAsset.findUnique({
        where: { companyId_sha256: { companyId, sha256 } },
      });
      if (already) {
        existing += 1;
        continue;
      }

      // A real image always states its size in its header. One that will not
      // parse is not the thing its magic bytes claim to be.
      const dimensions = readDimensions(bytes, mimeType);
      if (!dimensions) {
        return { error: `"${file.name}" could not be read as an image. It may not really be an image file.` };
      }
      if (!looksComplete(bytes, mimeType)) {
        return { error: `"${file.name}" looks truncated — the file ends mid-image. Try exporting or downloading it again.` };
      }

      await prisma.mediaAsset.create({
        data: {
          companyId,
          sha256,
          filename: file.name.slice(0, 200),
          mimeType,
          bytes,
          size: bytes.length,
          width: dimensions?.width,
          height: dimensions?.height,
          uploadedById: access.user.id,
        },
      });
      added += 1;
    }

    revalidatePath(`/c/${companyId}/media`);
    const parts = [];
    if (added) parts.push(`${added} image${added === 1 ? "" : "s"} added`);
    if (existing) parts.push(`${existing} already in the library`);
    return { ok: parts.join(", ") + "." };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    console.error(error);
    return { error: "Could not upload that." };
  }
}

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

/** The company's images, newest first, with absolute URLs ready to paste. */
export async function listMediaAction(companyId: string): Promise<MediaItem[]> {
  await requireCompanyAccess(companyId);
  const base = await origin();
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
