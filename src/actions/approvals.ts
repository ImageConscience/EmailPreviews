"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { approvalFingerprint, presentApprovals, type ApprovalView } from "@/lib/approval";

interface ToggleResult {
  ok: boolean;
  error?: string;
  approved?: boolean;
  approvals?: ApprovalView[];
}

/**
 * Approve, or withdraw your own approval, for one row in one template.
 *
 * You can only ever add or remove your own. An approval record is worth having
 * precisely because nobody else can put words in your mouth or take them back.
 */
export async function toggleApprovalAction(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<ToggleResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const [row, template] = await Promise.all([
      prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId } } }),
      prisma.template.findFirst({ where: { id: templateId, companyId } }),
    ]);
    if (!row || !template) return { ok: false, error: "Not found." };

    const hash = approvalFingerprint(row.data, template.id, template.updatedAt);
    const mine = await prisma.approval.findUnique({
      where: { rowId_templateId_userId: { rowId, templateId, userId: access.user.id } },
    });

    // Three cases, not two. Once the content has moved on, the reviewer's
    // intent in clicking is to sign off on what is now on screen -- treating
    // that as a withdrawal would delete the very thing they meant to renew.
    let approved: boolean;
    if (mine && mine.contentHash === hash) {
      await prisma.approval.delete({ where: { id: mine.id } });
      approved = false;
    } else if (mine) {
      await prisma.approval.update({
        where: { id: mine.id },
        data: { contentHash: hash, createdAt: new Date() },
      });
      approved = true;
    } else {
      await prisma.approval.create({
        data: { rowId, templateId, userId: access.user.id, contentHash: hash },
      });
      approved = true;
    }

    const approvals = await prisma.approval.findMany({
      where: { rowId, templateId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } } },
    });

    revalidatePath(`/c/${companyId}/preview`);
    return { ok: true, approved, approvals: presentApprovals(approvals, hash) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: "Could not record that." };
  }
}
