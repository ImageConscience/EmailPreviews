import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ACCEPTED_TYPES } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Serves an uploaded image.
 *
 * Deliberately unauthenticated: an email client fetching a hero image has no
 * session and never will, so anything behind a login is a broken image in
 * every inbox. The path is the content digest, which is not guessable, and
 * only image bytes are ever stored.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const [sha256] = file.split(".");
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? "")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { sha256 },
    select: { bytes: true, mimeType: true, size: true },
  });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  // Only ever serve a type we accepted on the way in, so a stored row can
  // never talk the browser into treating these bytes as something executable.
  const contentType = ACCEPTED_TYPES[asset.mimeType] ? asset.mimeType : "application/octet-stream";

  return new NextResponse(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(asset.size),
      // The URL names the content, so it can never go stale.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
