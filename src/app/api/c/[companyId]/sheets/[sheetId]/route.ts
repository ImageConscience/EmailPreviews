import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { parseRecord, parseStringArray } from "@/lib/json";
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
        rows: { orderBy: { position: "asc" }, take: ROW_LIMIT },
        _count: { select: { rows: true } },
      },
    });
    if (!sheet) return NextResponse.json({ error: "Sheet not found." }, { status: 404 });

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
        data: parseRecord(row.data),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
