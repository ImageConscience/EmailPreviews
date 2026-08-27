import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { deleteTemplateAction, updateTemplateAction } from "@/actions/content";
import { TemplateForm } from "../TemplateForm";
import { DangerButton } from "@/components/DangerButton";

export const dynamic = "force-dynamic";

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ companyId: string; templateId: string }>;
}) {
  const { companyId, templateId } = await params;
  const access = await guardCompany(companyId);

  const template = await prisma.template.findFirst({ where: { id: templateId, companyId } });
  if (!template) notFound();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{template.name}</h1>
          <p>
            <Link href={`/c/${companyId}/templates`}>← Back to templates</Link>
          </p>
        </div>
        <div className="spacer" />
        <Link
          href={`/c/${companyId}/preview?template=${template.id}`}
          className="btn btn-primary"
        >
          Preview with content
        </Link>
      </div>

      <div className="card card-pad">
        <TemplateForm
          action={updateTemplateAction.bind(null, companyId, template.id)}
          defaults={{
            name: template.name,
            description: template.description ?? "",
            html: template.html,
          }}
          submitLabel="Save changes"
        />
      </div>

      {access.role !== "member" && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 8 }}>Delete template</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            This removes the template for everyone on {access.companyName}. Content sheets are
            not affected.
          </p>
          <form action={deleteTemplateAction.bind(null, companyId, template.id)}>
            <DangerButton confirm={`Delete "${template.name}"? This cannot be undone.`}>
              Delete template
            </DangerButton>
          </form>
        </div>
      )}
    </main>
  );
}
