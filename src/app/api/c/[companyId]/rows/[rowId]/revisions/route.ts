import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { parseRecord } from "@/lib/json";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; rowId: string }> },
) {
  const { companyId, rowId } = await params;
  try {
    await requireCompanyAccess(companyId);
    const revisions = await prisma.rowRevision.findMany({
      where: { rowId, row: { sheet: { companyId } } },
      orderBy: { changedAt: "desc" },
      take: 30,
      include: { changedBy: { select: { name: true, email: true } } },
    });

    return NextResponse.json({
      revisions: revisions.map((revision) => ({
        id: revision.id,
        changedAt: revision.changedAt.toISOString(),
        note: revision.note,
        by: revision.changedBy?.name ?? revision.changedBy?.email ?? "Unknown",
        data: parseRecord(revision.data),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
