import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { parseRecord, parseStringArray } from "@/lib/json";
import { apiError } from "@/lib/api";
import {
  type ExportRow,
  exportColumns,
  exportFilename,
  toCsv,
  toXlsx,
} from "@/lib/sheet-export";

export const dynamic = "force-dynamic";

/**
 * The whole sheet, as a file that can be uploaded straight back.
 *
 * Every row, not a page of them: the listing endpoint caps its payload because
 * it feeds a workspace that only shows so much at once, but an export that
 * quietly stops at row 1000 is a data-loss bug wearing a download's clothes.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string; sheetId: string }> },
) {
  const { companyId, sheetId } = await params;
  try {
    await requireCompanyAccess(companyId);

    const sheet = await prisma.contentSheet.findFirst({
      where: { id: sheetId, companyId },
      include: { rows: { orderBy: { position: "asc" } } },
    });
    if (!sheet) return Response.json({ error: "Sheet not found." }, { status: 404 });

    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const rows: ExportRow[] = sheet.rows.map((row) => ({
      data: parseRecord(row.data),
      hidden: row.hiddenAt !== null,
    }));
    const columns = exportColumns(parseStringArray(sheet.columns), rows);
    const filename = exportFilename(sheet.name, format);

    const body = format === "csv" ? Buffer.from(toCsv(columns, rows), "utf8") : await toXlsx(sheet.name, columns, rows);
    const type =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
