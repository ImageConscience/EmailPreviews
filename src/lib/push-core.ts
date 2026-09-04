import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { approvalFingerprint } from "@/lib/fingerprint";
import { SecretError } from "@/lib/secret";
import { KlaviyoError, assignTemplate, cancelCampaign, cloneTemplate, createCampaign,
  deleteTemplate, fetchAudiences, fetchCampaign, fetchMessageTemplate, fetchTemplate,
  scheduleCampaign, updateCampaign, updateDndTemplate,
  type Audience, type CampaignContent } from "@/lib/klaviyo";
import { klaviyoKeyForCompany } from "@/lib/klaviyo-key";
import { renderRow } from "@/lib/render-row";
import { detachUniversalBlocks, findContentBlock, toBlockContent } from "@/lib/block-content";
import { audienceSlots, envelopeSlots, extractPlaceholders, findAudienceColumns,
  findEnvelopeColumns, normalizeKey } from "@/lib/template";
import { DEFAULT_TIMEZONE, zonedToUtc } from "@/lib/zone";
import { parseRecord, parseStringArray } from "@/lib/json";
import { checkEligibility, scheduleBlocker } from "@/lib/push-eligibility";

/** What a push is asking for. */
export type PushMode = "draft" | "scheduled";

/**
 * A send time entered at the push instead of read from the sheet.
 *
 * The sheet stays the home of a send time, so an override is written back to it
 * rather than kept beside it: two places holding different answers is how a
 * calendar starts lying about when things go out.
 */
export interface SendOverride {
  /** `yyyy-mm-dd`, or empty to clear the date. */
  date: string;
  /** `HH:mm`, or empty. */
  time: string;
}

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

/**
 * Of these user ids, which hold admin or owner on this company.
 *
 * One query rather than a role on every approval row: membership is where a
 * role lives, and reading it here keeps the answer current even for somebody
 * promoted after they approved.
 */
export async function adminIds(companyId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const memberships = await prisma.membership.findMany({
    where: { companyId, userId: { in: [...new Set(userIds)] }, role: { in: ["admin", "owner"] } },
    select: { userId: true },
  });
  return new Set(memberships.map((m) => m.userId));
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
        klaviyoKeyCipher: true, klaviyoAudience: true, klaviyoAudienceExclude: true,
      },
    }),
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { id: true, data: true, hiddenAt: true, sheet: { select: { columns: true } },
        approvals: { select: { templateId: true, contentHash: true, userId: true,
          user: { select: { name: true, email: true } } } } },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { id: true, name: true, updatedAt: true } }),
  ]);

  if (!company) return { error: "Company not found." };
  if (!row) return { error: "Row not found." };
  if (!template) return { error: "Template not found." };

  // Which approvers are admins on this company, since one current admin
  // sign-off is what the gate turns on.
  const admins = await adminIds(companyId, row.approvals.map((a) => a.userId));

  // The same rule the list uses to decide what to offer, so the list and the
  // push can never disagree about whether a row is ready.
  const check = checkEligibility(
    {
      data: row.data,
      values: parseRecord(row.data),
      columns: parseStringArray(row.sheet.columns),
      hiddenAt: row.hiddenAt,
      approvals: row.approvals.map((a) => ({ ...a, admin: admins.has(a.userId) })),
    },
    template,
    {
      fromEmail: company.klaviyoFromEmail,
      baseTemplateId: company.klaviyoBaseTemplateId,
      timezone: company.klaviyoTimezone,
      connected: Boolean(company.klaviyoKeyCipher),
      audience: company.klaviyoAudience,
      audienceExclude: company.klaviyoAudienceExclude,
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
 * Write an overridden send time back to the sheet, and keep the sign-offs.
 *
 * Editing a row normally invalidates every approval on it, because the
 * fingerprint covers the whole row and almost any edit changes the email. A
 * send time usually does not: it decides when Klaviyo mails the thing, and
 * nothing about what it says. So an approval is carried forward when the
 * template it was given against provably does not print the field -- which is
 * decided by looking for the placeholder, not by assuming.
 *
 * Where a template does print it, the approval is left to go stale, and the
 * push refuses rather than sending an email nobody has read in this form.
 */
async function applySendOverride(
  row: { id: string; data: string; sheetId: string },
  columns: string[],
  template: { id: string; name: string; html: string },
  approvals: { templateId: string }[],
  override: SendOverride,
  userId: string,
): Promise<{ changed: boolean; note?: string } | { error: string }> {
  const slots = envelopeSlots(findEnvelopeColumns(columns));
  const current = parseRecord(row.data);
  const date = override.date.trim();
  const time = override.time.trim();

  const was = { date: (current[slots.sendDate] ?? "").trim(), time: (current[slots.sendTime] ?? "").trim() };
  if (was.date === date && was.time === time) return { changed: false };

  const touched = new Set([normalizeKey(slots.sendDate), normalizeKey(slots.sendTime)]);
  const prints = (html: string) =>
    extractPlaceholders(html).some((name) => touched.has(normalizeKey(name)));

  if (prints(template.html)) {
    return {
      error:
        `“${template.name}” prints the send date in the email itself, so changing it here would ` +
        "change what people already approved. Edit the row and have it approved again.",
    };
  }

  // Every other template this row is approved in gets the same test, one at a
  // time: a sign-off in a template that does print the date has to go stale
  // even though the one being pushed does not.
  const otherIds = [...new Set(approvals.map((a) => a.templateId))].filter((id) => id !== template.id);
  const others = otherIds.length
    ? await prisma.template.findMany({ where: { id: { in: otherIds } }, select: { id: true, html: true, updatedAt: true } })
    : [];

  const next = { ...current, [slots.sendDate]: date, [slots.sendTime]: time };
  const nextData = JSON.stringify(next);

  const lowered = new Set(columns.map((c) => c.toLowerCase()));
  const added = [slots.sendDate, slots.sendTime].filter((k) => !lowered.has(k.toLowerCase()));

  const carry = [
    { id: template.id, updatedAt: null as Date | null },
    ...others.filter((t) => !prints(t.html)).map((t) => ({ id: t.id, updatedAt: t.updatedAt })),
  ];

  const templateUpdatedAt = new Map(others.map((t) => [t.id, t.updatedAt]));
  const pushedAt = await prisma.template.findUniqueOrThrow({
    where: { id: template.id }, select: { updatedAt: true },
  });
  templateUpdatedAt.set(template.id, pushedAt.updatedAt);

  await prisma.$transaction([
    prisma.rowRevision.create({
      data: {
        rowId: row.id,
        data: row.data,
        changedById: userId,
        note: "Send time changed while pushing to Klaviyo",
      },
    }),
    prisma.sheetRow.update({ where: { id: row.id }, data: { data: nextData } }),
    ...(added.length
      ? [prisma.contentSheet.update({
          where: { id: row.sheetId },
          data: { columns: JSON.stringify([...columns, ...added]) },
        })]
      : []),
    ...carry.map((t) =>
      prisma.approval.updateMany({
        where: { rowId: row.id, templateId: t.id },
        data: { contentHash: approvalFingerprint(nextData, t.id, templateUpdatedAt.get(t.id)!) },
      }),
    ),
  ]);

  const staleNames = others.filter((t) => prints(t.html)).length;
  const say = (d: string, t: string) => [d || "no date", t].filter(Boolean).join(" ");
  return {
    changed: true,
    note:
      `The sheet's send time was changed from ${say(was.date, was.time)} to ${say(date, time)}.` +
      (staleNames > 0
        ? ` ${staleNames} sign-off${staleNames === 1 ? "" : "s"} in other templates that print the ` +
          "date went stale."
        : ""),
  };
}

/** Load what the override needs, check it, and hand it to the write. */
async function applyOverride(
  companyId: string,
  rowId: string,
  templateId: string,
  userId: string,
  override: SendOverride,
  mode: PushMode,
): Promise<{ note?: string } | { error: string }> {
  const [row, template, company] = await Promise.all([
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { id: true, data: true, sheetId: true,
        sheet: { select: { columns: true } },
        approvals: { select: { templateId: true } } },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { id: true, name: true, html: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { klaviyoTimezone: true } }),
  ]);
  if (!row) return { error: "Row not found." };
  if (!template) return { error: "Template not found." };

  const date = override.date.trim();
  const time = override.time.trim();
  if (!date && time) return { error: "A send time needs a date to go with it." };

  // Read it before writing it: a date the app cannot parse would be stored on
  // the sheet and then rejected by the push, leaving the row edited for nothing.
  const zone = company?.klaviyoTimezone ?? DEFAULT_TIMEZONE;
  if (date) {
    const when = zonedToUtc(date, time, zone);
    if (!when.utc) return { error: `“${date} ${time}”.trim() is not a date and time this can read.` };
    if (mode === "scheduled" && when.utc.getTime() <= Date.now()) {
      return { error: "That send time has already passed." };
    }
  } else if (mode === "scheduled") {
    return { error: "Scheduling needs a send date and time; this row has none." };
  }

  const applied = await applySendOverride(
    { id: row.id, data: row.data, sheetId: row.sheetId },
    parseStringArray(row.sheet.columns),
    template,
    row.approvals,
    override,
    userId,
  );
  if ("error" in applied) return { error: applied.error };
  return { note: applied.note };
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
  override?: SendOverride,
): Promise<PushResult> {
  try {
    const apiKey = await klaviyoKeyForCompany(companyId);
    if (!apiKey) return { ok: false, error: "This company is not connected to Klaviyo." };

    // An overridden send time is a sheet edit, and it happens first so that
    // everything below -- the eligibility check included -- reads one row with
    // one send time on it.
    const overrideNotes: string[] = [];
    if (override) {
      const applied = await applyOverride(companyId, rowId, templateId, userId, override, mode);
      if ("error" in applied) return { ok: false, error: applied.error };
      if (applied.note) overrideNotes.push(applied.note);
    }

    const ready = await prepare(companyId, rowId, templateId, mode);
    if ("error" in ready) return { ok: false, error: ready.error };

    // --- who it goes to, resolved against the live account ---------------
    const row = await prisma.sheetRow.findFirstOrThrow({
      where: { id: rowId },
      select: { data: true, sheet: { select: { columns: true } } },
    });
    const data = parseRecord(row.data);
    const audienceKeys = audienceSlots(findAudienceColumns(parseStringArray(row.sheet.columns)));
    const defaults = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { klaviyoAudience: true, klaviyoAudienceExclude: true },
    });
    // Same fallback the eligibility rule applies, so what the list offered and
    // what actually gets sent to are the same set of people.
    const audienceCell =
      (data[audienceKeys.audience] ?? "").trim() || (defaults.klaviyoAudience ?? "").trim();
    if (!audienceCell) {
      return {
        ok: false,
        error:
          `This row has no “${audienceKeys.audience}” and this company has no default audience, ` +
          "so there is nobody to send it to.",
      };
    }

    const available = await fetchAudiences(apiKey);
    const included = resolveAudiences(audienceCell, available);
    if ("error" in included) return { ok: false, error: included.error };

    const excludeCell =
      (data[audienceKeys.exclude] ?? "").trim() || (defaults.klaviyoAudienceExclude ?? "").trim();
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

    // Klaviyo will not write back a template holding blocks shared with other
    // templates, and the clone inherits every such reference from the base. The
    // clone is a frozen copy of one approved campaign, so the reference is the
    // part to give up; the content stays, and the base template keeps its own.
    const detached = detachUniversalBlocks(clone.definition);
    if (detached > 0) {
      const one = detached === 1;
      ready.notes.push(
        `${detached} reusable ${one ? "block was" : "blocks were"} copied into this campaign ` +
          `rather than linked, so later edits to ${one ? "it" : "them"} in Klaviyo will not ` +
          "change this send.",
      );
    }

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

    /*
     * Tidy up the clone, but only once it is provably not the thing the
     * campaign is made of.
     *
     * Assignment is a relationship, and if Klaviyo took its own copy then the
     * message points at that and this clone is litter -- a template per send,
     * piling up in the client's library forever. If instead the message points
     * straight at this clone, deleting it would empty a campaign that may
     * already be scheduled. So read back which it is rather than believing
     * either story, and delete only in the first case.
     */
    const held = await fetchMessageTemplate(apiKey, refs.messageId).catch(() => cloneId);
    const orphans = [cloneId, existing?.klaviyoTemplateId]
      .filter((id): id is string => Boolean(id) && id !== held);
    let tidied = 0;
    for (const id of [...new Set(orphans)]) {
      try {
        await deleteTemplate(apiKey, id);
        tidied += 1;
      } catch {
        // Cleanup is not worth failing a push that has otherwise worked; the
        // stray template is untidy, not broken.
      }
    }

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
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: held ?? cloneId,
        contentHash: ready.contentHash, status: mode,
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId,
      },
      update: {
        campaignId: refs.campaignId, messageId: refs.messageId, klaviyoTemplateId: held ?? cloneId,
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
        ...(tidied > 0
          ? [`Tidied up ${tidied} one-off ${tidied === 1 ? "template" : "templates"} Klaviyo no ` +
             "longer needs."]
          : []),
        ...overrideNotes,
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

