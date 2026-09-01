import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseRecord, parseStringArray } from "@/lib/json";
import {
  addRowAction,
  deleteRowAction,
  deleteSheetAction,
  duplicateRowAction,
} from "@/actions/content";
import { DangerButton } from "@/components/DangerButton";
import { SheetSettings } from "./SheetSettings";

export const dynamic = "force-dynamic";

const MAX_VISIBLE_ROWS = 200;

export default async function SheetPage({
  params,
}: {
  params: Promise<{ companyId: string; sheetId: string }>;
}) {
  const { companyId, sheetId } = await params;
  const access = await guardCompany(companyId);

  const sheet = await prisma.contentSheet.findFirst({
    where: { id: sheetId, companyId },
    include: {
      rows: { orderBy: { position: "asc" }, take: MAX_VISIBLE_ROWS },
      _count: { select: { rows: true } },
    },
  });
  if (!sheet) notFound();

  const columns = parseStringArray(sheet.columns);
  const hidden = sheet._count.rows - sheet.rows.length;

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>{sheet.name}</h1>
          <p>
            <Link href={`/c/${companyId}/sheets`}>← Back to content</Link> · {sheet._count.rows}{" "}
            {sheet._count.rows === 1 ? "row" : "rows"} · {columns.length} columns
          </p>
        </div>
        <div className="spacer" />
        {/* Plain links rather than buttons: these are downloads, and a link is
            the one control a browser already knows how to save a file from. */}
        <a
          href={`/api/c/${companyId}/sheets/${sheet.id}/export?format=xlsx`}
          className="btn"
          title="Every row and column, as a workbook that uploads straight back"
        >
          Export .xlsx
        </a>
        <a
          href={`/api/c/${companyId}/sheets/${sheet.id}/export?format=csv`}
          className="btn"
          title="Every row and column, as CSV"
        >
          Export .csv
        </a>
        <Link href={`/c/${companyId}/preview?sheet=${sheet.id}`} className="btn btn-primary">
          Open in preview
        </Link>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Rows</h2>
          <div className="spacer" />
          <form action={addRowAction.bind(null, companyId, sheet.id)}>
            <button type="submit" className="btn btn-sm">
              Add blank row
            </button>
          </form>
        </div>

        {sheet.rows.length === 0 ? (
          <div className="empty">
            <h3>No rows</h3>
            <p>Add a blank row, or upload a new sheet.</p>
          </div>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th className="tight">#</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  <th className="tight">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => {
                  const data = parseRecord(row.data);
                  return (
                    <tr key={row.id}>
                      <td className="tight hint">{row.position + 1}</td>
                      {columns.map((column) => (
                        <td key={column}>
                          <span className="truncate" title={data[column] ?? ""}>
                            {data[column] || <span className="hint">—</span>}
                          </span>
                        </td>
                      ))}
                      <td className="tight">
                        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          <Link
                            className="btn btn-sm"
                            href={`/c/${companyId}/preview?sheet=${sheet.id}&row=${row.id}`}
                          >
                            Preview
                          </Link>
                          <form action={duplicateRowAction.bind(null, companyId, row.id)}>
                            <button type="submit" className="btn btn-sm btn-ghost">
                              Duplicate
                            </button>
                          </form>
                          <form action={deleteRowAction.bind(null, companyId, row.id)}>
                            <DangerButton confirm="Delete this row? This cannot be undone.">
                              Delete
                            </DangerButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hidden > 0 && (
          <div className="card-head" style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }}>
            <span className="hint" style={{ marginTop: 0 }}>
              Showing the first {MAX_VISIBLE_ROWS} rows. All {sheet._count.rows} are available in
              the preview workspace.
            </span>
          </div>
        )}
      </div>

      <SheetSettings
        companyId={companyId}
        sheetId={sheet.id}
        name={sheet.name}
        columns={columns}
      />

      {access.role !== "member" && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 8 }}>Delete sheet</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Removes the sheet and all {sheet._count.rows} of its rows, including edit history.
          </p>
          <form action={deleteSheetAction.bind(null, companyId, sheet.id)}>
            <DangerButton confirm={`Delete "${sheet.name}" and all its rows? This cannot be undone.`}>
              Delete sheet
            </DangerButton>
          </form>
        </div>
      )}
    </main>
  );
}
