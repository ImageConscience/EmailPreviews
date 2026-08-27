"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, normalizeEmail, requireCompanyAccess, type Role } from "@/lib/auth";

export interface FormState {
  error?: string;
  ok?: string;
  inviteUrl?: string;
}

const INVITE_DAYS = 14;

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["member", "admin"]),
});

/**
 * Creates an invitation and returns its link. There is no mail sending
 * configured, so the link is shown to the inviter to pass along -- which also
 * means the app has no SMTP dependency to stand up before it is usable.
 */
export async function inviteMemberAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const access = await requireCompanyAccess(companyId, "admin");
    const parsed = inviteSchema.safeParse({
      email: formData.get("email"),
      role: formData.get("role") ?? "member",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const email = normalizeEmail(parsed.data.email);

    const existing = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { companyId } } },
    });
    if (existing && existing.memberships.length > 0) {
      return { error: "That person is already on this company." };
    }

    // Supersede any outstanding invite for the same address.
    await prisma.invite.updateMany({
      where: { companyId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(24).toString("hex");
    await prisma.invite.create({
      data: {
        companyId,
        email,
        role: parsed.data.role,
        token,
        invitedById: access.user.id,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath(`/c/${companyId}/members`);
    return {
      ok: existing
        ? `${email} already has a login — the invite is attached and will appear the next time they sign in.`
        : `Invitation created for ${email}. Send them the link below.`,
      inviteUrl: `/signup?invite=${token}`,
    };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    return { error: "Could not create that invitation." };
  }
}

export async function revokeInviteAction(companyId: string, inviteId: string): Promise<void> {
  await requireCompanyAccess(companyId, "admin");
  await prisma.invite.updateMany({
    where: { id: inviteId, companyId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath(`/c/${companyId}/members`);
}

export async function changeRoleAction(
  companyId: string,
  membershipId: string,
  role: Role,
): Promise<void> {
  const access = await requireCompanyAccess(companyId, "admin");

  const membership = await prisma.membership.findFirst({ where: { id: membershipId, companyId } });
  if (!membership) throw new AuthError("Member not found.", 404);
  if (membership.userId === access.user.id) {
    throw new AuthError("You cannot change your own role.", 400);
  }
  // Only an owner may hand out or take away ownership.
  if ((membership.role === "owner" || role === "owner") && access.role !== "owner") {
    throw new AuthError("Only the owner can change ownership.", 403);
  }
  if (membership.role === "owner" && role !== "owner" && (await countOwners(companyId)) <= 1) {
    throw new AuthError("A company must keep at least one owner.", 400);
  }

  await prisma.membership.update({ where: { id: membershipId }, data: { role } });
  revalidatePath(`/c/${companyId}/members`);
}

export async function removeMemberAction(companyId: string, membershipId: string): Promise<void> {
  const access = await requireCompanyAccess(companyId, "admin");

  const membership = await prisma.membership.findFirst({ where: { id: membershipId, companyId } });
  if (!membership) return;
  if (membership.userId === access.user.id) {
    throw new AuthError("You cannot remove yourself. Ask another admin.", 400);
  }
  if (membership.role === "owner" && access.role !== "owner") {
    throw new AuthError("Only the owner can remove another owner.", 403);
  }
  if (membership.role === "owner" && (await countOwners(companyId)) <= 1) {
    throw new AuthError("A company must keep at least one owner.", 400);
  }

  await prisma.membership.delete({ where: { id: membershipId } });
  revalidatePath(`/c/${companyId}/members`);
}

function countOwners(companyId: string): Promise<number> {
  return prisma.membership.count({ where: { companyId, role: "owner" } });
}
