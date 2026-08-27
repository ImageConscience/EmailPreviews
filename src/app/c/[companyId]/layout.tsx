import { listCompaniesForUser } from "@/lib/auth";
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
  const companies = await listCompaniesForUser(access.user.id);

  return (
    <div className="shell">
      <TopBar
        companyId={access.companyId}
        companyName={access.companyName}
        userName={access.user.name ?? access.user.email}
        role={access.role}
        otherCompanies={companies.filter((c) => c.id !== companyId)}
      />
      {children}
    </div>
  );
}
