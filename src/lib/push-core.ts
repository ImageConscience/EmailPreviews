import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { approvalFingerprint } from "@/lib/fingerprint";
import { SecretError } from "@/lib/secret";
import { KlaviyoError } from "@/lib/klaviyo";
import { PROVIDER_LABELS, isEmailProvider, providerFor, providerIdFor, refsFrom, setupBlockers, EspError,
  type EmailProvider, type EspAudience, type EspCampaignContent } from "@/lib/esp";
import { renderRow } from "@/lib/render-row";
import { audienceSlots, envelopeSlots, extractPlaceholders, findAudienceColumns,
  findEnvelopeColumns, normalizeKey } from "@/lib/template";
import { DEFAULT_TIMEZONE, zonedToUtc } from "@/lib/zone";
import { parseRecord, parseStringArray } from "@/lib/json";
import { checkEligibility, scheduleBlocker } from "@/lib/push-eligibility";

/** What a push is asking for. */
export type PushMode = "draft" | "scheduled";

/** Why an Attentive company's email is not pushed from here, and what to do instead. */
export const ATTENTIVE_HANDOFF =
  "This company sends through Attentive, which this app does not reach directly: its " +
  "published API has no campaigns. Ask Claude to hand off the approved Attentive emails; " +
  "it builds them in Attentive through Attentive's own connector and records them here.";

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
  /** The platform's own view, when it was asked. */
  providerStatus?: string | null;
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

/**
 * A failure, in words the person who pressed the button can act on.
 *
 * `label` is the platform's name rather than a fixed "Klaviyo": a company on
 * Attentive being told Klaviyo did not answer would send somebody to check the
 * wrong account.
 */
export function failure(error: unknown, label = "the sending platform"): PushResult {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  if (error instanceof SecretError) return { ok: false, error: error.message };
  if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
  if (error instanceof EspError) return { ok: false, error: error.message };
  if (error instanceof Error && error.name === "TimeoutError") {
    return { ok: false, error: `${label} did not answer within 30 seconds. Nothing was scheduled.` };
  }
  return { ok: false, error: `Could not reach ${label}.` };
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
export function resolveAudiences(
  cell: string,
  available: EspAudience[],
  /** The platform's name, so a refusal sends the person to the right screen. */
  label: string,
): { ids: string[]; names: string[] } | { error: string } {
  const wanted = cell.split(",").map((part) => part.trim()).filter(Boolean);
  const ids: string[] = [];
  const names: string[] = [];

  for (const term of wanted) {
    const byId = available.filter((a) => a.id === term);
    const byName = available.filter((a) => a.name.toLowerCase() === term.toLowerCase());
    const matches = byId.length ? byId : byName;

    if (matches.length === 0) {
      return { error: `No list or segment in ${label} is called “${term}”.` };
    }
    if (matches.length > 1) {
      // A list and a segment sharing a name is ordinary on either platform, and
      // picking one silently would send to the wrong people.
      return {
        error:
          `“${term}” matches ${matches.length} audiences in ${label} ` +
          `(${matches.map((m) => m.kind).join(" and ")}). Use its id instead of its name.`,
      };
    }
    ids.push(matches[0].id);
    names.push(`${matches[0].name} (${matches[0].kind})`);
  }

  return { ids, names };
}

interface Prepared {
  content: EspCampaignContent;
  contentHash: string;
  notes: string[];
  audienceNames: string;
}

/**
 * Everything a push needs, assembled and checked before anything is sent.
 *
 * Deliberately one function that either returns a complete, valid push or an
 * explanation: a half-finished push against a client's account leaves a
 * campaign behind that somebody has to find and delete.
 */
export async function prepare(
  companyId: string,
  rowId: string,
  templateId: string,
  mode: PushMode,
): Promise<Prepared | { error: string }> {
  const [company, row, template] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        espFromEmail: true, espFromLabel: true, espReplyTo: true,
        espTimezone: true, klaviyoBaseTemplateId: true, espAccountName: true,
        espKeyCipher: true, espAudience: true, espAudienceExclude: true,
        emailProvider: true,
      },
    }),
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId, kind: "email" } },
      select: { id: true, data: true, hiddenAt: true, sheet: { select: { columns: true } },
        approvals: { select: { templateId: true, contentHash: true, userId: true,
          user: { select: { name: true, email: true } } } } },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { id: true, name: true, updatedAt: true } }),
  ]);

  if (!company) return { error: "Company not found." };
  if (!row) return { error: "Row not found." };
  if (!template) return { error: "Template not found." };

  const providerId = isEmailProvider(company.emailProvider) ? company.emailProvider : "klaviyo";

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
      fromEmail: company.espFromEmail,
      providerBlockers: setupBlockers(providerId, company),
      providerLabel: PROVIDER_LABELS[providerId],
      timezone: company.espTimezone,
      // Attentive holds no key: it is reached through a Claude session, so
      // choosing it is the whole connection.
      connected: providerId === "attentive" || Boolean(company.espKeyCipher),
      audience: company.espAudience,
      audienceExclude: company.espAudienceExclude,
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
  else notes.push("This row has no send date, so the campaign is left undated.");

  return {
    content: {
      name: check.campaignName,
      subject: check.subject,
      previewText,
      fromEmail: company.espFromEmail!,
      fromLabel: company.espFromLabel ?? company.espAccountName ?? "",
      replyTo: company.espReplyTo ?? undefined,
      // The whole rendered document. Turning it into whatever the platform
      // actually accepts -- a block inside a template, or the body as it
      // stands -- is the provider's business, not this function's.
      html: rendered.html,
      designName: `${check.campaignName} — ${template.name}`,
      includedAudiences: [],
      excludedAudiences: [],
      sendAt: check.sendAt,
    },
    contentHash: check.contentHash,
    notes,
    audienceNames: "",
  };
}


/**
 * Write an overridden send time back to the sheet, and keep the sign-offs.
 *
 * Editing a row normally invalidates every approval on it, because the
 * fingerprint covers the whole row and almost any edit changes the email. A
 * send time usually does not: it decides when the platform mails the thing, and
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
  /** The platform's name, for the revision note left on the row. */
  label: string,
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
        note: `Send time changed while pushing to ${label}`,
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
  /** The platform's name, for the revision note left on the row. */
  label: string,
): Promise<{ note?: string } | { error: string }> {
  const [row, template, company] = await Promise.all([
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId, kind: "email" } },
      select: { id: true, data: true, sheetId: true,
        sheet: { select: { columns: true } },
        approvals: { select: { templateId: true } } },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { id: true, name: true, html: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { espTimezone: true } }),
  ]);
  if (!row) return { error: "Row not found." };
  if (!template) return { error: "Template not found." };

  const date = override.date.trim();
  const time = override.time.trim();
  if (!date && time) return { error: "A send time needs a date to go with it." };

  // Read it before writing it: a date the app cannot parse would be stored on
  // the sheet and then rejected by the push, leaving the row edited for nothing.
  const zone = company?.espTimezone ?? DEFAULT_TIMEZONE;
  if (date) {
    const when = zonedToUtc(date, time, zone);
    if (!when.utc) return { error: `“${`${date} ${time}`.trim()}” is not a date and time this can read.` };
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
    label,
  );
  if ("error" in applied) return { error: applied.error };
  return { note: applied.note };
}

/**
 * Put an approved row into the company's sending platform as a draft campaign.
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
    const provider = await providerFor(companyId);
    if (!provider) {
      const id = await providerIdFor(companyId);
      if (id === "attentive") return { ok: false, error: ATTENTIVE_HANDOFF };
      return { ok: false, error: `This company is not connected to ${PROVIDER_LABELS[id]}.` };
    }

    // An overridden send time is a sheet edit, and it happens first so that
    // everything below -- the eligibility check included -- reads one row with
    // one send time on it.
    const overrideNotes: string[] = [];
    if (override) {
      const applied = await applyOverride(
        companyId, rowId, templateId, userId, override, mode, provider.label,
      );
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
      select: { espAudience: true, espAudienceExclude: true },
    });
    // Same fallback the eligibility rule applies, so what the list offered and
    // what actually gets sent to are the same set of people.
    const audienceCell =
      (data[audienceKeys.audience] ?? "").trim() || (defaults.espAudience ?? "").trim();
    if (!audienceCell) {
      return {
        ok: false,
        error:
          `This row has no \u201c${audienceKeys.audience}\u201d and this company has no default audience, ` +
          "so there is nobody to send it to.",
      };
    }

    const available = await provider.audiences();
    const included = resolveAudiences(audienceCell, available, provider.label);
    if ("error" in included) return { ok: false, error: included.error };

    const excludeCell =
      (data[audienceKeys.exclude] ?? "").trim() || (defaults.espAudienceExclude ?? "").trim();
    const excluded = excludeCell
      ? resolveAudiences(excludeCell, available, provider.label)
      : { ids: [], names: [] };
    if ("error" in excluded) return { ok: false, error: excluded.error };

    const content: EspCampaignContent = {
      ...ready.content,
      includedAudiences: included.ids,
      excludedAudiences: excluded.ids,
    };

    // --- the campaign -----------------------------------------------------
    //
    // How the content gets in is the platform's business, and the two differ
    // completely: Klaviyo builds a template per send around it, Attentive takes
    // the HTML. Neither of those decisions is visible from here, which is the
    // point of the seam.
    const existing = await prisma.espPush.findUnique({
      where: { rowId_templateId: { rowId, templateId } },
    });
    // A campaign made on a platform this company has since moved away from is
    // not this provider's to edit. Starting fresh leaves the old one alone
    // rather than writing a Klaviyo id into an Attentive call.
    const reusable = existing && existing.provider === provider.id ? refsFrom(existing) : null;

    const done = await provider.upsertCampaign(reusable, content);

    const audienceNames = [
      ...included.names,
      ...excluded.names.map((n) => `excluding ${n}`),
    ].join(", ");

    // The point of no return, and the last thing done: everything above can be
    // undone by deleting a draft, and nothing below it can.
    if (mode === "scheduled") await provider.schedule(done.refs);

    const saved = await prisma.espPush.upsert({
      where: { rowId_templateId: { rowId, templateId } },
      create: {
        rowId, templateId, provider: provider.id,
        campaignId: done.refs.campaignId, messageId: done.refs.messageId,
        refs: JSON.stringify(done.refs.extra),
        contentHash: ready.contentHash, status: mode,
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId,
      },
      update: {
        provider: provider.id,
        campaignId: done.refs.campaignId, messageId: done.refs.messageId,
        refs: JSON.stringify(done.refs.extra),
        contentHash: ready.contentHash, status: mode,
        scheduledFor: content.sendAt, campaignName: content.name,
        audienceNames, pushedById: userId, pushedAt: new Date(),
      },
      include: { pushedBy: { select: { name: true, email: true } } },
    });

    const where = provider.label;
    return {
      ok: true,
      notes: [
        mode === "scheduled"
          ? `Scheduled in ${where}. Sending to ${audienceNames}.`
          : `Draft created in ${where}. Sending to ${audienceNames} when scheduled.`,
        ...(done.unqueued && mode !== "scheduled"
          ? [`It was scheduled in ${where} before this push, and is now back to a draft.`]
          : []),
        ...done.notes,
        ...overrideNotes,
        ...ready.notes,
      ],
      push: present(saved, ready.contentHash),
    };
  } catch (error) {
    return failure(error, PROVIDER_LABELS[await providerIdFor(companyId)]);
  }
}

/**
 * Hand the campaign to the platform's scheduler.
 *
 * The point of no return, and the only place in this app that reaches it. Kept
 * apart from the push so that putting an email into the sending platform and
 * committing to sending it are two decisions rather than one.
 */
export async function performSchedule(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<PushResult> {
  try {
    const provider = await providerFor(companyId);
    if (!provider) {
      const id = await providerIdFor(companyId);
      if (id === "attentive") return { ok: false, error: ATTENTIVE_HANDOFF };
      return { ok: false, error: `This company is not connected to ${PROVIDER_LABELS[id]}.` };
    }

    const push = await prisma.espPush.findUnique({
      where: { rowId_templateId: { rowId, templateId } },
      include: { pushedBy: { select: { name: true, email: true } } },
    });
    if (!push) {
      return { ok: false, error: `This row has not been pushed to ${provider.label} yet.` };
    }
    // Scheduling reaches into the platform the campaign actually lives in. A
    // company that has switched since has a campaign this provider cannot see,
    // and asking it to schedule one would either fail oddly or, worse, find
    // something else with that id.
    if (push.provider !== provider.id) {
      return {
        ok: false,
        error:
          `This campaign is in ${PROVIDER_LABELS[isEmailProvider(push.provider) ? push.provider : "klaviyo"]}, ` +
          `but this company now sends through ${provider.label}. Push it again to make it there.`,
      };
    }

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

    await provider.schedule(refsFrom(push));

    const saved = await prisma.espPush.update({
      where: { id: push.id },
      data: { status: "scheduled" },
      include: { pushedBy: { select: { name: true, email: true } } },
    });

    return { ok: true, push: present(saved, push.contentHash) };
  } catch (error) {
    return failure(error, PROVIDER_LABELS[await providerIdFor(companyId)]);
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

