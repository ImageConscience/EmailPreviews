import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { IntegrationsPanel } from "./IntegrationsPanel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [company, productCount, sample] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { shopDomain: true, catalogSyncedAt: true },
    }),
    prisma.catalogProduct.count({ where: { companyId } }),
    prisma.catalogProduct.findMany({
      where: { companyId },
      orderBy: { title: "asc" },
      take: 6,
      select: { id: true, title: true, price: true, imageUrl: true, available: true },
    }),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p>Where this company&rsquo;s products come from.</p>
        </div>
      </div>

      <IntegrationsPanel
        companyId={companyId}
        canEdit={access.role !== "member"}
        domain={company?.shopDomain ?? ""}
        syncedAt={company?.catalogSyncedAt?.toISOString() ?? null}
        productCount={productCount}
        sample={sample}
      />
    </main>
  );
}
