import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { hasAtLeast, type Role } from "@/lib/auth";

/**
 * Credentials for callers with no browser session.
 *
 * The MCP connector reaches this app as itself, not as a logged-in tab, so it
 * needs something it can carry in a header. A token stands for one person and
 * carries exactly the companies and roles that person already has -- it is a
 * second door into the same room, never a wider one.
 */

/** Recognisable in a config file, and greppable in a log that should not have it. */
const PREFIX = "ep_";
const PREFIX_SHOWN = 10;

export interface TokenBearer {
  userId: string;
  tokenId: string;
  email: string;
  name: string | null;
}

export interface TokenAccess extends TokenBearer {
  companyId: string;
  companyName: string;
  role: Role;
}

export class TokenError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** A token is shown once. What is kept is the hash and enough of the head to name it. */
export async function mintToken(userId: string, label: string) {
  const token = PREFIX + randomBytes(32).toString("hex");
  const record = await prisma.apiToken.create({
    data: {
      userId,
      label: label.trim() || "Untitled token",
      hash: hashToken(token),
      prefix: token.slice(0, PREFIX_SHOWN),
    },
  });
  return { token, record };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Pull the token out of whichever header carries it.
 *
 * `Authorization: Bearer <token>` is the usual one. `X-Api-Key` is here because
 * a client that sets its own headers does not always let you set that one --
 * some reserve it for their own sign-in flow -- and being turned away by a
 * client's header rules is a miserable thing to debug from this end, where all
 * you see is a request with no credential.
 *
 * The `Bearer ` prefix is optional on both, since it is exactly the sort of
 * thing that gets left off or doubled up when pasting into a form.
 */
function presentedToken(request: Request): string | null {
  const candidates = [
    request.headers.get("authorization"),
    request.headers.get("x-api-key"),
  ];
  for (const raw of candidates) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const token = /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? value;
    if (token) return token;
  }
  return null;
}

/**
 * The token a request carries, if it carries one this app issued.
 *
 * The lookup is by hash, and the hash is compared again in constant time --
 * the index lookup already decided the answer, but a unique index is not a
 * promise about timing.
 */
export async function bearerFrom(request: Request): Promise<TokenBearer> {
  const presented = presentedToken(request);
  if (!presented) {
    throw new TokenError(
      "Send an API token as `Authorization: Bearer <token>`, or as `X-Api-Key: <token>`.",
    );
  }

  const record = await prisma.apiToken.findUnique({
    where: { hash: hashToken(presented) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!record || !sameHash(record.hash, hashToken(presented))) {
    throw new TokenError("That API token is not one this app issued.");
  }
  if (record.revokedAt) throw new TokenError("That API token has been revoked.");

  // Best-effort: a failed write here must not fail the call it is recording.
  prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    userId: record.user.id,
    tokenId: record.id,
    email: record.user.email,
    name: record.user.name,
  };
}

/**
 * The bearer's standing in one company.
 *
 * Deliberately the same shape and the same rule as `requireCompanyAccess`: a
 * token opens no door its owner could not already walk through.
 */
export async function tokenCompanyAccess(
  bearer: TokenBearer,
  companyId: string,
  minimum: Role = "member",
): Promise<TokenAccess> {
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: bearer.userId, companyId } },
    include: { company: true },
  });
  // Not found rather than forbidden: a token should not be a way to learn which
  // company ids exist.
  if (!membership) throw new TokenError("No such company.", 404);
  if (!hasAtLeast(membership.role, minimum)) {
    throw new TokenError("You do not have permission to do that.", 403);
  }
  return {
    ...bearer,
    companyId,
    companyName: membership.company.name,
    role: membership.role as Role,
  };
}

/** Every company this token can see, for the tool that has to list them. */
export async function tokenCompanies(bearer: TokenBearer) {
  const memberships = await prisma.membership.findMany({
    where: { userId: bearer.userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.company.id,
    name: m.company.name,
    role: m.role as Role,
  }));
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
