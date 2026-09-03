import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { approvalFingerprint } from "@/lib/fingerprint";
import { SecretError } from "@/lib/secret";
import { KlaviyoError, assignTemplate, cloneTemplate, createCampaign, fetchAudiences,
  fetchCampaign, fetchTemplate, scheduleCampaign, updateCampaign, updateDndTemplate,
  type Audience, type CampaignContent } from "@/lib/klaviyo";
import { klaviyoKeyForCompany } from "@/lib/klaviyo-key";
import { renderRow } from "@/lib/render-row";
import { CONTENT_MARKER, findContentBlock, toBlockContent } from "@/lib/block-content";
import { DEFAULT_TIMEZONE, describe, zonedToUtc } from "@/lib/zone";
import { findEnvelopeColumns } from "@/lib/template";
import { parseRecord, parseStringArray } from "@/lib/json";

/** Sheet columns naming who a send goes to. */
const AUDIENCE_COLUMN = "audience";
const EXCLUDE_COLUMN = "audience_exclude";

export interface PushState {
  campaignId: string;
  campaignName: string;
  status: string;
  scheduledFor: string | null;
  audienceNames: string;
  pushedAt: string;
  pushedBy: string | null;
  /** True when the row has been edited since it was pushed. */
  stale: boolean;
  /** Klaviyo's own view, when it was asked. */
  klaviyoStatus?: string | null;
}

export interface PushResult {
  ok: boolean;
  error?: string;
  /** Things worth knowing that did not stop the push. */
  notes?: string[];
  push?: PushState;
}

function failure(error: unknown): PushResult {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof SecretError) return { ok: false, error: error.message };
  if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
  if (error instanceof Error && error.name === "TimeoutError") {
    return { ok: false, error: "Klaviyo did not answer within 30 seconds. Nothing was scheduled." };
  }
  return { ok: false, error: "Could not reach Klaviyo." };
}

/**
 * Turn what a row says into audience ids.
 *
 * Names are matched case-insensitively, and an id is accepted as itself, so a
 * sheet can say "Newsletter" or the id and both work. An unmatched name is an
 * error rather than an omission: a campaign sent to nobody, or to fewer people
 * than intended, is the kind of mistake that only shows up in the report
 * afterwards.
 */
function resolveAudiences(
  cell: string,
  available: Audience[],
): { ids: string[]; names: string[] } | { error: string } {
  const wanted = cell.split(",").map((part) => part.trim()).filter(Boolean);
  const ids: string[] = [];
  const names: string[] = [];

  for (const term of wanted) {
    const byId = available.filter((a) => a.id === term);
    const byName = available.filter((a) => a.name.toLowerCase() === term.toLowerCase());
    const matches = byId.length ? byId : byName;

    if (matches.length === 0) {
      return { error: `No list or segment in Klaviyo is called “${term}”.` };
    }
    if (matches.length > 1) {
      // A list and a segment sharing a name is ordinary in Klaviyo, and picking
      // one silently would send to the wrong people.
      return {
        error:
          `“${term}” matches ${matches.length} audiences in Klaviyo ` +
          `(${matches.map((m) => m.kind).join(" and ")}). Use its id instead of its name.`,
      };
    }
    ids.push(matches[0].id);
    names.push(`${matches[0].name} (${matches[0].kind})`);
  }

  return { ids, names };
}

interface Prepared {
  content: CampaignContent;
  html: string;
  contentHash: string;
  notes: string[];
  audienceNames: string;
  baseTemplateId: string;
  templateName: string;
}

/**
 * Everything a push needs, assembled and checked before anything is sent.
 *
 * Deliberately one function that either returns a complete, valid push or an
 * explanation: a half-finished push against a client's account leaves a
 * campaign behind that somebody has to find and delete.
 */
async function prepare(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<Prepared | { error: string }> {
  const [company, row, template] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        klaviyoFromEmail: true, klaviyoFromLabel: true, klaviyoReplyTo: true,
        klaviyoTimezone: true, klaviyoBaseTemplateId: true, klaviyoAccountName: true,
      },
    }),
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { id: true, data: true, hiddenAt: true, sheet: { select: { columns: true } },
        approvals: { select: { templateId: true, contentHash: true, user: { select: { name: true, email: true } } } } },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { id: true, name: true, updatedAt: true } }),
  ]);

  if (!company) return { error: "Company not found." };
  if (!row) return { error: "Row not found." };
  if (!template) return { error: "Template not found." };
  if (!company.klaviyoBaseTemplateId) {
    return { error: "No Klaviyo base template is set for this company. Choose one on the Integrations page." };
  }
  if (!company.klaviyoFromEmail) {
    return { error: "No from-address is set for this company. Add one on the Integrations page." };
  }

  // --- the gate ---------------------------------------------------------
  // Every approval on this row-and-template must be current. Editing the row
  // or the template invalidates them all, so this says: what is about to be
  // sent is the thing everyone who looked at it signed off on.
  const currentHash = approvalFingerprint(row.data, template.id, template.updatedAt);
  const mine = row.approvals.filter((a) => a.templateId === template.id);
  if (mine.length === 0) {
    return { error: "Nobody has approved this row in this template yet." };
  }
  const stale = mine.filter((a) => a.contentHash !== currentHash);
  if (stale.length > 0) {
    const who = stale.map((a) => a.user.name ?? a.user.email).join(", ");
    return {
      error:
        `${who} approved an earlier version, and this company requires every approval to be current. ` +
        "Ask them to re-approve, or withdraw the stale approval.",
    };
  }
  if (row.hiddenAt) return { error: "This row is hidden. Unhide it before pushing." };

  // --- the content ------------------------------------------------------
  const rendered = await renderRow(companyId, rowId, templateId);
  if (!rendered) return { error: "Could not render this row." };

  const data = parseRecord(row.data);
  const envelope = findEnvelopeColumns(parseStringArray(row.sheet.columns));
  const subject = (envelope.subject ? data[envelope.subject] : "")?.trim() ?? "";
  if (!subject) return { error: "This row has no subject line." };

  const previewText = (envelope.preheader ? data[envelope.preheader] : "")?.trim() ?? "";
  const campaignName =
    (data.campaign ?? data.campaign_name ?? "").trim() || subject;

  // --- when ------------------------------------------------------------
  const notes: string[] = [];
  const zone = company.klaviyoTimezone ?? DEFAULT_TIMEZONE;
  const sendDate = (envelope.sendDate ? data[envelope.sendDate] : "")?.trim() ?? "";
  const sendTime = (envelope.sendTime ? data[envelope.sendTime] : "")?.trim() ?? "";

  let sendAt: Date | null = null;
  if (sendDate) {
    const when = zonedToUtc(sendDate, sendTime, zone);
    if (!when.utc) return { error: `“${sendDate} ${sendTime}” is not a date and time this can read.` };
    sendAt = when.utc;
    if (when.warning) notes.push(when.warning);
    notes.push(`Set to send ${describe(sendAt, zone)}.`);
  } else {
    notes.push("This row has no send date, so the campaign is left undated in Klaviyo.");
  }

  const block = toBlockContent(rendered.html);
  notes.push(...block.notes);

  return {
    content: {
      name: campaignName,
      subject,
      previewText,
      fromEmail: company.klaviyoFromEmail,
      fromLabel: company.klaviyoFromLabel ?? company.klaviyoAccountName ?? "",
      replyTo: company.klaviyoReplyTo ?? undefined,
      includedAudiences: [],
      excludedAudiences: [],
      sendAt,
    },
    html: block.html,
    contentHash: currentHash,
    notes,
    audienceNames: "",
    baseTemplateId: company.klaviyoBaseTemplateId,
    templateName: `${campaignName} — ${template.name}`,
  };
}

/**
 * Put an approved row into Klaviyo as a draft campaign.
 *
 * Free of request context on purpose: the caller has already established who is
 * asking and what they may do, which leaves this function testable end to end
 * against a stand-in Klaviyo without a browser in the loop.
 *
 * Creates nothing that sends. The campaign carries its send time if the row has
 * one, but a campaign with a date is still a draft until somebody schedules it,
 * which is a separate action with its own confirmation.
 */
export async function performPush(
  companyId: string,
  rowId: string,
  templateId: string,
  userId: string,
): Promise<PushResult> {
  try {
    const apiKey = await klaviyoKeyForCompany(companyId);
    if (!apiKey) return { ok: false, error: "This company is not connected to Klaviyo." };

    const ready = await prepare(companyId, rowId, templateId);
    if ("error" in ready) return { ok: false, error: ready.error };

    // --- who it goes to, resolved against the live account ---------------
    const row = await prisma.sheetRow.findFirstOrThrow({
      where: { id: rowId }, select: { data: true },
    });
    const data = parseRecord(row.data);
    const audienceCell = (data[AUDIENCE_COLUMN] ?? "").trim();
    if (!audienceCell) {
      return {
        ok: false,
        error: `This row has no “${AUDIENCE_COLUMN}” value, so there is nobody to send it to.`,
      };
    }

    const available = await fetchAudiences(apiKey);
    const included = resolveAudiences(audienceCell, available);
    if ("error" in included) return { ok: false, error: included.error };

    const excludeCell = (data[EXCLUDE_COLUMN] ?? "").trim();
    const excluded = excludeCell ? resolveAudiences(excludeCell, available) : { ids: [], names: [] };
    if ("error" in excluded) return { ok: false, error: excluded.error };

    const content: CampaignContent = {
      ...ready.content,
      includedAudiences: included.ids,
      excludedAudiences: excluded.ids,
    };

    // --- the template clone, with our block filled ------------------------
    const base = await fetchTemplate(apiKey, ready.baseTemplateId);
    if (!base.definition) {
      return {
        ok: false,
        error:
          `“${base.name}” is a ${base.editorType} template, which has no blocks to fill. ` +
          "The base template has to be a drag-and-drop one.",
      };
    }
    // Check the base before cloning: a refusal after the clone leaves a stray
    // template in the client's library for someone to clear up.
    const probe = findContentBlock(base.definition);
    if ("error" in probe) return { ok: false, error: probe.error };

    const cloneId = await cloneTemplate(apiKey, ready.baseTemplateId, ready.templateName);
    const clone = await fetchTemplate(apiKey, cloneId);
    const target = findContentBlock(clone.definition);
    if ("error" in target) return { ok: false, error: target.error };

    target.block.data = { ...(target.block.data ?? {}), content: ready.html };
    await updateDndTemplate(apiKey, cloneId, ready.templateName, clone.definition);

    // --- the campaign -----------------------------------------------------
    const existing = await prisma.klaviyoPush.findUnique({
      where: { rowId_templateId: { rowId, templateId } },
    });

    let refs = existing ? { campaignId: existing.campaignId, messageId: existing.messageId } : null;
    if (refs) {
      // Only reuse a campaign Klaviyo still has and has not sent.
      const live = await fetchCampaign(apiKey, refs.campaignId);
      if (!live || live.status === "Sent" || live.archived) refs = null;
    }

    if (refs) await updateCampaign(apiKey, refs, content);
    else refs = await createCampaign(apiKey, content);

    await assignTemplate(apiKey, refs.messageId, cloneId);

    const audienceNames = [
      ...included.names,
      ...excluded.names.map((n) => `excluding ${n}`),
    ].join(", ");

    const saved = await prisma.klaviyoPush.upsert({
      where: { rowId_templateId: { rowId, templateId } },
      create: {
        rowId, templateId,
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: cloneId,
        contentHash: ready.contentHash, status: "draft",
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId,
      },
      update: {
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: cloneId,
        contentHash: ready.contentHash, status: "draft",
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId, pushedAt: new Date(),
      },
      include: { pushedBy: { select: { name: true, email: true } } },
    });

    return {
      ok: true,
      notes: [`Sending to ${audienceNames}.`, ...ready.notes],
      push: present(saved, ready.contentHash),
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Hand the campaign to Klaviyo's scheduler.
 *
 * The point of no return, and the only place in this app that reaches it. Kept
 * apart from the push so that putting an email into Klaviyo and committing to
 * sending it are two decisions rather than one.
 */
export async function performSchedule(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<PushResult> {
  try {
    const apiKey = await klaviyoKeyForCompany(companyId);
    if (!apiKey) return { ok: false, error: "This company is not connected to Klaviyo." };

    const push = await prisma.klaviyoPush.findUnique({
      where: { rowId_templateId: { rowId, templateId } },
      include: { pushedBy: { select: { name: true, email: true } } },
    });
    if (!push) return { ok: false, error: "This row has not been pushed to Klaviyo yet." };

    // The row must still be the row that was pushed. Editing it after a push
    // leaves the campaign holding older content, and scheduling that would send
    // something nobody looked at.
    const [row, template] = await Promise.all([
      prisma.sheetRow.findFirstOrThrow({ where: { id: rowId }, select: { data: true } }),
      prisma.template.findFirstOrThrow({ where: { id: templateId }, select: { updatedAt: true } }),
    ]);
    if (approvalFingerprint(row.data, templateId, template.updatedAt) !== push.contentHash) {
      return {
        ok: false,
        error: "This row has changed since it was pushed. Push it again before scheduling.",
      };
    }

    if (push.scheduledFor && push.scheduledFor.getTime() < Date.now()) {
      return { ok: false, error: "That send time has already passed. Change the date and push again." };
    }

    await scheduleCampaign(apiKey, push.campaignId);

    const saved = await prisma.klaviyoPush.update({
      where: { id: push.id },
      data: { status: "scheduled" },
      include: { pushedBy: { select: { name: true, email: true } } },
    });

    return { ok: true, push: present(saved, push.contentHash) };
  } catch (error) {
    return failure(error);
  }
}

type PushRecord = {
  campaignId: string; campaignName: string; status: string; scheduledFor: Date | null;
  audienceNames: string; pushedAt: Date; contentHash: string;
  pushedBy: { name: string | null; email: string } | null;
};

function present(push: PushRecord, currentHash: string): PushState {
  return {
    campaignId: push.campaignId,
    campaignName: push.campaignName,
    status: push.status,
    scheduledFor: push.scheduledFor?.toISOString() ?? null,
    audienceNames: push.audienceNames,
    pushedAt: push.pushedAt.toISOString(),
    pushedBy: push.pushedBy?.name ?? push.pushedBy?.email ?? null,
    stale: push.contentHash !== currentHash,
  };
}

