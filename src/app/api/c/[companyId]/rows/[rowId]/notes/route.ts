import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { presentNotes } from "@/lib/note";

export const dynamic = "force-dynamic";

/**
 * The note thread for one row, oldest first.
 *
 * Fetched on demand rather than carried in the sheet payload: most rows have
 * no notes, and the ones that do are only read when someone opens the flyout.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; rowId: string }> },
) {
  const { companyId, rowId } = await params;
  try {
    const access = await requireCompanyAccess(companyId);

    const row = await prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { id: true },
    });
    if (!row) return NextResponse.json({ error: "Row not found." }, { status: 404 });

    const notes = await prisma.rowNote.findMany({
      where: { rowId: row.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } } },
    });

    return NextResponse.json({ notes: presentNotes(notes, access.user.id) });
  } catch (error) {
    return apiError(error);
  }
}
