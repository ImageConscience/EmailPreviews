import { prisma } from "@/lib/db";
import { ACCEPTED_TYPES, MAX_IMAGE_BYTES, formatBytes } from "@/lib/media";
import { digestOf, looksComplete, readDimensions, sniffImageType } from "@/lib/media-server";

export interface StoreResult {
  filename: string;
  status: "added" | "duplicate" | "rejected";
  reason?: string;
}

/**
 * Validate and store one uploaded image.
 *
 * Shared so the checks live in exactly one place regardless of how the bytes
 * arrived, and so a rejection explains itself in terms of what to do about it.
 */
export async function storeUpload(
  companyId: string,
  userId: string,
  file: File,
): Promise<StoreResult> {
  const filename = file.name.slice(0, 200);

  if (file.size > MAX_IMAGE_BYTES) {
    return {
      filename,
      status: "rejected",
      reason: `${formatBytes(file.size)} is over the ${formatBytes(MAX_IMAGE_BYTES)} limit.`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Trust the bytes, not the browser's label or the file extension.
  const mimeType = sniffImageType(bytes);
  if (!mimeType || !ACCEPTED_TYPES[mimeType]) {
    return {
      filename,
      status: "rejected",
      reason: "Not a PNG, JPEG, GIF or WebP. SVG is not accepted: email clients cannot render it.",
    };
  }

  const sha256 = digestOf(bytes);
  const already = await prisma.mediaAsset.findUnique({
    where: { companyId_sha256: { companyId, sha256 } },
  });
  if (already) return { filename, status: "duplicate" };

  // A real image states its size in its header; one that will not parse is not
  // the thing its magic bytes claim to be.
  const dimensions = readDimensions(bytes, mimeType);
  if (!dimensions) {
    return { filename, status: "rejected", reason: "Could not be read as an image." };
  }
  if (!looksComplete(bytes, mimeType)) {
    return {
      filename,
      status: "rejected",
      reason: "Looks truncated — the file ends mid-image. Try downloading it again.",
    };
  }

  await prisma.mediaAsset.create({
    data: {
      companyId,
      sha256,
      filename,
      mimeType,
      bytes,
      size: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      uploadedById: userId,
    },
  });
  return { filename, status: "added" };
}
