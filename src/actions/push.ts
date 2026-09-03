"use server";

import { revalidatePath } from "next/cache";

import { requireCompanyAccess } from "@/lib/auth";
import { performPush, performSchedule, type PushResult } from "@/lib/push-core";

export type { PushResult, PushState } from "@/lib/push-core";

/**
 * The two doors into a client's Klaviyo, each with the access it needs.
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
): Promise<PushResult> {
  const access = await requireCompanyAccess(companyId, "member");
  const result = await performPush(companyId, rowId, templateId, access.user.id);
  if (result.ok) revalidatePath(`/c/${companyId}/overview`);
  return result;
}

/**
 * Scheduling is admin-only where pushing is not.
 *
 * A draft in Klaviyo is reversible by deleting it; a scheduled campaign will
 * go out to a client's customers unless somebody stops it. Those are different
 * decisions and they get different permissions.
 */
export async function scheduleKlaviyoAction(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<PushResult> {
  await requireCompanyAccess(companyId, "admin");
  const result = await performSchedule(companyId, rowId, templateId);
  if (result.ok) revalidatePath(`/c/${companyId}/overview`);
  return result;
}
