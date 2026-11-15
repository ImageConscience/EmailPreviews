"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { decryptSecret, encryptSecret, SecretError, secretHint, secretsAvailable } from "@/lib/secret";
import {
  isEmailProvider,
  providerFor,
  providerFromKey,
  providerIdFor,
  EspError,
  PROVIDER_LABELS,
  type EmailProviderId,
  type EspAudience,
} from "@/lib/esp";
import { CANDIDATE_REVISIONS, fetchTemplate, KlaviyoError, revision,
  type TemplateDetail } from "@/lib/klaviyo";
import { CONTENT_MARKER, findContentBlock } from "@/lib/block-content";
import { DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/zone";
import { cachedAttentiveSegments } from "@/lib/sms-core";

/**
 * Connecting a company to its sending platform, and reading from it.
 *
 * The other half of the push: everything here is the setup and the lookups,
 * where the push itself is the write. Both go through the same provider
 * interface, so the choice a company makes on this screen is the choice that
 * governs every call made on its behalf.
 *
 * Email only. When SMS arrives it gets its own column, its own selector and its
 * own actions beside these, because a company may well text through one
 * platform and mail through another.
 */

export interface EspResult {
  ok: boolean;
  error?: string;
  /** Named so someone can check they connected the client they meant to. */
  accountName?: string;
}

/** The key for a company, decrypted, or null when it is not connected. */
async function keyFor(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { espKeyCipher: true },
  });
  if (!company?.espKeyCipher) return null;
  return decryptSecret(company.espKeyCipher);
}

/**
 * Turn whatever went wrong into one sentence, named after the platform.
 *
 * The label is passed in rather than looked up, because half these failures
 * happen before there is a company record to look it up from.
 */
function failure(error: unknown, label = "the sending platform"): EspResult {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof SecretError) return { ok: false, error: error.message };
  if (error instanceof EspError) return { ok: false, error: error.message };
  if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
  if (error instanceof Error && error.name === "TimeoutError") {
    return { ok: false, error: `${label} did not answer within 30 seconds.` };
  }
  return { ok: false, error: `Could not reach ${label}.` };
}

/**
 * What a key has to look like before it is worth spending a round trip on.
 *
 * Klaviyo's public keys are six characters and belong in a browser; a private
 * key is the only kind that can do any of this, and confusing the two is the
 * most likely way to get a baffling 401. Attentive's private app keys carry no
 * prefix worth asserting, so nothing is claimed about them -- a wrong one fails
 * the account read below, which is a true answer rather than a guessed one.
 */
function keyComplaint(provider: EmailProviderId, key: string): string | null {
  if (provider === "klaviyo" && !key.startsWith("pk_")) {
    return "That does not look like a private key. Klaviyo private keys begin with `pk_`.";
  }
  return null;
}

/**
 * Which platform this company sends through.
 *
 * Changing it clears the stored key, because a Klaviyo key is not an Attentive
 * one: keeping it would leave the company looking connected while every call
 * made on its behalf went to the wrong place with the wrong credential. Pushes
 * already made are left alone -- they record which platform made them and are
 * read back against that.
 */
export async function setEmailProviderAction(
  companyId: string,
  provider: string,
): Promise<EspResult> {
  try {
    await requireCompanyAccess(companyId, "admin");
    if (!isEmailProvider(provider)) {
      return { ok: false, error: "That is not a sending platform this app knows." };
    }

    const current = await providerIdFor(companyId);
    if (current === provider) return { ok: true };

    await prisma.company.update({
      where: { id: companyId },
      data: {
        emailProvider: provider,
        espKeyCipher: null,
        espKeyHint: null,
        espAccountName: null,
        espAccountId: null,
        espLinkedAt: null,
      },
    });

    revalidatePath(`/c/${companyId}/integrations`);
    revalidatePath(`/c/${companyId}/push`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Store a key, having first asked the platform whose it is.
 *
 * The order matters: the key is verified before it is written, so a company
 * never ends up holding a credential that does not work, and the account name
 * that comes back is stored alongside it. Admin and above, because this is the
 * credential that lets the app mail a client's customers.
 */
export async function connectProviderAction(
  companyId: string,
  provider: string,
  apiKey: string,
): Promise<EspResult> {
  if (!isEmailProvider(provider)) {
    return { ok: false, error: "That is not a sending platform this app knows." };
  }
  const label = PROVIDER_LABELS[provider];
  try {
    await requireCompanyAccess(companyId, "admin");
    if (provider === "attentive") {
      return {
        ok: false,
        error:
          "Attentive takes no key here. Choose Attentive and the approved emails are handed off " +
          "through Claude and Attentive's own connector.",
      };
    }

    const key = apiKey.trim();
    if (!key) return { ok: false, error: `Paste a private key from ${label}.` };
    const complaint = keyComplaint(provider, key);
    if (complaint) return { ok: false, error: complaint };
    if (!secretsAvailable()) {
      return {
        ok: false,
        error:
          "ENCRYPTION_KEY is not set on this deployment, so an API key cannot be stored safely. " +
          "Set it and try again.",
      };
    }

    // The base template is Klaviyo's and stays put across a reconnect, so the
    // provider built here is given it: otherwise connecting would report a
    // blocker the company has in fact already settled.
    const held = await prisma.company.findUnique({
      where: { id: companyId },
      select: { klaviyoBaseTemplateId: true },
    });
    const account = await providerFromKey(provider, key, held?.klaviyoBaseTemplateId ?? null).account();

    await prisma.company.update({
      where: { id: companyId },
      data: {
        emailProvider: provider,
        espKeyCipher: encryptSecret(key),
        espKeyHint: secretHint(key),
        espAccountName: account.name,
        espAccountId: account.id,
        espLinkedAt: new Date(),
        // The platform knows the account's own zone; it is the best first guess
        // at what the sheet's send times mean, and still editable.
        espTimezone:
          account.timezone && TIMEZONES.includes(account.timezone)
            ? account.timezone
            : DEFAULT_TIMEZONE,
      },
    });

    revalidatePath(`/c/${companyId}/integrations`);
    revalidatePath(`/c/${companyId}/push`);
    return { ok: true, accountName: account.name };
  } catch (error) {
    return failure(error, label);
  }
}

/** Forget the key. The campaigns it already made are left alone. */
export async function disconnectProviderAction(companyId: string): Promise<EspResult> {
  try {
    await requireCompanyAccess(companyId, "admin");
    await prisma.company.update({
      where: { id: companyId },
      data: {
        espKeyCipher: null,
        espKeyHint: null,
        espAccountName: null,
        espAccountId: null,
        espLinkedAt: null,
      },
    });
    revalidatePath(`/c/${companyId}/integrations`);
    revalidatePath(`/c/${companyId}/push`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** The sender details every campaign this company pushes will carry. */
export async function saveSendingSettingsAction(
  companyId: string,
  settings: {
    fromEmail: string;
    fromLabel: string;
    replyTo: string;
    timezone: string;
    /** Klaviyo's base template. Ignored by platforms that take the HTML. */
    baseTemplateId: string;
    audience: string;
    audienceExclude: string;
  },
): Promise<EspResult> {
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
        espFromEmail: fromEmail || null,
        espFromLabel: settings.fromLabel.trim() || null,
        espReplyTo: replyTo || null,
        espTimezone: TIMEZONES.includes(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE,
        klaviyoBaseTemplateId: settings.baseTemplateId.trim() || null,
        espAudience: settings.audience.trim() || null,
        espAudienceExclude: settings.audienceExclude.trim() || null,
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
  audiences?: EspAudience[];
  /**
   * The platform these came from, by name.
   *
   * Returned rather than looked up in the browser so the pickers can say which
   * platform they are reading without a second round trip or a prop threaded
   * through every screen that holds one.
   */
  provider: string;
}

/**
 * Every audience on the connected account, whichever platform it is.
 *
 * Read on demand rather than cached: a segment added this morning should be
 * nameable in a sheet this afternoon, and the list is small enough that
 * fetching it is cheaper than reasoning about when a cache is stale.
 */
export async function listAudiencesAction(companyId: string): Promise<AudienceList> {
  const providerId = await providerIdFor(companyId);
  const label = PROVIDER_LABELS[providerId];
  try {
    await requireCompanyAccess(companyId);
    if (providerId === "attentive") {
      // The copy a Claude session saved through the connector; this app holds
      // no Attentive key to ask with.
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { attentiveSegments: true },
      });
      const audiences = cachedAttentiveSegments(company?.attentiveSegments ?? null);
      if (audiences.length === 0) {
        return {
          ok: false,
          provider: label,
          error: "No Attentive segments are saved yet. Ask Claude to sync them into Message Baker.",
        };
      }
      return { ok: true, provider: label, audiences: audiences.sort((a, b) => a.name.localeCompare(b.name)) };
    }
    const provider = await providerFor(companyId);
    if (!provider) {
      return { ok: false, provider: label, error: `This company is not connected to ${label}.` };
    }

    const audiences = await provider.audiences();
    return {
      ok: true,
      provider: label,
      audiences: audiences.sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (error) {
    return { ...failure(error, label), provider: label };
  }
}

export interface BaseTemplateReport {
  ok: boolean;
  error?: string;
  /** The API revision the check was made with, since that is what usually bites. */
  revision: string;
  /** Set when the configured revision failed and another one worked. */
  worksAt?: string;
  /** Which way of asking produced the definition. */
  readBy?: string;
  /** Every revision the search tried, and what came of it. */
  tried?: { revision: string; answeredAs?: string | null; result: string }[];
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
 * Klaviyo-only, and unapologetically so: it reports on the template clone that
 * only Klaviyo needs, in Klaviyo's own terms, down to the API revision. A
 * platform that takes the HTML has nothing for this to check, which is why it
 * lives here rather than behind a method every provider would have to answer.
 *
 * Everything it reports, a push already knows -- and reported by dying half-way
 * through with one sentence from Klaviyo. That made every question about the
 * setup cost a deploy and a real push against a client's account. This answers
 * the same question in a second.
 */
export async function checkBaseTemplateAction(companyId: string): Promise<BaseTemplateReport> {
  const used = revision();
  try {
    await requireCompanyAccess(companyId, "admin");

    const provider = await providerIdFor(companyId);
    if (provider !== "klaviyo") {
      return {
        ok: false,
        revision: used,
        error: `${PROVIDER_LABELS[provider]} takes the email as HTML, so there is no base template to check.`,
      };
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { klaviyoBaseTemplateId: true },
    });
    const id = company?.klaviyoBaseTemplateId?.trim();
    if (!id) return { ok: false, revision: used, error: "No base template ID is set." };

    const key = await keyFor(companyId);
    if (!key) return { ok: false, revision: used, error: "This company is not connected to Klaviyo." };

    // If the configured revision cannot read a definition, find one that can
    // rather than reporting a dead end. It is the question the error raises,
    // and answering it is a handful of reads of one template.
    let template: TemplateDetail;
    let worksAt: string | undefined;
    const tried: NonNullable<BaseTemplateReport["tried"]> = [];
    try {
      template = await fetchTemplate(key, id);
    } catch (error) {
      if (!(error instanceof KlaviyoError)) throw error;
      tried.push({ revision: used, result: shorten(error.detail) });

      let rescued: TemplateDetail | null = null;
      for (const candidate of CANDIDATE_REVISIONS) {
        if (candidate === used) continue;
        try {
          const attempt = await fetchTemplate(key, id, candidate);
          tried.push({
            revision: candidate,
            answeredAs: attempt.answeredRevision,
            result: attempt.definition ? `read it via ${attempt.readBy}` : "no definition",
          });
          if (attempt.definition) {
            rescued = attempt;
            worksAt = candidate;
            break;
          }
        } catch (why) {
          tried.push({
            revision: candidate,
            result: why instanceof KlaviyoError ? shorten(why.detail) : "failed",
          });
        }
      }
      if (!rescued || !worksAt) {
        return { ok: false, revision: used, error: error.detail, tried };
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
      htmlBlocks, marked, worksAt, readBy: template.readBy,
      tried: tried.length ? tried : undefined,
      note: marked
        ? "The marked block is the one that will be filled."
        : "No marker, but there is only one HTML block, so that is the one that will be filled.",
    };
  } catch (error) {
    const failed = failure(error, "Klaviyo");
    return { ok: false, revision: used, error: failed.error };
  }
}

/** Klaviyo's sentences are long; the search's table wants the gist of each. */
function shorten(detail: string): string {
  const first = detail.split(". ")[0] ?? detail;
  return first.length > 90 ? `${first.slice(0, 90)}…` : first;
}
