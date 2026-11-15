import { prisma } from "@/lib/db";
import { isEmailProvider, PROVIDER_LABELS } from "@/lib/esp/types";

/**
 * Whether a row+template has gone to its sending platform, and as what.
 *
 * One rule, read by the sign-off that refuses to be withdrawn and by the button
 * that says why. A second copy would drift into a button that says one thing
 * and a server that does another, which is worse than either behaviour on its
 * own.
 *
 * A cancelled push does not count: the campaign is no longer out there, so
 * there is nothing left for the sign-off to be holding up.
 */
export type Published = "drafted" | "scheduled";

export function publishedFromStatus(status: string | null | undefined): Published | null {
  if (status === "scheduled") return "scheduled";
  if (status === "draft") return "drafted";
  return null;
}

export async function publishedState(rowId: string, templateId: string): Promise<Published | null> {
  const push = await prisma.espPush.findUnique({
    where: { rowId_templateId: { rowId, templateId } },
    select: { status: true },
  });
  return publishedFromStatus(push?.status);
}

/**
 * Which platform this pair went to, by name.
 *
 * Read from the push rather than from the company, because the two can differ:
 * a company that has changed platform still has live campaigns in the one it
 * left, and a sentence about those has to name where they actually are.
 */
export async function publishedPlatform(rowId: string, templateId: string): Promise<string> {
  const push = await prisma.espPush.findUnique({
    where: { rowId_templateId: { rowId, templateId } },
    select: { provider: true },
  });
  if (!push) return "the sending platform";
  return PROVIDER_LABELS[isEmailProvider(push.provider) ? push.provider : "klaviyo"];
}
