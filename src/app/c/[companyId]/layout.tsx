import { hasAtLeast, listCompaniesForUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);
  const [companies, company, textSheets] = await Promise.all([
    listCompaniesForUser(access.user.id),
    prisma.company.findUnique({ where: { id: companyId }, select: { espKeyCipher: true, smsProvider: true } }),
    prisma.contentSheet.count({ where: { companyId, kind: "sms" } }),
  ]);

  // The push tab is only meaningful to someone who could actually use it, and
  // showing it otherwise invites a click that ends in a 404 or an empty screen.
  const canPush = hasAtLeast(access.role, "admin") && Boolean(company?.espKeyCipher);
  // Texts appear once a company texts at all: a platform chosen, or a sheet of
  // them uploaded. Everyone sees it -- writing and approving texts is a
  // member's job; only the push buttons on it are admin-only.
  const hasTexts = Boolean(company?.smsProvider) || textSheets > 0;

  return (
    <div className="shell">
      <TopBar
        companyId={access.companyId}
        companyName={access.companyName}
        userName={access.user.name ?? access.user.email}
        role={access.role}
        canPush={canPush}
        hasTexts={hasTexts}
        otherCompanies={companies.filter((c) => c.id !== companyId)}
      />
      {children}
    </div>
  );
}
