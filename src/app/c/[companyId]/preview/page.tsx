import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseStringArray } from "@/lib/json";
import { PreviewWorkspace } from "./PreviewWorkspace";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ template?: string; sheet?: string; row?: string }>;
}) {
  const { companyId } = await params;
  const { template, sheet, row } = await searchParams;
  const access = await guardCompany(companyId);

  const [templates, sheets] = await Promise.all([
    prisma.template.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, placeholders: true },
    }),
    prisma.contentSheet.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { rows: true } } },
    }),
  ]);

  return (
    <PreviewWorkspace
      companyId={companyId}
      currentUserId={access.user.id}
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        placeholderCount: parseStringArray(t.placeholders).length,
      }))}
      sheets={sheets.map((s) => ({ id: s.id, name: s.name, rowCount: s._count.rows }))}
      initialTemplateId={template}
      initialSheetId={sheet}
      initialRowId={row}
    />
  );
}
