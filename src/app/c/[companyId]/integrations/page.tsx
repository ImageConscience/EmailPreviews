import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { KlaviyoPanel } from "./KlaviyoPanel";
import { secretsAvailable } from "@/lib/secret";
import { DEFAULT_TIMEZONE } from "@/lib/zone";

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
      select: {
        shopDomain: true,
        catalogSyncedAt: true,
        klaviyoKeyCipher: true,
        klaviyoKeyHint: true,
        klaviyoAccountName: true,
        klaviyoAccountId: true,
        klaviyoLinkedAt: true,
        klaviyoFromEmail: true,
        klaviyoFromLabel: true,
        klaviyoReplyTo: true,
        klaviyoTimezone: true,
        klaviyoBaseTemplateId: true,
        klaviyoAudience: true,
        klaviyoAudienceExclude: true,
      },
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
          <p>Where this company&rsquo;s products come from, and where its emails go.</p>
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

      <KlaviyoPanel
        companyId={companyId}
        canEdit={access.role !== "member"}
        state={{
          // Whether a key is held, never the key: the cipher is read here only
          // to answer yes or no, and nothing derived from it reaches the browser.
          connected: Boolean(company?.klaviyoKeyCipher),
          keyHint: company?.klaviyoKeyHint ?? null,
          accountName: company?.klaviyoAccountName ?? null,
          accountId: company?.klaviyoAccountId ?? null,
          linkedAt: company?.klaviyoLinkedAt?.toISOString() ?? null,
          fromEmail: company?.klaviyoFromEmail ?? "",
          fromLabel: company?.klaviyoFromLabel ?? "",
          replyTo: company?.klaviyoReplyTo ?? "",
          timezone: company?.klaviyoTimezone ?? DEFAULT_TIMEZONE,
          baseTemplateId: company?.klaviyoBaseTemplateId ?? "",
          audience: company?.klaviyoAudience ?? "",
          audienceExclude: company?.klaviyoAudienceExclude ?? "",
          canStoreSecrets: secretsAvailable(),
        }}
      />
    </main>
  );
}
