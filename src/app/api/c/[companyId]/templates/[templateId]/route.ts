import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCompanyAccess } from "@/lib/auth";
import { parseStringArray } from "@/lib/json";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; templateId: string }> },
) {
  const { companyId, templateId } = await params;
  try {
    await requireCompanyAccess(companyId);
    const template = await prisma.template.findFirst({ where: { id: templateId, companyId } });
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });

    return NextResponse.json({
      id: template.id,
      name: template.name,
      html: template.html,
      placeholders: parseStringArray(template.placeholders),
    });
  } catch (error) {
    return apiError(error);
  }
}
