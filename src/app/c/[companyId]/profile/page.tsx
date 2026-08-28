import Link from "next/link";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CompanyProfile({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [templateCount, sheetCount, rowCount, memberCount, recentTemplates, recentSheets] =
    await Promise.all([
      prisma.template.count({ where: { companyId } }),
      prisma.contentSheet.count({ where: { companyId } }),
      prisma.sheetRow.count({ where: { sheet: { companyId } } }),
      prisma.membership.count({ where: { companyId } }),
      prisma.template.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, name: true },
      }),
      prisma.contentSheet.findMany({
        where: { companyId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, name: true, _count: { select: { rows: true } } },
      }),
    ]);

  const ready = templateCount > 0 && sheetCount > 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{access.companyName}</h1>
          <p>
            {templateCount} {templateCount === 1 ? "template" : "templates"} · {sheetCount}{" "}
            {sheetCount === 1 ? "sheet" : "sheets"} · {rowCount}{" "}
            {rowCount === 1 ? "row" : "rows"} · {memberCount}{" "}
            {memberCount === 1 ? "person" : "people"}
          </p>
        </div>
        <div className="spacer" />
        {ready && (
          <Link href={`/c/${companyId}/preview`} className="btn btn-primary">
            Open preview
          </Link>
        )}
      </div>

      {!ready && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <h2 style={{ marginBottom: 8 }}>Get set up</h2>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
            <li>
              <Link href={`/c/${companyId}/templates/new`}>Add an HTML template</Link> with{" "}
              <code>{"{{ placeholder }}"}</code> tokens where the copy and image URLs go.
              {templateCount > 0 && <span className="badge badge-ok" style={{ marginLeft: 6 }}>done</span>}
            </li>
            <li>
              <Link href={`/c/${companyId}/sheets`}>Upload a content sheet</Link> whose headers
              match those placeholder names.
              {sheetCount > 0 && <span className="badge badge-ok" style={{ marginLeft: 6 }}>done</span>}
            </li>
            <li>Open the preview, pick a row, and edit until it looks right.</li>
          </ol>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <div className="card-head">
            <h2>Templates</h2>
            <div className="spacer" />
            <Link href={`/c/${companyId}/templates`} className="btn btn-sm">
              All
            </Link>
          </div>
          {recentTemplates.length === 0 ? (
            <div className="empty">
              <p style={{ margin: 0 }}>Nothing yet.</p>
            </div>
          ) : (
            <table>
              <tbody>
                {recentTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <Link href={`/c/${companyId}/templates/${template.id}`}>{template.name}</Link>
                    </td>
                    <td className="tight">
                      <Link
                        href={`/c/${companyId}/preview?template=${template.id}`}
                        className="btn btn-sm btn-ghost"
                      >
                        Preview
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Content sheets</h2>
            <div className="spacer" />
            <Link href={`/c/${companyId}/sheets`} className="btn btn-sm">
              All
            </Link>
          </div>
          {recentSheets.length === 0 ? (
            <div className="empty">
              <p style={{ margin: 0 }}>Nothing yet.</p>
            </div>
          ) : (
            <table>
              <tbody>
                {recentSheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>
                      <Link href={`/c/${companyId}/sheets/${sheet.id}`}>{sheet.name}</Link>
                      <span className="hint">{sheet._count.rows} rows</span>
                    </td>
                    <td className="tight">
                      <Link
                        href={`/c/${companyId}/preview?sheet=${sheet.id}`}
                        className="btn btn-sm btn-ghost"
                      >
                        Preview
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
