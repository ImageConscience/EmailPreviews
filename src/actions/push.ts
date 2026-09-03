"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { performPush, performSchedule, type PushMode, type PushResult, type SendOverride } from "@/lib/push-core";

export type { PushMode, PushResult, PushState, SendOverride } from "@/lib/push-core";

/**
 * The doors into a client's Klaviyo, each with the access it needs.
 *
 * Thin on purpose. Everything that decides whether a push is allowed and what
 * it contains lives in `push-core`, where it can be exercised end to end
 * without a browser; these add who is asking and refresh what they are looking
 * at afterwards.
 */
export async function pushToKlaviyoAction(
  companyId: string,
  rowId: string,
  templateId: string,
  mode: PushMode = "draft",
  override?: SendOverride,
): Promise<PushResult> {
  // Admin and above for both. Pushing writes into a client's Klaviyo account,
  // which is a different kind of act from approving a row in this app, and the
  // people who do the second are not always the people trusted with the first.
  let access;
  try {
    access = await requireCompanyAccess(companyId, "admin");
  } catch (error) {
    // A refusal is an answer, not a crash. Thrown, it would reject the client's
    // promise and leave the dialog saying "Talking to Klaviyo…" indefinitely.
    return { ok: false, error: refusal(error) };
  }
  const result = await performPush(companyId, rowId, templateId, access.user.id, mode, override);
  if (result.ok) {
    revalidatePath(`/c/${companyId}/overview`);
    revalidatePath(`/c/${companyId}/push`);
    // An overridden send time is a sheet edit, so the sheet's own view of it is
    // now out of date too.
    revalidatePath(`/c/${companyId}/sheets`);
  }
  return result;
}

/** Schedule something already pushed as a draft, without pushing it again. */
export async function scheduleKlaviyoAction(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<PushResult> {
  try {
    await requireCompanyAccess(companyId, "admin");
  } catch (error) {
    return { ok: false, error: refusal(error) };
  }
  const result = await performSchedule(companyId, rowId, templateId);
  if (result.ok) {
    revalidatePath(`/c/${companyId}/overview`);
    revalidatePath(`/c/${companyId}/push`);
  }
  return result;
}

function refusal(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  throw error;
}
