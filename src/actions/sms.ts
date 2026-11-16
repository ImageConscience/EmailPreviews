"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { applyFields } from "@/lib/compose";
import { KlaviyoError, fetchAccount } from "@/lib/klaviyo";
import { encryptSecret, secretHint, secretsAvailable, SecretError } from "@/lib/secret";
import {
  createText,
  isSmsProvider,
  performSmsPush,
  performSmsUnschedule,
  smsAudiences,
  toggleSmsApproval,
  type SmsApprovalResult,
  type SmsPushMode,
  type SmsPushResult,
} from "@/lib/sms-core";
import type { EspAudience } from "@/lib/esp";

/**
 * The doors into texting, each with the access it needs.
 *
 * Thin, like the email actions: what is allowed and what is sent is decided in
 * `sms-core`, where the checks can reach it without a browser. Members write
 * and approve; admins push, unschedule and change settings.
 */

function refusal(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof SecretError) return error.message;
  return "Something went wrong. Nothing was changed.";
}

function refresh(companyId: string) {
  revalidatePath(`/c/${companyId}/texts`);
  revalidatePath(`/c/${companyId}/sheets`);
}

export interface TextSaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Save a text's fields, keeping the old version as a revision.
 *
 * Refused while it is scheduled: the platform would send the old words at the
 * old time while this app showed the new ones. Take it out of the queue first.
 * A draft can be edited -- its push simply shows as out of date until pushed
 * again, and its approval goes stale, which is the point of fingerprinting.
 */
export async function saveTextAction(
  companyId: string,
  rowId: string,
  values: Record<string, string>,
): Promise<TextSaveResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");
    const row = await prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId, kind: "sms" } },
      include: { smsPush: true },
    });
    if (!row) return { ok: false, error: "No such text." };
    if (row.smsPush?.status === "scheduled") {
      return {
        ok: false,
        error: "This text is scheduled to send. Unschedule it before changing it, so the two cannot disagree.",
      };
    }
    await applyFields(access.user.id, rowId, values, "Edited on the Texts page");
    refresh(companyId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
}

/** A new, empty text, in the given text sheet or in one made for it. */
/**
 * Start a text.
 *
 * The values are optional because there are two ways in. The Texts page adds a
 * blank row beside the one you are already writing, and you fill it in place.
 * The overview's "+ New" asks first -- it is a planning screen, so what it
 * knows is what the thing is called and when it goes -- and the message is
 * still written on the Texts page, where the preview and the segment count are.
 */
export async function addTextAction(
  companyId: string,
  sheetId?: string,
  start?: { name?: string; sendDate?: string; sendTime?: string },
): Promise<{ ok: boolean; error?: string; rowId?: string }> {
  try {
    const access = await requireCompanyAccess(companyId, "member");
    const made = await createText(access.user.id, companyId, { sheetId, ...start });
    refresh(companyId);
    return { ok: true, rowId: made.rowId };
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
}

export async function toggleTextApprovalAction(
  companyId: string,
  rowId: string,
): Promise<SmsApprovalResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");
    const result = await toggleSmsApproval(companyId, rowId, access.user.id);
    if (result.ok) refresh(companyId);
    return result;
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
}

export async function pushTextAction(
  companyId: string,
  rowId: string,
  mode: SmsPushMode,
): Promise<SmsPushResult> {
  let access;
  try {
    access = await requireCompanyAccess(companyId, "admin");
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
  const result = await performSmsPush(companyId, rowId, access.user.id, mode);
  if (result.ok) refresh(companyId);
  return result;
}

export async function unscheduleTextAction(companyId: string, rowId: string): Promise<SmsPushResult> {
  try {
    await requireCompanyAccess(companyId, "admin");
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
  const result = await performSmsUnschedule(companyId, rowId);
  if (result.ok) refresh(companyId);
  return result;
}

/** Who this company can text, for the pickers. Any member may look. */
export async function listSmsAudiencesAction(companyId: string): Promise<{
  ok: boolean;
  error?: string;
  audiences?: EspAudience[];
  source?: string | null;
  syncedAt?: string | null;
}> {
  try {
    await requireCompanyAccess(companyId, "member");
    const found = await smsAudiences(companyId);
    return {
      ok: true,
      audiences: found.audiences,
      source: found.source,
      syncedAt: found.syncedAt?.toISOString() ?? null,
    };
  } catch (error) {
    if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
    return { ok: false, error: refusal(error) };
  }
}

export interface SmsSettingsInput {
  provider: string | null;
  audience: string;
  exclude: string;
  addOptOut: boolean;
}

/**
 * Where texts go, and the defaults for who gets them.
 *
 * Changing platform keeps nothing of the other's: audiences named for Klaviyo
 * mean nothing to Attentive. Any Klaviyo SMS key is dropped with it.
 */
export async function saveSmsSettingsAction(
  companyId: string,
  input: SmsSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireCompanyAccess(companyId, "admin");
    const provider = input.provider && isSmsProvider(input.provider) ? input.provider : null;
    const current = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { smsProvider: true },
    });
    const switching = current.smsProvider !== provider;
    await prisma.company.update({
      where: { id: companyId },
      data: {
        smsProvider: provider,
        smsAudience: switching ? null : input.audience.trim() || null,
        smsAudienceExclude: switching ? null : input.exclude.trim() || null,
        smsAddOptOut: input.addOptOut,
        ...(switching && provider !== "klaviyo"
          ? { smsKeyCipher: null, smsKeyHint: null, smsAccountName: null }
          : {}),
      },
    });
    revalidatePath(`/c/${companyId}/integrations`);
    refresh(companyId);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
}

/**
 * A Klaviyo key only for texts, checked against Klaviyo before it is kept.
 *
 * An empty key clears it, which puts texts back on the email key.
 */
export async function setSmsKeyAction(
  companyId: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string; accountName?: string }> {
  try {
    await requireCompanyAccess(companyId, "admin");
    const key = apiKey.trim();
    if (!key) {
      await prisma.company.update({
        where: { id: companyId },
        data: { smsKeyCipher: null, smsKeyHint: null, smsAccountName: null },
      });
      revalidatePath(`/c/${companyId}/integrations`);
      return { ok: true };
    }
    if (!key.startsWith("pk_")) {
      return { ok: false, error: "That does not look like a Klaviyo private key, which starts with pk_." };
    }
    if (!secretsAvailable()) {
      return { ok: false, error: "This deployment has no ENCRYPTION_KEY, so it cannot store a key." };
    }
    const account = await fetchAccount(key);
    await prisma.company.update({
      where: { id: companyId },
      data: {
        smsKeyCipher: encryptSecret(key),
        smsKeyHint: secretHint(key),
        smsAccountName: account.name,
      },
    });
    revalidatePath(`/c/${companyId}/integrations`);
    revalidatePath(`/c/${companyId}`, "layout");
    return { ok: true, accountName: account.name };
  } catch (error) {
    if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
    return { ok: false, error: refusal(error) };
  }
}
