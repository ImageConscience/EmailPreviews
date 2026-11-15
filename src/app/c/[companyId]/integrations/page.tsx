import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { SendingPanel } from "./SendingPanel";
import { TextingPanel } from "./TextingPanel";
import { isEmailProvider } from "@/lib/esp/types";
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
        emailProvider: true,
        espKeyCipher: true,
        espKeyHint: true,
        espAccountName: true,
        espAccountId: true,
        espLinkedAt: true,
        espFromEmail: true,
        espFromLabel: true,
        espReplyTo: true,
        espTimezone: true,
        klaviyoBaseTemplateId: true,
        espAudience: true,
        espAudienceExclude: true,
        smsProvider: true,
        smsKeyCipher: true,
        smsKeyHint: true,
        smsAccountName: true,
        smsAudience: true,
        smsAudienceExclude: true,
        smsAddOptOut: true,
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
          <p>Where this company&rsquo;s products come from, and where its emails and texts go.</p>
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

      <SendingPanel
        companyId={companyId}
        canEdit={access.role !== "member"}
        state={{
          provider:
            company && isEmailProvider(company.emailProvider) ? company.emailProvider : "klaviyo",
          // Whether a key is held, never the key: the cipher is read here only
          // to answer yes or no, and nothing derived from it reaches the browser.
          // Attentive holds no key, so choosing it is the connection.
          connected: company?.emailProvider === "attentive" || Boolean(company?.espKeyCipher),
          keyHint: company?.espKeyHint ?? null,
          accountName: company?.espAccountName ?? null,
          accountId: company?.espAccountId ?? null,
          linkedAt: company?.espLinkedAt?.toISOString() ?? null,
          fromEmail: company?.espFromEmail ?? "",
          fromLabel: company?.espFromLabel ?? "",
          replyTo: company?.espReplyTo ?? "",
          timezone: company?.espTimezone ?? DEFAULT_TIMEZONE,
          baseTemplateId: company?.klaviyoBaseTemplateId ?? "",
          audience: company?.espAudience ?? "",
          audienceExclude: company?.espAudienceExclude ?? "",
          canStoreSecrets: secretsAvailable(),
        }}
      />

      <TextingPanel
        companyId={companyId}
        canEdit={access.role !== "member"}
        state={{
          provider: company?.smsProvider ?? null,
          audience: company?.smsAudience ?? "",
          exclude: company?.smsAudienceExclude ?? "",
          addOptOut: company?.smsAddOptOut ?? true,
          // Yes or no again, never the key itself.
          ownKey: Boolean(company?.smsKeyCipher),
          ownKeyHint: company?.smsKeyHint ?? null,
          ownAccountName: company?.smsAccountName ?? null,
          emailKlaviyoKey: company?.emailProvider === "klaviyo" && Boolean(company?.espKeyCipher),
          emailAccountName: company?.espAccountName ?? null,
          canStoreSecrets: secretsAvailable(),
        }}
      />
    </main>
  );
}
