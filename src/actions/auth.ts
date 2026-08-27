"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  normalizeEmail,
  requireUser,
  verifyPassword,
} from "@/lib/auth";

export interface FormState {
  error?: string;
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  companyName: z.string().trim().min(1, "Name the company this content belongs to."),
  inviteToken: z.string().optional(),
});

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    // When joining via invite the company already exists, so accept a placeholder.
    companyName: formData.get("companyName") ?? formData.get("inviteToken") ?? "",
    inviteToken: formData.get("inviteToken") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { name, password, inviteToken } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "An account with that email already exists. Sign in instead." };
  }

  const invite = inviteToken
    ? await prisma.invite.findUnique({ where: { token: inviteToken } })
    : null;
  if (inviteToken && !isInviteUsable(invite)) {
    return { error: "That invitation is no longer valid. Ask for a new one." };
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { email, name, passwordHash } });

    if (invite) {
      await tx.membership.create({
        data: { userId: created.id, companyId: invite.companyId, role: invite.role },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    } else {
      const company = await tx.company.create({ data: { name: parsed.data.companyName } });
      await tx.membership.create({
        data: { userId: created.id, companyId: company.id, role: "owner" },
      });
    }
    return created;
  });

  await createSession(user.id);
  redirect("/");
}

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({ where: { email } });
  // Same message either way so the form cannot be used to enumerate accounts.
  const invalid = { error: "Email or password is incorrect." };
  if (!user) return invalid;
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return invalid;

  await claimPendingInvites(user.id, email);
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const createCompanySchema = z.object({ name: z.string().trim().min(1, "Name the company.") });

export async function createCompanyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = createCompanySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Name the company." };
  }

  const company = await prisma.company.create({ data: { name: parsed.data.name } });
  await prisma.membership.create({
    data: { userId: user.id, companyId: company.id, role: "owner" },
  });
  redirect(`/c/${company.id}`);
}

function isInviteUsable(invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null } | null) {
  if (!invite) return false;
  if (invite.acceptedAt || invite.revokedAt) return false;
  return invite.expiresAt > new Date();
}

/**
 * Someone may be invited to a company after they already have a login. Rather
 * than make them hunt for the email again, pending invites for their address
 * are attached the next time they sign in.
 */
export async function claimPendingInvites(userId: string, email: string): Promise<number> {
  const invites = await prisma.invite.findMany({
    where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  let claimed = 0;
  for (const invite of invites) {
    const existing = await prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId: invite.companyId } },
    });
    if (!existing) {
      await prisma.membership.create({
        data: { userId, companyId: invite.companyId, role: invite.role },
      });
      claimed += 1;
    }
    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  }
  return claimed;
}
