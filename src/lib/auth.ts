import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "ep_session";
const SESSION_DAYS = 30;

export type Role = "owner" | "admin" | "member";

const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function hasAtLeast(role: string, minimum: Role): boolean {
  return (ROLE_RANK[role as Role] ?? 0) >= ROLE_RANK[minimum];
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  store.delete(COOKIE_NAME);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("You need to sign in.", 401);
  return user;
}

export interface CompanyAccess {
  user: SessionUser;
  companyId: string;
  companyName: string;
  role: Role;
}

/**
 * Single choke point for tenancy: every company-scoped read or write goes
 * through here, so a user can never reach another company's content.
 */
export async function requireCompanyAccess(
  companyId: string,
  minimum: Role = "member",
): Promise<CompanyAccess> {
  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
    include: { company: true },
  });
  if (!membership) throw new AuthError("Company not found.", 404);
  if (!hasAtLeast(membership.role, minimum)) {
    throw new AuthError("You do not have permission to do that.", 403);
  }
  return {
    user,
    companyId,
    companyName: membership.company.name,
    role: membership.role as Role,
  };
}

export async function listCompaniesForUser(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.company.id,
    name: m.company.name,
    role: m.role as Role,
  }));
}
