import { prisma } from "@/lib/db";

/**
 * Whether a row+template has gone to Klaviyo, and as what.
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
  const push = await prisma.klaviyoPush.findUnique({
    where: { rowId_templateId: { rowId, templateId } },
    select: { status: true },
  });
  return publishedFromStatus(push?.status);
}
