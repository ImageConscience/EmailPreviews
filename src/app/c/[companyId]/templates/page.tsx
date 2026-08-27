import Link from "next/link";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseStringArray } from "@/lib/json";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await guardCompany(companyId);

  const templates = await prisma.template.findMany({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>HTML emails with {"{{ placeholder }}"} tokens that content rows fill in.</p>
        </div>
        <div className="spacer" />
        <Link href={`/c/${companyId}/templates/new`} className="btn btn-primary">
          New template
        </Link>
      </div>

      <div className="card">
        {templates.length === 0 ? (
          <div className="empty">
            <h3>No templates yet</h3>
            <p>
              Paste an HTML email and mark the variable bits as{" "}
              <code>{"{{ placeholder_name }}"}</code>.
            </p>
            <Link href={`/c/${companyId}/templates/new`} className="btn btn-primary">
              Add your first template
            </Link>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Placeholders</th>
                <th className="tight">Updated</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const placeholders = parseStringArray(template.placeholders);
                return (
                  <tr key={template.id}>
                    <td>
                      <Link
                        href={`/c/${companyId}/templates/${template.id}`}
                        style={{ fontWeight: 600 }}
                      >
                        {template.name}
                      </Link>
                      {template.description && (
                        <span className="hint truncate">{template.description}</span>
                      )}
                    </td>
                    <td>
                      <div className="chiplist">
                        {placeholders.slice(0, 6).map((p) => (
                          <span key={p} className="chip">
                            {p}
                          </span>
                        ))}
                        {placeholders.length > 6 && (
                          <span className="chip">+{placeholders.length - 6} more</span>
                        )}
                        {placeholders.length === 0 && <span className="hint">none found</span>}
                      </div>
                    </td>
                    <td className="tight hint">
                      {template.updatedAt.toISOString().slice(0, 10)}
                    </td>
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
