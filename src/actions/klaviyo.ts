"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { decryptSecret, encryptSecret, SecretError, secretHint, secretsAvailable } from "@/lib/secret";
import { CANDIDATE_REVISIONS, fetchAccount, fetchAudiences, fetchTemplate, KlaviyoError,
  revision, type Audience, type TemplateDetail } from "@/lib/klaviyo";
import { CONTENT_MARKER, findContentBlock } from "@/lib/block-content";
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

export interface BaseTemplateReport {
  ok: boolean;
  error?: string;
  /** The API revision the check was made with, since that is what usually bites. */
  revision: string;
  /** Set when the configured revision failed and another one worked. */
  worksAt?: string;
  name?: string;
  editorType?: string;
  /** How many HTML blocks the template has, and whether ours was identifiable. */
  htmlBlocks?: number;
  marked?: boolean;
  note?: string;
}

/**
 * Ask Klaviyo for the base template and say what came back.
 *
 * Everything this reports, a push already knows -- and reported by dying
 * half-way through with one sentence from Klaviyo. That made every question
 * about the setup cost a deploy and a real push against a client's account.
 * This answers the same question in a second, and names the API revision it
 * used, because a template that reads fine at one revision and not at another
 * is the failure that has actually happened.
 */
export async function checkBaseTemplateAction(companyId: string): Promise<BaseTemplateReport> {
  const used = revision();
  try {
    await requireCompanyAccess(companyId, "admin");
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { klaviyoBaseTemplateId: true },
    });
    const id = company?.klaviyoBaseTemplateId?.trim();
    if (!id) return { ok: false, revision: used, error: "No base template ID is set." };

    const key = await klaviyoKeyFor(companyId);
    if (!key) return { ok: false, revision: used, error: "This company is not connected to Klaviyo." };

    // If the configured revision cannot read a definition, find out which can
    // rather than reporting a dead end. It is the question the error raises,
    // and answering it is four reads of one template.
    let template: TemplateDetail;
    let worksAt: string | undefined;
    try {
      template = await fetchTemplate(key, id);
    } catch (error) {
      if (!(error instanceof KlaviyoError) || !/additional-fields/.test(error.detail)) throw error;
      let rescued: TemplateDetail | null = null;
      for (const candidate of CANDIDATE_REVISIONS) {
        if (candidate === used) continue;
        try {
          rescued = await fetchTemplate(key, id, candidate);
          if (rescued.definition) {
            worksAt = candidate;
            break;
          }
          rescued = null;
        } catch {
          // That revision will not do it either; try the next.
        }
      }
      if (!rescued || !worksAt) {
        return { ok: false, revision: used, error: error.detail };
      }
      template = rescued;
    }
    if (!template.definition) {
      return {
        ok: false,
        revision: used,
        name: template.name,
        editorType: template.editorType,
        error:
          `“${template.name}” is a ${template.editorType} template, which has no blocks to fill. ` +
          "The base template has to be a drag-and-drop one.",
      };
    }

    // Count the HTML blocks the same way the push finds them, so this reports
    // what the push will actually do rather than something adjacent to it.
    let htmlBlocks = 0;
    JSON.stringify(template.definition, (_key, value) => {
      if (value && typeof value === "object" && (value as { type?: string }).type === "html") {
        htmlBlocks += 1;
      }
      return value;
    });

    const found = findContentBlock(template.definition);
    if ("error" in found) {
      return {
        ok: false, revision: used, name: template.name, editorType: template.editorType,
        htmlBlocks, marked: false, error: found.error,
      };
    }

    const marked = JSON.stringify(found.block).includes(CONTENT_MARKER);
    return {
      ok: true, revision: used, name: template.name, editorType: template.editorType,
      htmlBlocks, marked, worksAt,
      note: marked
        ? "The marked block is the one that will be filled."
        : "No marker, but there is only one HTML block, so that is the one that will be filled.",
    };
  } catch (error) {
    const failed = failure(error);
    return { ok: false, revision: used, error: failed.error };
  }
}
