import { prisma } from "@/lib/db";
import { approvalFingerprint, smsFingerprint } from "@/lib/fingerprint";
import { prepare, resolveAudiences } from "@/lib/push-core";
import { cachedAttentiveSegments, smsEligibility, type SmsPushMode } from "@/lib/sms-core";
import { readSmsRow, smsLabel, smsSlots } from "@/lib/sms-row";
import { audienceSlots, findAudienceColumns, findTemplateColumn, matchTemplateName } from "@/lib/template";
import { parseRecord, parseStringArray } from "@/lib/json";
import type { EspAudience } from "@/lib/esp";

/**
 * Handing approved work to a person's Claude session, for Attentive.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why this exists. Attentive's published API (docs.attentive.com, both REST
 * versions and the GraphQL beta, read November 2026) has no endpoints for
 * campaigns, messages, audiences on a campaign, or scheduling, and a private
 * app's scopes do not cover them. The only documented way to build and
 * schedule an Attentive campaign from outside its UI is Attentive's own MCP
 * server, which a person signs into with their own Attentive login, inside an
 * AI app. So this app does not call Attentive at all. Instead:
 *
 *   1. A Claude session asks this app's connector what is approved and ready
 *      (`listAttentiveHandoffs`): the rendered HTML or text, the audience as
 *      Attentive segment ids, the send time.
 *   2. It builds each one in Attentive with Attentive's MCP tools, with the
 *      person approving each write there.
 *   3. It tells this app what it made (`recordAttentiveHandoff`), which is
 *      what puts the row in the same "pushed" state a Klaviyo push would.
 *
 * And for the audience pickers, `saveAttentiveSegments` keeps a copy of the
 * segment list the session read from Attentive.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Recording is refused unless the row is still approved as it reads now, so a
 * session working from a stale list cannot mark an edited row as sent.
 */

export type HandoffChannel = "email" | "sms";

export interface HandoffAudience {
  /** Attentive segment ids, resolved from the row or the company default. */
  includeIds: string[];
  excludeIds: string[];
  /** As a person reads them, for checking before building. */
  description: string;
  /** Set when a name could not be matched to a saved segment. */
  error?: string;
}

export interface EmailHandoff {
  channel: "email";
  rowId: string;
  templateId: string;
  campaignName: string;
  subject: string;
  previewText: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  /** The complete rendered document, for Attentive's HTML email body. */
  html: string;
  sendAt: string | null;
  audience: HandoffAudience;
  /** The campaign recorded for this row before, if any, and whether the row has changed since. */
  existing: { campaignId: string; status: string; stale: boolean } | null;
}

export interface SmsHandoff {
  channel: "sms";
  rowId: string;
  campaignName: string;
  body: string;
  /** Present makes it an MMS. */
  imageUrl: string | null;
  /** Whether the copy relies on Attentive adding opt-out wording. */
  relyOnPlatformOptOut: boolean;
  sendAt: string | null;
  audience: HandoffAudience;
  existing: { campaignId: string; status: string; stale: boolean } | null;
}

export interface HandoffList {
  email: EmailHandoff[];
  sms: SmsHandoff[];
  /** Rows approved for Attentive but not ready, and why. */
  notReady: { channel: HandoffChannel; rowId: string; templateId?: string; label: string; reasons: string[] }[];
  segmentsSavedAt: string | null;
}

function audienceFor(
  includeCell: string,
  excludeCell: string,
  segments: EspAudience[],
): HandoffAudience {
  if (segments.length === 0) {
    return {
      includeIds: [],
      excludeIds: [],
      description: includeCell,
      error: "No Attentive segments are saved yet. Save them with save_attentive_segments first.",
    };
  }
  const inc = resolveAudiences(includeCell, segments, "Attentive");
  if ("error" in inc) return { includeIds: [], excludeIds: [], description: includeCell, error: inc.error };
  const exc = excludeCell.trim()
    ? resolveAudiences(excludeCell, segments, "Attentive")
    : { ids: [], names: [] };
  if ("error" in exc) return { includeIds: inc.ids, excludeIds: [], description: includeCell, error: exc.error };
  return {
    includeIds: inc.ids,
    excludeIds: exc.ids,
    description: [inc.names.join(", "), exc.names.length ? `excluding ${exc.names.join(", ")}` : ""]
      .filter(Boolean)
      .join(", "),
  };
}

/**
 * Everything approved and ready to build in Attentive, for whichever channels
 * this company sends through Attentive.
 *
 * Drafts only by default: rows already recorded as pushed and unchanged are
 * left out, so a session that runs this twice does not build things twice.
 */
export async function listAttentiveHandoffs(
  companyId: string,
  options: { includeRecorded?: boolean } = {},
): Promise<HandoffList> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      emailProvider: true,
      smsProvider: true,
      espAudience: true,
      espAudienceExclude: true,
      attentiveSegments: true,
      attentiveSegmentsSyncedAt: true,
    },
  });
  const segments = cachedAttentiveSegments(company.attentiveSegments);
  const out: HandoffList = {
    email: [],
    sms: [],
    notReady: [],
    segmentsSavedAt: company.attentiveSegmentsSyncedAt?.toISOString() ?? null,
  };

  if (company.emailProvider === "attentive") {
    const templates = await prisma.template.findMany({
      where: { companyId },
      select: { id: true, name: true, updatedAt: true },
    });
    const rows = await prisma.sheetRow.findMany({
      where: { sheet: { companyId, kind: "email" }, hiddenAt: null, approvals: { some: {} } },
      include: { sheet: { select: { columns: true } }, approvals: true, pushes: true },
    });
    for (const row of rows) {
      const columns = parseStringArray(row.sheet.columns);
      const values = parseRecord(row.data);
      const templateColumn = findTemplateColumn(columns);
      const named = templateColumn ? matchTemplateName(values[templateColumn] ?? "", templates) : null;
      // Each template a row has an approval in is a separate email.
      const approvedIn = new Set(row.approvals.map((a) => a.templateId));
      for (const template of templates.filter((t) => approvedIn.has(t.id) && (!named || named.id === t.id))) {
        const hash = approvalFingerprint(row.data, template.id, template.updatedAt);
        const pushed = row.pushes.find((p) => p.templateId === template.id && p.provider === "attentive");
        if (pushed && pushed.contentHash === hash && !options.includeRecorded) continue;

        const ready = await prepare(companyId, row.id, template.id, "draft");
        if ("error" in ready) {
          out.notReady.push({ channel: "email", rowId: row.id, templateId: template.id,
            label: values.campaign ?? values.campaign_name ?? row.id, reasons: [ready.error] });
          continue;
        }
        const slots = audienceSlots(findAudienceColumns(columns));
        const audience = audienceFor(
          (values[slots.audience] ?? "").trim() || company.espAudience || "",
          (values[slots.exclude] ?? "").trim() || company.espAudienceExclude || "",
          segments,
        );
        out.email.push({
          channel: "email",
          rowId: row.id,
          templateId: template.id,
          campaignName: ready.content.name,
          subject: ready.content.subject,
          previewText: ready.content.previewText,
          fromEmail: ready.content.fromEmail,
          fromName: ready.content.fromLabel,
          replyTo: ready.content.replyTo ?? null,
          html: ready.content.html,
          sendAt: ready.content.sendAt?.toISOString() ?? null,
          audience,
          existing: pushed ? { campaignId: pushed.campaignId, status: pushed.status, stale: pushed.contentHash !== hash } : null,
        });
      }
    }
  }

  if (company.smsProvider === "attentive") {
    const rows = await prisma.sheetRow.findMany({
      where: { sheet: { companyId, kind: "sms" }, hiddenAt: null, smsApprovals: { some: {} } },
      include: { sheet: { select: { name: true, columns: true } }, smsPush: true },
    });
    const full = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        id: true, emailProvider: true, espKeyCipher: true, espTimezone: true, smsProvider: true,
        smsKeyCipher: true, smsAudience: true, smsAudienceExclude: true, smsAddOptOut: true,
        attentiveSegments: true,
      },
    });
    for (const row of rows) {
      const sms = readSmsRow(parseRecord(row.data), smsSlots(parseStringArray(row.sheet.columns)));
      const hash = smsFingerprint(row.data);
      const pushed = row.smsPush?.provider === "attentive" ? row.smsPush : null;
      if (pushed && pushed.contentHash === hash && !options.includeRecorded) continue;

      const check = await smsEligibility(
        { company: full, row: { id: row.id, data: row.data, hiddenAt: row.hiddenAt, sheetName: row.sheet.name }, sms, hash },
        "draft",
      );
      if (check.blockers.length > 0) {
        out.notReady.push({ channel: "sms", rowId: row.id, label: smsLabel(sms), reasons: check.blockers });
        continue;
      }
      out.sms.push({
        channel: "sms",
        rowId: row.id,
        campaignName: smsLabel(sms),
        body: sms.body,
        imageUrl: sms.imageUrl || null,
        relyOnPlatformOptOut: full.smsAddOptOut,
        sendAt: check.sendAt?.toISOString() ?? null,
        audience: audienceFor(check.audienceCell, check.excludeCell, segments),
        existing: pushed ? { campaignId: pushed.campaignId, status: pushed.status, stale: pushed.contentHash !== hash } : null,
      });
    }
  }

  return out;
}

export interface RecordInput {
  channel: HandoffChannel;
  rowId: string;
  /** Required for email: the template the approved email was rendered in. */
  templateId?: string;
  /** Attentive's own campaign id, from the campaign Claude created there. */
  campaignId: string;
  /** Attentive's message id, where it gave one. */
  messageId?: string;
  status: SmsPushMode;
  /** When scheduled, the instant Attentive was told. */
  scheduledFor?: string | null;
}

export interface RecordResult {
  ok: boolean;
  error?: string;
}

/**
 * Note that Claude built this row in Attentive, so the app shows it as pushed.
 *
 * Re-checks that the row is still approved as it reads now; a session working
 * from an old list is told so rather than allowed to mark an edited row as
 * what went out.
 */
export async function recordAttentiveHandoff(
  companyId: string,
  userId: string,
  input: RecordInput,
): Promise<RecordResult> {
  const campaignId = input.campaignId.trim();
  if (!campaignId) return { ok: false, error: "Give the Attentive campaign id that was created." };
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (input.status === "scheduled") {
    if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
      return { ok: false, error: "A scheduled campaign needs the time it was scheduled for (ISO 8601)." };
    }
  }

  const list = await listAttentiveHandoffs(companyId, { includeRecorded: true });

  if (input.channel === "email") {
    if (!input.templateId) return { ok: false, error: "An email handoff needs the templateId it was rendered in." };
    const item = list.email.find((e) => e.rowId === input.rowId && e.templateId === input.templateId);
    if (!item) {
      const why = list.notReady.find((n) => n.rowId === input.rowId && n.templateId === input.templateId);
      return {
        ok: false,
        error: why
          ? `That email is not ready any more: ${why.reasons.join(" ")}`
          : "That email is not approved for Attentive as it reads now. List the handoffs again.",
      };
    }
    const template = await prisma.template.findUniqueOrThrow({ where: { id: input.templateId } });
    const row = await prisma.sheetRow.findUniqueOrThrow({ where: { id: input.rowId } });
    const record = {
      provider: "attentive",
      campaignId,
      messageId: input.messageId?.trim() || campaignId,
      refs: JSON.stringify({ handoff: "claude" }),
      contentHash: approvalFingerprint(row.data, template.id, template.updatedAt),
      status: input.status,
      scheduledFor: input.status === "scheduled" ? scheduledFor : null,
      campaignName: item.campaignName,
      audienceNames: item.audience.description,
      pushedAt: new Date(),
      pushedById: userId,
    };
    await prisma.espPush.upsert({
      where: { rowId_templateId: { rowId: input.rowId, templateId: input.templateId } },
      create: { rowId: input.rowId, templateId: input.templateId, ...record },
      update: record,
    });
    return { ok: true };
  }

  const item = list.sms.find((s) => s.rowId === input.rowId);
  if (!item) {
    const why = list.notReady.find((n) => n.channel === "sms" && n.rowId === input.rowId);
    return {
      ok: false,
      error: why
        ? `That text is not ready any more: ${why.reasons.join(" ")}`
        : "That text is not approved for Attentive as it reads now. List the handoffs again.",
    };
  }
  const row = await prisma.sheetRow.findUniqueOrThrow({ where: { id: input.rowId } });
  const record = {
    provider: "attentive",
    campaignId,
    messageId: input.messageId?.trim() || campaignId,
    refs: JSON.stringify({ handoff: "claude" }),
    contentHash: smsFingerprint(row.data),
    status: input.status,
    scheduledFor: input.status === "scheduled" ? scheduledFor : null,
    campaignName: item.campaignName,
    audienceNames: item.audience.description,
    pushedAt: new Date(),
    pushedById: userId,
  };
  await prisma.smsPush.upsert({ where: { rowId: input.rowId }, create: { rowId: input.rowId, ...record }, update: record });
  return { ok: true };
}

/**
 * Keep a copy of the company's Attentive segments, as read by Claude.
 *
 * Replaces the whole list: a segment deleted in Attentive should stop being
 * offered here, and a merge would keep it forever.
 */
export async function saveAttentiveSegments(
  companyId: string,
  segments: { id: string; name: string; kind?: string }[],
): Promise<{ ok: boolean; error?: string; saved?: number }> {
  const clean = segments
    .map((s) => ({ id: String(s.id ?? "").trim(), name: String(s.name ?? "").trim(), kind: (s.kind ?? "segment").trim() || "segment" }))
    .filter((s) => s.id && s.name);
  if (clean.length === 0) return { ok: false, error: "No segments with both an id and a name were given." };
  const ids = new Set<string>();
  for (const s of clean) {
    if (ids.has(s.id)) return { ok: false, error: `Segment id ${s.id} appears twice.` };
    ids.add(s.id);
  }
  await prisma.company.update({
    where: { id: companyId },
    data: { attentiveSegments: JSON.stringify(clean), attentiveSegmentsSyncedAt: new Date() },
  });
  return { ok: true, saved: clean.length };
}
