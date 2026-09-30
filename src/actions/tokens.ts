"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { mintToken } from "@/lib/api-token";

/**
 * Personal API tokens.
 *
 * A token stands for one person across every company they belong to, so these
 * actions never take a company beyond the one whose page they were called from
 * -- that is only there to send you back to the right screen afterwards.
 */

export interface TokenSummary {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface MintResult {
  ok: boolean;
  error?: string;
  /** The only time the token is ever readable. */
  token?: string;
}

function fail(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export async function mintTokenAction(companyId: string, label: string): Promise<MintResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");
    const { token } = await mintToken(access.user.id, label);
    revalidatePath(`/c/${companyId}/integrations`);
    return { ok: true, token };
  } catch (error) {
    return { ok: false, error: fail(error) };
  }
}

export async function revokeTokenAction(
  companyId: string,
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const access = await requireCompanyAccess(companyId, "member");
    // Scoped to the caller's own tokens: a token is personal, and an admin
    // revoking somebody else's from this screen would be a surprise.
    const updated = await prisma.apiToken.updateMany({
      where: { id: tokenId, userId: access.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) return { ok: false, error: "That token is not yours, or is already revoked." };
    revalidatePath(`/c/${companyId}/integrations`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: fail(error) };
  }
}
