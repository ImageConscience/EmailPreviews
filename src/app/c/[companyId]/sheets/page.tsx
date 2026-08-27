import Link from "next/link";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseStringArray } from "@/lib/json";
import { UploadSheetForm } from "./UploadSheetForm";

export const dynamic = "force-dynamic";

export default async function SheetsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await guardCompany(companyId);

  const sheets = await prisma.contentSheet.findMany({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rows: true } } },
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Content</h1>
          <p>
            Spreadsheets become records in the app on upload. Column headers are matched to
            template placeholders.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 12 }}>Upload a sheet</h2>
        <UploadSheetForm companyId={companyId} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>Sheets</h2>
        </div>
        {sheets.length === 0 ? (
          <div className="empty">
            <h3>Nothing uploaded yet</h3>
            <p>Upload a .csv or .xlsx whose first row is the header.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="tight">Rows</th>
                <th>Columns</th>
                <th className="tight">Updated</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet) => {
                const columns = parseStringArray(sheet.columns);
                return (
                  <tr key={sheet.id}>
                    <td>
                      <Link href={`/c/${companyId}/sheets/${sheet.id}`} style={{ fontWeight: 600 }}>
                        {sheet.name}
                      </Link>
                      {sheet.sourceFilename && (
                        <span className="hint truncate">from {sheet.sourceFilename}</span>
                      )}
                    </td>
                    <td className="tight">{sheet._count.rows}</td>
                    <td>
                      <div className="chiplist">
                        {columns.slice(0, 5).map((c) => (
                          <span key={c} className="chip">
                            {c}
                          </span>
                        ))}
                        {columns.length > 5 && (
                          <span className="chip">+{columns.length - 5} more</span>
                        )}
                      </div>
                    </td>
                    <td className="tight hint">{sheet.updatedAt.toISOString().slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
