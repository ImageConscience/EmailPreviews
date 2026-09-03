"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { decryptSecret, encryptSecret, SecretError, secretHint, secretsAvailable } from "@/lib/secret";
import { fetchAccount, fetchAudiences, KlaviyoError, type Audience } from "@/lib/klaviyo";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/zone";

export interface KlaviyoResult {
  ok: boolean;
  error?: string;
  /** Named so someone can check they connected the client they meant to. */
  accountName?: string;
}

/**
 * The key for a company, decrypted.
 *
 * Everything that talks to Klaviyo goes through here, so there is one place
 * that knows a company might not be connected and one place that turns a stored
 * cipher back into a credential.
 */
export async function klaviyoKeyFor(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { klaviyoKeyCipher: true },
  });
  if (!company?.klaviyoKeyCipher) return null;
  return decryptSecret(company.klaviyoKeyCipher);
}

function failure(error: unknown): KlaviyoResult {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof SecretError) return { ok: false, error: error.message };
  if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
  if (error instanceof Error && error.name === "TimeoutError") {
    return { ok: false, error: "Klaviyo did not answer within 30 seconds." };
  }
  return { ok: false, error: "Could not reach Klaviyo." };
}

/**
 * Store a key, having first asked Klaviyo whose it is.
 *
 * The order matters: the key is verified before it is written, so a company
 * never ends up holding a credential that does not work, and the account name
 * that comes back is stored alongside it. Admin and above, because this is the
 * credential that lets the app mail a client's customers.
 */
export async function connectKlaviyoAction(
  companyId: string,
  apiKey: string,
): Promise<KlaviyoResult> {
  try {
    await requireCompanyAccess(companyId, "admin");

    const key = apiKey.trim();
    if (!key) return { ok: false, error: "Paste a private API key." };
    if (!key.startsWith("pk_")) {
      // Public keys are six characters and belong in a browser; a private key
      // is the only kind that can do any of this, and confusing the two is the
      // most likely way to get a baffling 401.
      return {
        ok: false,
        error: "That does not look like a private key. Private keys begin with `pk_`.",
      };
    }
    if (!secretsAvailable()) {
      return {
        ok: false,
        error:
          "ENCRYPTION_KEY is not set on this deployment, so an API key cannot be stored safely. " +
          "Set it and try again.",
      };
    }

    const account = await fetchAccount(key);

    await prisma.company.update({
      where: { id: companyId },
      data: {
        klaviyoKeyCipher: encryptSecret(key),
        klaviyoKeyHint: secretHint(key),
        klaviyoAccountName: account.name,
        klaviyoAccountId: account.publicId,
        klaviyoLinkedAt: new Date(),
        // Klaviyo knows the account's own zone; it is the best first guess at
        // what the sheet's send times mean, and still editable.
        klaviyoTimezone:
          account.timezone && TIMEZONES.includes(account.timezone) ? account.timezone : DEFAULT_TIMEZONE,
      },
    });

    revalidatePath(`/c/${companyId}/integrations`);
    return { ok: true, accountName: account.name };
  } catch (error) {
    return failure(error);
  }
}

/** Forget the key. The campaigns it made in Klaviyo are left alone. */
export async function disconnectKlaviyoAction(companyId: string): Promise<KlaviyoResult> {
  try {
    await requireCompanyAccess(companyId, "admin");
    await prisma.company.update({
      where: { id: companyId },
      data: {
        klaviyoKeyCipher: null,
        klaviyoKeyHint: null,
        klaviyoAccountName: null,
        klaviyoAccountId: null,
        klaviyoLinkedAt: null,
      },
    });
    revalidatePath(`/c/${companyId}/integrations`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** The sender details every campaign this company pushes will carry. */
export async function saveKlaviyoSettingsAction(
  companyId: string,
  settings: {
    fromEmail: string;
    fromLabel: string;
    replyTo: string;
    timezone: string;
    baseTemplateId: string;
    audience: string;
    audienceExclude: string;
  },
): Promise<KlaviyoResult> {
  try {
    await requireCompanyAccess(companyId, "admin");

    const fromEmail = settings.fromEmail.trim();
    if (fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) {
      return { ok: false, error: "That from-address does not look like an email address." };
    }
    const replyTo = settings.replyTo.trim();
    if (replyTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) {
      return { ok: false, error: "That reply-to address does not look like an email address." };
    }

    await prisma.company.update({
      where: { id: companyId },
      data: {
        klaviyoFromEmail: fromEmail || null,
        klaviyoFromLabel: settings.fromLabel.trim() || null,
        klaviyoReplyTo: replyTo || null,
        klaviyoTimezone: TIMEZONES.includes(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE,
        klaviyoBaseTemplateId: settings.baseTemplateId.trim() || null,
        klaviyoAudience: settings.audience.trim() || null,
        klaviyoAudienceExclude: settings.audienceExclude.trim() || null,
      },
    });

    revalidatePath(`/c/${companyId}/integrations`);
    // The default audience decides what the push queue will offer, so that
    // screen's answer changes with it.
    revalidatePath(`/c/${companyId}/push`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export interface AudienceList {
  ok: boolean;
  error?: string;
  audiences?: Audience[];
}

/**
 * Every list and segment on the connected account.
 *
 * Read on demand rather than cached: an audience added in Klaviyo this morning
 * should be nameable in a sheet this afternoon, and the list is small enough
 * that fetching it is cheaper than reasoning about when a cache is stale.
 */
export async function listKlaviyoAudiencesAction(companyId: string): Promise<AudienceList> {
  try {
    await requireCompanyAccess(companyId);
    const key = await klaviyoKeyFor(companyId);
    if (!key) return { ok: false, error: "This company is not connected to Klaviyo." };

    const audiences = await fetchAudiences(key);
    return { ok: true, audiences: audiences.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (error) {
    return failure(error);
  }
}
