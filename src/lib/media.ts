/**
 * Image types worth accepting for email.
 *
 * SVG is deliberately absent. Gmail strips it and Outlook cannot render it, so
 * it is useless in an email anyway -- and an SVG can carry script, which would
 * be served from this app's own origin. Rejecting it removes both problems.
 */
export const ACCEPTED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Outlook on Windows cannot display WebP, so it is allowed but flagged. */
export const RISKY_TYPES = new Set(["image/webp"]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Above this, a hero photo starts hurting deliverability and load time. */
export const LARGE_IMAGE_BYTES = 1024 * 1024;

export function extensionFor(mimeType: string): string {
  return ACCEPTED_TYPES[mimeType] ?? "bin";
}

/** Public path for an asset. Content-addressed, so it never needs to change. */
export function mediaPath(sha256: string, mimeType: string): string {
  return `/i/${sha256}.${extensionFor(mimeType)}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
