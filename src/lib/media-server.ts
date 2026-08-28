import { createHash } from "node:crypto";

/**
 * Byte-level inspection of an upload. Kept apart from lib/media.ts because
 * these need Node APIs, and that module is imported by client components.
 */

export function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Detect the real type from the file's own bytes rather than trusting the
 * browser-supplied MIME type or the extension, either of which can lie.
 */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const gif = bytes.toString("latin1", 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Guard against a file that carries the right magic bytes but is not really an
 * image. Every genuine PNG, JPEG, GIF and WebP states its size in its header,
 * so a size that will not parse -- or that parses to something absurd -- means
 * the header is not what it claims. Without this a 29-byte file beginning
 * "GIF89a" is accepted and then reports itself as 26656x27749.
 */
const MAX_PLAUSIBLE_PIXELS = 20000;

export function plausible(dimensions: Dimensions | null): Dimensions | null {
  if (!dimensions) return null;
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1) return null;
  if (width > MAX_PLAUSIBLE_PIXELS || height > MAX_PLAUSIBLE_PIXELS) return null;
  return dimensions;
}

/**
 * Pixel dimensions, read from the file header.
 *
 * Worth having without pulling in an image library: it is the difference
 * between "this hero is 320px wide and will look soft" being visible in the
 * library and being discovered in someone's inbox.
 */
export function readDimensions(bytes: Buffer, mimeType: string): Dimensions | null {
  return plausible(readRawDimensions(bytes, mimeType));
}

function readRawDimensions(bytes: Buffer, mimeType: string): Dimensions | null {
  try {
    if (mimeType === "image/png" && bytes.length > 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mimeType === "image/gif" && bytes.length > 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mimeType === "image/webp") return readWebpDimensions(bytes);
    if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  } catch {
    /* a header we cannot read is not a reason to reject the upload */
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): Dimensions | null {
  const format = bytes.toString("latin1", 12, 16);
  if (format === "VP8X" && bytes.length > 30) {
    return {
      width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  if (format === "VP8 " && bytes.length > 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (format === "VP8L" && bytes.length > 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Walk the JPEG segment chain to the frame header that carries the size. */
function readJpegDimensions(bytes: Buffer): Dimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // SOF0..SOF15, excluding the markers in that range that are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

/**
 * Cheap truncation check: every one of these formats has a defined end.
 *
 * A header alone cannot reveal a half-uploaded file -- a JPEG cut to its first
 * 200 bytes still states its dimensions perfectly -- but a file whose terminator
 * is missing is certainly incomplete, and would render as a grey band or a
 * half-drawn image in the inbox.
 */
export function looksComplete(bytes: Buffer, mimeType: string): boolean {
  if (bytes.length < 24) return false;
  switch (mimeType) {
    case "image/jpeg": {
      // Ignore any trailing padding some encoders leave after the EOI marker.
      let end = bytes.length - 1;
      while (end > 1 && bytes[end] === 0x00) end -= 1;
      return bytes[end - 1] === 0xff && bytes[end] === 0xd9;
    }
    case "image/png":
      return bytes.subarray(-12).includes(Buffer.from("IEND", "latin1"));
    case "image/gif":
      return bytes[bytes.length - 1] === 0x3b;
    case "image/webp": {
      // The RIFF header states the payload length; short means truncated.
      const declared = bytes.readUInt32LE(4);
      return bytes.length >= declared + 8;
    }
    default:
      return true;
  }
}
