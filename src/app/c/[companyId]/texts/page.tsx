import { prisma } from "@/lib/db";
import { hasAtLeast } from "@/lib/auth";
import { guardCompany } from "@/lib/guard";
import { listTexts, smsConnected } from "@/lib/sms-core";
import { DEFAULT_TIMEZONE } from "@/lib/zone";
import { TextsBoard } from "./TextsBoard";

export const dynamic = "force-dynamic";

/**
 * Texts: write, preview, approve and push, in one place.
 *
 * Email needs three screens because a row and a template are chosen apart and
 * meet in the preview. A text has no template -- the row is the whole message
 * -- so the steps sit side by side here instead.
 */
export default async function TextsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [company, texts] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        emailProvider: true,
        espKeyCipher: true,
        espTimezone: true,
        smsProvider: true,
        smsKeyCipher: true,
        smsAudience: true,
        smsAudienceExclude: true,
        smsAddOptOut: true,
        attentiveSegments: true,
        attentiveSegmentsSyncedAt: true,
      },
    }),
    listTexts(companyId),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>SMS Preview</h1>
          <p>
            SMS and MMS campaigns. Add an image link to make a text an MMS. Edit, check the count,
            approve, and push from here.
          </p>
        </div>
      </div>
      <TextsBoard
        companyId={companyId}
        texts={texts}
        isAdmin={hasAtLeast(access.role, "admin")}
        userId={access.user.id}
        provider={company.smsProvider}
        connected={smsConnected(company)}
        addOptOut={company.smsAddOptOut}
        defaultAudience={company.smsAudience ?? ""}
        defaultExclude={company.smsAudienceExclude ?? ""}
        timezone={company.espTimezone || DEFAULT_TIMEZONE}
        attentiveSyncedAt={company.attentiveSegmentsSyncedAt?.toISOString() ?? null}
      />
    </main>
  );
}
