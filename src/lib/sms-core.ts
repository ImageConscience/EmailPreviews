import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret";
import { smsFingerprint } from "@/lib/fingerprint";
import { fetchAudiences, KlaviyoError } from "@/lib/klaviyo";
import {
  createSmsCampaign,
  fetchSmsMessageStatus,
  importImage,
  scheduleSmsMessage,
  unscheduleSmsMessage,
  updateSmsCampaign,
  type SmsCampaignContent,
  type SmsCampaignRefs,
} from "@/lib/klaviyo-sms";
import { adminIds, failure, resolveAudiences } from "@/lib/push-core";
import { checkSms } from "@/lib/sms";
import { readSmsRow, smsLabel, smsSlots, SMS_SHEET_COLUMNS, type SmsRow, type SmsSlots } from "@/lib/sms-row";
import { parseRecord, parseStringArray } from "@/lib/json";
import { DEFAULT_TIMEZONE, zonedToUtc } from "@/lib/zone";
import { PROVIDER_LABELS, type EspAudience } from "@/lib/esp";

/**
 * Text messages, from an approved row to a campaign in the client's platform.
 *
 * The email push's sibling, not an extension of it. A text has no template, no
 * subject and no sender address, and it is approved and recorded in its own
 * tables (SmsApproval, SmsPush), so nothing here can make an email's approval
 * stale or mistake a text's campaign for an email's.
 *
 * Klaviyo is pushed to directly. Attentive is not: its documented API has no
 * campaigns, so an Attentive text is handed to a person's Claude session, which
 * builds it through Attentive's MCP server and records what it made with the
 * connector. `performSmsPush` refuses an Attentive company in so many words
 * rather than pretending.
 */

export const SMS_PROVIDERS = ["klaviyo", "attentive"] as const;
export type SmsProviderId = (typeof SMS_PROVIDERS)[number];

export function isSmsProvider(value: string | null | undefined): value is SmsProviderId {
  return (SMS_PROVIDERS as readonly string[]).includes(value ?? "");
}

export type SmsPushMode = "draft" | "scheduled";

interface CompanySms {
  id: string;
  emailProvider: string;
  espKeyCipher: string | null;
  espTimezone: string | null;
  smsProvider: string | null;
  smsKeyCipher: string | null;
  smsAudience: string | null;
  smsAudienceExclude: string | null;
  smsAddOptOut: boolean;
  attentiveSegments: string | null;
}

const COMPANY_SMS = {
  id: true,
  emailProvider: true,
  espKeyCipher: true,
  espTimezone: true,
  smsProvider: true,
  smsKeyCipher: true,
  smsAudience: true,
  smsAudienceExclude: true,
  smsAddOptOut: true,
  attentiveSegments: true,
} as const;

/**
 * The Klaviyo key texts go out with, or null.
 *
 * Its own key when one was given; otherwise the email key, but only when the
 * email also goes to Klaviyo -- an Attentive company's email key (it has none
 * now, but did) must never be sent to Klaviyo.
 */
export function smsKlaviyoKey(company: Pick<CompanySms, "smsKeyCipher" | "espKeyCipher" | "emailProvider">): string | null {
  if (company.smsKeyCipher) return decryptSecret(company.smsKeyCipher);
  if (company.emailProvider === "klaviyo" && company.espKeyCipher) return decryptSecret(company.espKeyCipher);
  return null;
}

/** Whether texting is set up far enough to list audiences and push. */
export function smsConnected(company: Pick<CompanySms, "smsProvider" | "smsKeyCipher" | "espKeyCipher" | "emailProvider" | "attentiveSegments">): boolean {
  if (company.smsProvider === "klaviyo") {
    return Boolean(company.smsKeyCipher || (company.emailProvider === "klaviyo" && company.espKeyCipher));
  }
  return company.smsProvider === "attentive";
}

/** Attentive's segments as last saved through the connector. */
export function cachedAttentiveSegments(raw: string | null): EspAudience[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
      .map((s) => ({
        id: String(s.id ?? ""),
        name: String(s.name ?? "").trim(),
        kind: String(s.kind ?? "segment"),
      }))
      .filter((s) => s.id && s.name);
  } catch {
    return [];
  }
}

/**
 * Who a company can text, from wherever its platform keeps that.
 *
 * Klaviyo is asked live. Attentive is read from the copy a Claude session last
 * saved, since this app holds no Attentive key; `syncedAt` says how old it is.
 */
export async function smsAudiences(companyId: string): Promise<{
  audiences: EspAudience[];
  source: SmsProviderId | null;
  syncedAt: Date | null;
}> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ...COMPANY_SMS, attentiveSegmentsSyncedAt: true },
  });
  if (!company || !isSmsProvider(company.smsProvider)) return { audiences: [], source: null, syncedAt: null };

  if (company.smsProvider === "attentive") {
    return {
      audiences: cachedAttentiveSegments(company.attentiveSegments),
      source: "attentive",
      syncedAt: company.attentiveSegmentsSyncedAt,
    };
  }
  const key = smsKlaviyoKey(company);
  if (!key) return { audiences: [], source: "klaviyo", syncedAt: null };
  return { audiences: await fetchAudiences(key), source: "klaviyo", syncedAt: new Date() };
}

/* ------------------------------------------------------------- reading */

export interface TextState {
  rowId: string;
  sheetId: string;
  sheetName: string;
  position: number;
  values: Record<string, string>;
  /** Which header of this row's sheet holds each field, for saving edits back. */
  slots: SmsSlots;
  sms: SmsRow;
  label: string;
  hidden: boolean;
  approvals: { userId: string; name: string; current: boolean; admin: boolean; at: string }[];
  push: {
    provider: string;
    campaignId: string;
    campaignName: string;
    status: string;
    scheduledFor: string | null;
    audienceNames: string;
    pushedAt: string;
    stale: boolean;
  } | null;
}

/** Every text row a company has, with its sign-offs and what has been pushed. */
export async function listTexts(companyId: string): Promise<TextState[]> {
  const sheets = await prisma.contentSheet.findMany({
    where: { companyId, kind: "sms" },
    orderBy: { createdAt: "asc" },
    include: {
      rows: {
        orderBy: { position: "asc" },
        include: {
          smsApprovals: { include: { user: { select: { id: true, name: true, email: true } } } },
          smsPush: true,
        },
      },
    },
  });

  const approverIds = sheets.flatMap((s) => s.rows.flatMap((r) => r.smsApprovals.map((a) => a.userId)));
  const admins = await adminIds(companyId, approverIds);

  const out: TextState[] = [];
  for (const sheet of sheets) {
    const slots = smsSlots(parseStringArray(sheet.columns));
    for (const row of sheet.rows) {
      const values = parseRecord(row.data);
      const sms = readSmsRow(values, slots);
      const hash = smsFingerprint(row.data);
      out.push({
        rowId: row.id,
        sheetId: sheet.id,
        sheetName: sheet.name,
        position: row.position,
        values,
        slots,
        sms,
        label: smsLabel(sms),
        hidden: Boolean(row.hiddenAt),
        approvals: row.smsApprovals.map((a) => ({
          userId: a.userId,
          name: a.user.name || a.user.email,
          current: a.contentHash === hash,
          admin: admins.has(a.userId),
          at: a.createdAt.toISOString(),
        })),
        push: row.smsPush
          ? {
              provider: row.smsPush.provider,
              campaignId: row.smsPush.campaignId,
              campaignName: row.smsPush.campaignName,
              status: row.smsPush.status,
              scheduledFor: row.smsPush.scheduledFor?.toISOString() ?? null,
              audienceNames: row.smsPush.audienceNames,
              pushedAt: row.smsPush.pushedAt.toISOString(),
              stale: row.smsPush.contentHash !== hash,
            }
          : null,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------- approving */

export interface SmsApprovalResult {
  ok: boolean;
  error?: string;
  approved?: boolean;
}

/**
 * Approve this text as it now reads, or withdraw an approval that is current.
 *
 * The same three-way toggle as email: current → withdrawn, stale → renewed,
 * none → given. Withdrawing is refused once the text sits in a platform as a
 * draft or a scheduled send, because the approval is what that send rests on.
 */
export async function toggleSmsApproval(
  companyId: string,
  rowId: string,
  userId: string,
): Promise<SmsApprovalResult> {
  const row = await prisma.sheetRow.findFirst({
    where: { id: rowId, sheet: { companyId, kind: "sms" } },
    include: { smsPush: true },
  });
  if (!row) return { ok: false, error: "No such text." };

  const hash = smsFingerprint(row.data);
  const mine = await prisma.smsApproval.findUnique({ where: { rowId_userId: { rowId, userId } } });

  if (mine && mine.contentHash === hash) {
    if (row.smsPush && row.smsPush.contentHash === hash) {
      return {
        ok: false,
        error:
          "This text is already in the sending platform as it reads now, so its approval cannot " +
          "be withdrawn here. Change it in the platform, or edit the text and push again.",
      };
    }
    await prisma.smsApproval.delete({ where: { id: mine.id } });
    return { ok: true, approved: false };
  }

  await prisma.smsApproval.upsert({
    where: { rowId_userId: { rowId, userId } },
    create: { rowId, userId, contentHash: hash },
    update: { contentHash: hash, createdAt: new Date() },
  });
  return { ok: true, approved: true };
}

/* ---------------------------------------------------------- eligibility */

export interface SmsEligibility {
  /** Things that stop a push, in words for whoever has to fix them. */
  blockers: string[];
  warnings: string[];
  /** The instant it would go out, when the row says one. */
  sendAt: Date | null;
  audienceCell: string;
  excludeCell: string;
}

interface Loaded {
  company: CompanySms;
  row: { id: string; data: string; hiddenAt: Date | null; sheetName: string };
  sms: SmsRow;
  hash: string;
}

async function load(companyId: string, rowId: string): Promise<Loaded | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: COMPANY_SMS });
  const row = await prisma.sheetRow.findFirst({
    where: { id: rowId, sheet: { companyId, kind: "sms" } },
    include: { sheet: { select: { name: true, columns: true } } },
  });
  if (!company || !row) return null;
  const sms = readSmsRow(parseRecord(row.data), smsSlots(parseStringArray(row.sheet.columns)));
  return {
    company,
    row: { id: row.id, data: row.data, hiddenAt: row.hiddenAt, sheetName: row.sheet.name },
    sms,
    hash: smsFingerprint(row.data),
  };
}

/**
 * Start a text, with as much or as little of it as the caller knows.
 *
 * One place for it, because there are three ways in now -- the Texts page, the
 * overview's "+ New", and the connector -- and each of them would otherwise
 * have to know where a company keeps its texts, what a text sheet's columns
 * are called, and which of them this one happens to use.
 *
 * Access is the caller's to check: a session has one answer for that and a
 * token has another, and this knows about neither.
 */
export interface NewText {
  sheetId?: string;
  name?: string;
  body?: string;
  imageUrl?: string;
  sendDate?: string;
  sendTime?: string;
  audience?: string;
  exclude?: string;
}

export async function createText(
  userId: string,
  companyId: string,
  input: NewText = {},
): Promise<{ rowId: string; sheetId: string }> {
  let sheet = input.sheetId
    ? await prisma.contentSheet.findFirst({ where: { id: input.sheetId, companyId, kind: "sms" } })
    : await prisma.contentSheet.findFirst({ where: { companyId, kind: "sms" }, orderBy: { createdAt: "desc" } });
  if (!sheet) {
    sheet = await prisma.contentSheet.create({
      data: {
        companyId,
        name: "Texts added in app",
        kind: "sms",
        columns: JSON.stringify(SMS_SHEET_COLUMNS),
      },
    });
  }
  const slots = smsSlots(parseStringArray(sheet.columns));
  const last = await prisma.sheetRow.findFirst({
    where: { sheetId: sheet.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  // A send time with no date is not a time, so it is dropped rather than
  // written for the eligibility check to refuse later.
  const sendDate = (input.sendDate ?? "").trim();
  const sendTime = sendDate ? (input.sendTime ?? "").trim() : "";
  const put = (key: string, value: string | undefined) =>
    (value ?? "").trim() ? { [key]: (value ?? "").trim() } : {};

  const row = await prisma.sheetRow.create({
    data: {
      sheetId: sheet.id,
      position: (last?.position ?? -1) + 1,
      data: JSON.stringify({
        [slots.name]: (input.name ?? "").trim() || "New text",
        // Written whether or not it has anything in it, so the column exists
        // and the Texts page has a box to type the message into.
        [slots.body]: input.body ?? "",
        ...put(slots.image, input.imageUrl),
        ...(sendDate ? { [slots.sendDate]: sendDate } : {}),
        ...(sendTime ? { [slots.sendTime]: sendTime } : {}),
        ...put(slots.audience, input.audience),
        ...put(slots.exclude, input.exclude),
      }),
      createdById: userId,
    },
  });
  return { rowId: row.id, sheetId: sheet.id };
}

/**
 * What a write to this text would cost, before it happens.
 *
 * The text-shaped twin of `writeRisk`: an approval covers the whole row, so any
 * edit withdraws it, which is fine when a person is watching the screen change
 * and not fine when something reaches in over the connector and nobody sees.
 */
export interface SmsWriteRisk {
  /** "draft" or "scheduled" once it is in the platform, else null. */
  published: "draft" | "scheduled" | null;
  /** Which platform it is in, by name, read from the push rather than the company. */
  publishedIn: string | null;
  /** People whose current sign-off this write would silently withdraw. */
  wouldUnapprove: string[];
}

export async function smsWriteRisk(rowId: string): Promise<SmsWriteRisk> {
  const row = await prisma.sheetRow.findUnique({
    where: { id: rowId },
    include: {
      smsPush: { select: { status: true, provider: true } },
      smsApprovals: { include: { user: { select: { name: true, email: true } } } },
    },
  });
  if (!row) return { published: null, publishedIn: null, wouldUnapprove: [] };

  const hash = smsFingerprint(row.data);
  const status = row.smsPush?.status;
  return {
    published: status === "scheduled" || status === "draft" ? status : null,
    publishedIn: row.smsPush
      ? (isSmsProvider(row.smsPush.provider) ? PROVIDER_LABELS[row.smsPush.provider] : row.smsPush.provider)
      : null,
    wouldUnapprove: [
      ...new Set(
        row.smsApprovals
          .filter((a) => a.contentHash === hash)
          .map((a) => a.user.name ?? a.user.email),
      ),
    ],
  };
}

/**
 * What stands between this text and a push, for a caller that has only ids.
 *
 * `smsEligibility` wants a row already loaded, which the push has and nobody
 * else does. This is the way in for anything asking "could this go?" -- the
 * connector, mainly -- without duplicating a word of the rules.
 */
export async function textReadiness(
  companyId: string,
  rowId: string,
  mode: SmsPushMode = "draft",
): Promise<SmsEligibility | null> {
  const loaded = await load(companyId, rowId);
  if (!loaded) return null;
  return smsEligibility(loaded, mode);
}

/** What stands between this text and a push. Pure apart from the role lookup. */
export async function smsEligibility(
  loaded: Loaded,
  mode: SmsPushMode,
  now = new Date(),
): Promise<SmsEligibility> {
  const { company, row, sms, hash } = loaded;
  const blockers: string[] = [];

  if (row.hiddenAt) blockers.push("This text is hidden.");

  const copy = checkSms({ body: sms.body, imageUrl: sms.imageUrl, platformAddsOptOut: company.smsAddOptOut });
  blockers.push(...copy.problems);

  const approvals = await prisma.smsApproval.findMany({ where: { rowId: row.id } });
  const admins = await adminIds(company.id, approvals.map((a) => a.userId));
  const signedOff = approvals.some((a) => a.contentHash === hash && admins.has(a.userId));
  if (!signedOff) {
    blockers.push(
      approvals.some((a) => a.contentHash !== hash)
        ? "It has been edited since it was approved. An admin needs to approve it again."
        : "No admin has approved this text yet.",
    );
  }

  const audienceCell = sms.audience || company.smsAudience || "";
  const excludeCell = sms.exclude || company.smsAudienceExclude || "";
  if (!audienceCell.trim()) {
    blockers.push("It has no audience, and the company has no default audience for texts.");
  }

  const zone = company.espTimezone || DEFAULT_TIMEZONE;
  let sendAt: Date | null = null;
  if (sms.sendDate) {
    const at = zonedToUtc(sms.sendDate, sms.sendTime || "00:00", zone);
    if (!at.utc) {
      blockers.push(
        `“${`${sms.sendDate} ${sms.sendTime}`.trim()}” is not a date and time this can schedule ` +
          "(use yyyy-mm-dd and HH:MM).",
      );
    }
    else sendAt = at.utc;
    if (at.warning) copy.warnings.push(at.warning);
  }
  if (mode === "scheduled") {
    if (!sendAt) blockers.push("It has no send date and time to schedule it for.");
    else if (sendAt.getTime() <= now.getTime()) blockers.push("Its send time has already passed.");
  }

  return { blockers, warnings: copy.warnings, sendAt, audienceCell, excludeCell };
}

/* -------------------------------------------------------------- pushing */

export interface SmsPushResult {
  ok: boolean;
  error?: string;
  blockers?: string[];
  notes?: string[];
  status?: string;
}

/**
 * Put one approved text into the company's Klaviyo, as a draft or scheduled.
 *
 * Either completes or explains; checks everything it can before the first
 * call, so a refusal leaves nothing behind in the client's account.
 */
export async function performSmsPush(
  companyId: string,
  rowId: string,
  userId: string,
  mode: SmsPushMode,
): Promise<SmsPushResult> {
  try {
    const loaded = await load(companyId, rowId);
    if (!loaded) return { ok: false, error: "No such text." };
    const { company, sms, hash } = loaded;

    if (company.smsProvider === "attentive") {
      return {
        ok: false,
        error:
          "This company texts through Attentive, which this app cannot reach directly. Ask Claude " +
          "to hand it off: it builds the campaign in Attentive and records it here.",
      };
    }
    if (company.smsProvider !== "klaviyo") {
      return { ok: false, error: "No platform is chosen for this company's texts. Set one under Integrations." };
    }
    const key = smsKlaviyoKey(company);
    if (!key) {
      return { ok: false, error: "There is no Klaviyo key for texts. Connect one under Integrations." };
    }

    const check = await smsEligibility(loaded, mode);
    if (check.blockers.length > 0) return { ok: false, blockers: check.blockers };

    const available = await fetchAudiences(key);
    const included = resolveAudiences(check.audienceCell, available, "Klaviyo");
    if ("error" in included) return { ok: false, error: included.error };
    const excluded = check.excludeCell.trim()
      ? resolveAudiences(check.excludeCell, available, "Klaviyo")
      : { ids: [], names: [] };
    if ("error" in excluded) return { ok: false, error: excluded.error };

    const notes = [...check.warnings];
    const name = smsLabel(sms);
    const existing = await prisma.smsPush.findUnique({ where: { rowId } });
    const prior = existing?.provider === "klaviyo" ? parseRecord(existing.refs) : null;

    // The image is copied into Klaviyo once per URL, not once per push.
    let imageAssetId: string | null = null;
    if (sms.imageUrl) {
      imageAssetId =
        prior?.imageUrl === sms.imageUrl && prior.imageAssetId
          ? prior.imageAssetId
          : await importImage(key, sms.imageUrl, `${name} (MMS)`);
    }

    const content: SmsCampaignContent = {
      name,
      body: sms.body,
      imageAssetId,
      includedAudiences: included.ids,
      excludedAudiences: excluded.ids,
      addOptOutLanguage: company.smsAddOptOut,
      timezone: company.espTimezone || DEFAULT_TIMEZONE,
    };

    let refs: SmsCampaignRefs | null =
      existing && prior?.audienceId && prior.variationId
        ? {
            campaignId: existing.campaignId,
            messageId: existing.messageId,
            audienceId: prior.audienceId,
            variationId: prior.variationId,
          }
        : null;

    if (refs) {
      let status = await fetchSmsMessageStatus(key, refs.messageId);
      if (status === "scheduled" && prior?.scheduleId) {
        await unscheduleSmsMessage(key, prior.scheduleId);
        notes.push("It was waiting to send, so it was taken out of the queue to be updated.");
        status = await fetchSmsMessageStatus(key, refs.messageId);
      }
      if (status !== "draft") {
        // Sent, sending, cancelled, gone, or not back to draft after
        // unscheduling: nothing here can be safely written to, so start again.
        if (status) notes.push(`The earlier campaign is ${status} in Klaviyo, so a new one was made.`);
        refs = null;
      }
    }

    if (refs) await updateSmsCampaign(key, refs, content);
    else refs = await createSmsCampaign(key, content);

    let scheduleId: string | null = null;
    if (mode === "scheduled" && check.sendAt) {
      scheduleId = await scheduleSmsMessage(key, refs.messageId, check.sendAt);
    }

    const audienceNames = [
      included.names.join(", "),
      excluded.names.length ? `excluding ${excluded.names.join(", ")}` : "",
    ].filter(Boolean).join(", ");

    const record = {
      provider: "klaviyo",
      campaignId: refs.campaignId,
      messageId: refs.messageId,
      refs: JSON.stringify({
        audienceId: refs.audienceId,
        variationId: refs.variationId,
        ...(scheduleId ? { scheduleId } : {}),
        ...(sms.imageUrl && imageAssetId ? { imageUrl: sms.imageUrl, imageAssetId } : {}),
      }),
      contentHash: hash,
      status: mode,
      scheduledFor: mode === "scheduled" ? check.sendAt : null,
      campaignName: name,
      audienceNames,
      pushedAt: new Date(),
      pushedById: userId,
    };
    await prisma.smsPush.upsert({ where: { rowId }, create: { rowId, ...record }, update: record });

    return { ok: true, notes, status: mode };
  } catch (error) {
    if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
    return failure(error, "Klaviyo");
  }
}

/** Take a scheduled Klaviyo text back to draft. */
export async function performSmsUnschedule(companyId: string, rowId: string): Promise<SmsPushResult> {
  try {
    const loaded = await load(companyId, rowId);
    if (!loaded) return { ok: false, error: "No such text." };
    const push = await prisma.smsPush.findUnique({ where: { rowId } });
    if (!push || push.status !== "scheduled") return { ok: false, error: "This text is not scheduled." };
    if (push.provider !== "klaviyo") {
      return { ok: false, error: "This text was scheduled in Attentive. Unschedule it there, or ask Claude to." };
    }
    const key = smsKlaviyoKey(loaded.company);
    if (!key) return { ok: false, error: "There is no Klaviyo key for texts any more." };
    const refs = parseRecord(push.refs);
    if (!refs.scheduleId) return { ok: false, error: "No schedule was recorded for this text, so it cannot be taken back here." };

    await unscheduleSmsMessage(key, refs.scheduleId);
    const status = await fetchSmsMessageStatus(key, push.messageId);
    const { scheduleId: _gone, ...rest } = refs;
    void _gone;
    await prisma.smsPush.update({
      where: { rowId },
      data: { status: "draft", scheduledFor: null, refs: JSON.stringify(rest) },
    });
    return {
      ok: true,
      status: "draft",
      notes: status && status !== "draft" ? [`Klaviyo now reports it as ${status}; check it there.`] : [],
    };
  } catch (error) {
    if (error instanceof KlaviyoError) return { ok: false, error: error.detail };
    return failure(error, "Klaviyo");
  }
}

/**
 * Why this row may not be changed or removed from a sheet screen, or null.
 *
 * Only a scheduled text is protected: the platform will send what it holds at
 * the time it holds, so an edit here would make the app show words that are
 * not the ones going out -- and deleting the row would delete the only record
 * of that send. Emails have their own rules; a row that is not a text passes.
 */
export async function scheduledTextGuard(rowId: string): Promise<string | null> {
  const push = await prisma.smsPush.findUnique({ where: { rowId }, select: { status: true } });
  if (push?.status !== "scheduled") return null;
  return "This text is scheduled to send. Unschedule it on the Texts page before changing or removing it.";
}
