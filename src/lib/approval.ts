/**
 * How a person is drawn, and what their approvals mean.
 *
 * Deliberately free of node-only imports: the notes flyout and the calendar
 * both need `avatarHue` and `initialsOf` so a person looks like themselves
 * everywhere, and those are client components. The hashing that decides whether
 * an approval is still current lives in `fingerprint.ts` instead -- it is a
 * server concern, and importing it here would drag `node:crypto` into the
 * browser bundle and fail the build.
 */

/** "Dana Whitfield" becomes "DW"; falls back to the email when there is no name. */
export function initialsOf(name: string | null, email: string): string {
  const source = (name ?? "").trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A stable colour per person, so the same initials keep the same bubble
 * everywhere without storing a colour on the user.
 */
export function avatarHue(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export interface ApprovalView {
  userId: string;
  name: string;
  initials: string;
  hue: number;
  at: string;
  /** The row or the template changed after this approval was given. */
  stale: boolean;
}

interface ApprovalRecord {
  userId: string;
  contentHash: string;
  createdAt: Date;
  user: { name: string | null; email: string };
}

/** Shape stored approvals for display, marking any that no longer match. */
export function presentApprovals(
  approvals: ApprovalRecord[],
  currentHash: string,
): ApprovalView[] {
  return approvals.map((approval) => ({
    userId: approval.userId,
    name: approval.user.name ?? approval.user.email,
    initials: initialsOf(approval.user.name, approval.user.email),
    hue: avatarHue(approval.userId),
    at: approval.createdAt.toISOString(),
    stale: approval.contentHash !== currentHash,
  }));
}
