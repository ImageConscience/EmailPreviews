import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret";
import { KlaviyoProvider } from "@/lib/esp/klaviyo";
import {
  EspError,
  isEmailProvider,
  type EmailProvider,
  type EmailProviderId,
  type EspRefs,
} from "@/lib/esp/types";

export * from "@/lib/esp/types";

/** Which platform a company sends through, falling back to the historic one. */
export async function providerIdFor(companyId: string): Promise<EmailProviderId> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { emailProvider: true },
  });
  const chosen = company?.emailProvider ?? "klaviyo";
  // A value this build does not know is treated as the default rather than
  // crashing a page: a column can hold a provider added by a newer deploy and
  // rolled back, and refusing to render the company at all is a worse answer.
  return isEmailProvider(chosen) ? chosen : "klaviyo";
}

/**
 * A company's sending platform, ready to use, or null when it has no key.
 *
 * The one place that turns stored settings into something that can be called.
 * No access check of its own -- every caller has already made one, and putting
 * a second here would only make it look as though callers without one were
 * safe.
 */
export async function providerFor(companyId: string): Promise<EmailProvider | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { emailProvider: true, espKeyCipher: true, klaviyoBaseTemplateId: true },
  });
  if (!company?.espKeyCipher) return null;

  const apiKey = decryptSecret(company.espKeyCipher);
  const id = isEmailProvider(company.emailProvider) ? company.emailProvider : "klaviyo";

  // Attentive is not reached from this app: its published API has no campaigns
  // (docs.attentive.com, read November 2026). Its email and texts are built by
  // a person's Claude session through Attentive's MCP server and recorded here
  // through this app's connector -- see src/lib/attentive-handoff.ts.
  if (id === "attentive") return null;
  return new KlaviyoProvider(apiKey, company.klaviyoBaseTemplateId);
}

/** A provider built from a key that is not stored yet, to check it before saving. */
export function providerFromKey(
  id: EmailProviderId,
  apiKey: string,
  baseTemplateId: string | null = null,
): EmailProvider {
  if (id === "attentive") {
    throw new EspError("Attentive takes no key in this app; it is reached through Claude.");
  }
  return new KlaviyoProvider(apiKey, baseTemplateId);
}

/** The stored handles for one push, as the provider expects them back. */
export function refsFrom(row: {
  campaignId: string;
  messageId: string;
  refs: string;
}): EspRefs {
  let extra: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.refs);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      extra = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }
  } catch {
    // A row written before this column existed, or by hand. An empty set of
    // extras makes the next push start a fresh campaign, which is recoverable;
    // throwing here would make the row unreadable instead.
  }
  return { campaignId: row.campaignId, messageId: row.messageId, extra };
}

/**
 * What a platform still needs from a company before a push can be attempted,
 * without reaching the network or building a provider.
 *
 * The eligibility gate runs for every row of every list, so it has to be a
 * plain function over settings already in hand. Each provider's `blockers()`
 * answers the same question once it has credentials; this answers it from the
 * company record, and the two must agree.
 */
export function setupBlockers(
  providerId: EmailProviderId,
  company: { klaviyoBaseTemplateId: string | null },
): string[] {
  if (providerId === "klaviyo" && !company.klaviyoBaseTemplateId) {
    return ["No Klaviyo base template is set."];
  }
  // Attentive needs nothing here: the HTML is handed to Claude, which builds the
  // campaign in Attentive itself.
  return [];
}
