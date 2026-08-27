import Link from "next/link";
import { guardCompany } from "@/lib/guard";
import { createTemplateAction } from "@/actions/content";
import { TemplateForm } from "../TemplateForm";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await guardCompany(companyId);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>New template</h1>
          <p>
            <Link href={`/c/${companyId}/templates`}>← Back to templates</Link>
          </p>
        </div>
      </div>
      <div className="card card-pad">
        <TemplateForm
          action={createTemplateAction.bind(null, companyId)}
          submitLabel="Create template"
        />
      </div>
    </main>
  );
}
