import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { approvalFingerprint } from "@/lib/fingerprint";
import { SecretError } from "@/lib/secret";
import { KlaviyoError, assignTemplate, cancelCampaign, cloneTemplate, createCampaign,
  fetchAudiences, fetchCampaign, fetchTemplate, scheduleCampaign, updateCampaign, updateDndTemplate,
  type Audience, type CampaignContent } from "@/lib/klaviyo";
import { klaviyoKeyForCompany } from "@/lib/klaviyo-key";
import { renderRow } from "@/lib/render-row";
import { findContentBlock, toBlockContent } from "@/lib/block-content";
import { findEnvelopeColumns } from "@/lib/template";
import { parseRecord, parseStringArray } from "@/lib/json";
import {
  AUDIENCE_COLUMN,
  EXCLUDE_COLUMN,
  checkEligibility,
  scheduleBlocker,
} from "@/lib/push-eligibility";

/** What a push is asking for. */
export type PushMode = "draft" | "scheduled";

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
  mode: PushMode,
): Promise<Prepared | { error: string }> {
  const [company, row, template] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        klaviyoFromEmail: true, klaviyoFromLabel: true, klaviyoReplyTo: true,
        klaviyoTimezone: true, klaviyoBaseTemplateId: true, klaviyoAccountName: true,
        klaviyoKeyCipher: true,
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

  // The same rule the list uses to decide what to offer, so the list and the
  // push can never disagree about whether a row is ready.
  const check = checkEligibility(
    {
      data: row.data,
      values: parseRecord(row.data),
      columns: parseStringArray(row.sheet.columns),
      hiddenAt: row.hiddenAt,
      approvals: row.approvals,
    },
    template,
    {
      fromEmail: company.klaviyoFromEmail,
      baseTemplateId: company.klaviyoBaseTemplateId,
      timezone: company.klaviyoTimezone,
      connected: Boolean(company.klaviyoKeyCipher),
    },
  );
  if (!check.ok) return { error: check.blockers.join(" ") };

  if (mode === "scheduled") {
    const why = scheduleBlocker(check);
    if (why) return { error: why };
  }

  const rendered = await renderRow(companyId, rowId, templateId);
  if (!rendered) return { error: "Could not render this row." };

  const data = parseRecord(row.data);
  const envelope = findEnvelopeColumns(parseStringArray(row.sheet.columns));
  const previewText = (envelope.preheader ? data[envelope.preheader] : "")?.trim() ?? "";

  const notes: string[] = [];
  if (check.warning) notes.push(check.warning);
  if (check.sendAt) notes.push(`Send time ${check.sendAtLabel}.`);
  else notes.push("This row has no send date, so the campaign is left undated in Klaviyo.");

  const block = toBlockContent(rendered.html);
  notes.push(...block.notes);

  return {
    content: {
      name: check.campaignName,
      subject: check.subject,
      previewText,
      fromEmail: company.klaviyoFromEmail!,
      fromLabel: company.klaviyoFromLabel ?? company.klaviyoAccountName ?? "",
      replyTo: company.klaviyoReplyTo ?? undefined,
      includedAudiences: [],
      excludedAudiences: [],
      sendAt: check.sendAt,
    },
    html: block.html,
    contentHash: check.contentHash,
    notes,
    audienceNames: "",
    baseTemplateId: company.klaviyoBaseTemplateId!,
    templateName: `${check.campaignName} — ${template.name}`,
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
  mode: PushMode = "draft",
): Promise<PushResult> {
  try {
    const apiKey = await klaviyoKeyForCompany(companyId);
    if (!apiKey) return { ok: false, error: "This company is not connected to Klaviyo." };

    const ready = await prepare(companyId, rowId, templateId, mode);
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
    let unscheduled = false;
    if (refs) {
      // Only reuse a campaign Klaviyo still has and has not sent.
      const live = await fetchCampaign(apiKey, refs.campaignId);
      if (!live || live.status === "Sent" || live.archived) refs = null;
      else if (live.status === "Scheduled") {
        // Klaviyo refuses to edit a campaign that is already in the send queue,
        // so pushing over one means taking it out of the queue first. Doing it
        // here rather than surfacing Klaviyo's 409 keeps the row and the
        // campaign in step; the caller is told, and a scheduled push puts it
        // back at the end.
        await cancelCampaign(apiKey, refs.campaignId);
        unscheduled = true;
      }
    }

    if (refs) await updateCampaign(apiKey, refs, content);
    else refs = await createCampaign(apiKey, content);

    await assignTemplate(apiKey, refs.messageId, cloneId);

    const audienceNames = [
      ...included.names,
      ...excluded.names.map((n) => `excluding ${n}`),
    ].join(", ");

    // The point of no return, and the last thing done: everything above can be
    // undone by deleting a draft, and nothing below it can.
    if (mode === "scheduled") await scheduleCampaign(apiKey, refs.campaignId);

    const saved = await prisma.klaviyoPush.upsert({
      where: { rowId_templateId: { rowId, templateId } },
      create: {
        rowId, templateId,
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: cloneId,
        contentHash: ready.contentHash, status: mode,
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId,
      },
      update: {
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: cloneId,
        contentHash: ready.contentHash, status: mode,
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId, pushedAt: new Date(),
      },
      include: { pushedBy: { select: { name: true, email: true } } },
    });

    return {
      ok: true,
      notes: [
        mode === "scheduled"
          ? `Scheduled in Klaviyo. Sending to ${audienceNames}.`
          : `Draft created in Klaviyo. Sending to ${audienceNames} when scheduled.`,
        ...(unscheduled && mode !== "scheduled"
          ? ["It was scheduled in Klaviyo before this push, and is now back to a draft."]
          : []),
        ...ready.notes,
      ],
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

