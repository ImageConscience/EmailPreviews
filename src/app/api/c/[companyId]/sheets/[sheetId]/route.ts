import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { parseRecord, parseStringArray } from "@/lib/json";
import { presentApprovals } from "@/lib/approval";
import { approvalFingerprint } from "@/lib/fingerprint";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Content sheets are campaign-sized, but cap the payload so one huge import
 *  cannot stall the workspace. */
const ROW_LIMIT = 1000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; sheetId: string }> },
) {
  const { companyId, sheetId } = await params;
  try {
    await requireCompanyAccess(companyId);
    const sheet = await prisma.contentSheet.findFirst({
      where: { id: sheetId, companyId },
      include: {
        rows: {
          orderBy: { position: "asc" },
          take: ROW_LIMIT,
          include: {
            hiddenBy: { select: { name: true, email: true } },
            // Just the number: the thread itself is fetched when someone opens
            // it, but the button has to be able to say whether there is one.
            _count: { select: { notes: true } },
            approvals: {
              orderBy: { createdAt: "asc" },
              include: { user: { select: { name: true, email: true } } },
            },
          },
        },
        _count: { select: { rows: true } },
      },
    });
    if (!sheet) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

    // An approval is only current while the row and the template it was given
    // against are both unchanged, so staleness is worked out per pair here
    // rather than trusted from what was stored.
    const templates = await prisma.template.findMany({
      where: { companyId },
      select: { id: true, updatedAt: true },
    });
    const templateUpdatedAt = new Map(templates.map((t) => [t.id, t.updatedAt]));

    return NextResponse.json({
      id: sheet.id,
      name: sheet.name,
      columns: parseStringArray(sheet.columns),
      totalRows: sheet._count.rows,
      truncated: sheet._count.rows > sheet.rows.length,
      rows: sheet.rows.map((row) => ({
        id: row.id,
        position: row.position,
        updatedAt: row.updatedAt.toISOString(),
        hiddenAt: row.hiddenAt?.toISOString() ?? null,
        hiddenBy: row.hiddenBy?.name ?? row.hiddenBy?.email ?? null,
        noteCount: row._count.notes,
        data: parseRecord(row.data),
        approvals: row.approvals.map((approval) => {
          const updatedAt = templateUpdatedAt.get(approval.templateId);
          const currentHash = updatedAt
            ? approvalFingerprint(row.data, approval.templateId, updatedAt)
            : "";
          return {
            templateId: approval.templateId,
            ...presentApprovals([approval], currentHash)[0],
          };
        }),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
