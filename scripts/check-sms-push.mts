/**
 * Texts, end to end, against the stand-in Klaviyo.
 *
 * The mock answers SMS calls only at revision 2026-10-15, the revision the
 * client was written against (see the header of src/lib/klaviyo-sms.ts), and
 * enforces what that reference implies: a variation or audience can only be
 * edited while the message is a draft, a schedule must be in the future, and
 * an MMS image must already be in the account. So a pass here means the calls
 * are the documented ones in the documented order -- not that the mock agrees
 * with itself.
 *
 * Also covered: approval and staleness, the scheduled-text edit guard, the
 * opt-out rule, Attentive's refusal (it is handed off through Claude), and that
 * none of this reaches the email side.
 */
process.env.KLAVIYO_API_BASE = "http://127.0.0.1:4599/api";

import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/secret.ts";
import { applyFields } from "../src/lib/compose.ts";
import { performPush } from "../src/lib/push-core.ts";
import {
  listTexts,
  performSmsPush,
  performSmsUnschedule,
  scheduledTextGuard,
  toggleSmsApproval,
} from "../src/lib/sms-core.ts";
import { SMS_SHEET_COLUMNS } from "../src/lib/sms-row.ts";

const prisma = new PrismaClient();
const KEY = "pk_live_testkey0000000000000000000000ab";
const MOCK = "http://127.0.0.1:4599";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

interface SmsState {
  calls: string[];
  sms: {
    campaigns: { id: string; definition: { name: string } }[];
    messages: { id: string; campaignId: string; status: string }[];
    audiences: { id: string; included: string[]; excluded: string[] }[];
    variations: { id: string; messageId: string; details: Record<string, unknown> }[];
    schedules: { id: string; messageId: string; sendTime: string }[];
    images: { id: string; url: string; hidden: boolean }[];
  };
}
const state = async () => (await fetch(`${MOCK}/__state`)).json() as Promise<SmsState>;

try {
  await fetch(`${MOCK}/__reset`);
} catch {
  console.error("No mock Klaviyo on 4599. Start it with: npm run klaviyo:mock");
  process.exit(1);
}

// --- a company that mails and texts through one Klaviyo -------------------
const company = await prisma.company.findFirstOrThrow({ where: { name: "Acme Retail" } });
const before = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
const user = await prisma.user.findFirstOrThrow({ where: { email: "demo@example.com" } });
await prisma.membership.update({
  where: { userId_companyId: { userId: user.id, companyId: company.id } },
  data: { role: "admin" },
});
await prisma.company.update({
  where: { id: company.id },
  data: {
    emailProvider: "klaviyo",
    espKeyCipher: encryptSecret(KEY),
    espTimezone: "America/New_York",
    smsProvider: "klaviyo",
    smsKeyCipher: null,
    smsAudience: "Engaged 90 days",
    smsAudienceExclude: "VIP",
    smsAddOptOut: true,
  },
});

await prisma.contentSheet.deleteMany({ where: { companyId: company.id, name: "SMS push test" } });
const nextYear = new Date().getUTCFullYear() + 1;
const sheet = await prisma.contentSheet.create({
  data: {
    companyId: company.id,
    name: "SMS push test",
    kind: "sms",
    columns: JSON.stringify(SMS_SHEET_COLUMNS),
    rows: {
      create: [
        { position: 0, data: JSON.stringify({ campaign: "Flash sale", send_date: `${nextYear}-06-10`, send_time: "10:00", body: "Flash sale today only: 30% off everything." }) },
        { position: 1, data: JSON.stringify({ campaign: "New drop", send_date: `${nextYear}-03-11`, send_time: "11:30", body: "The spring drop is here.", image: "https://cdn.example.com/spring.jpg" }) },
        { position: 2, data: JSON.stringify({ campaign: "Last year", send_date: "2020-01-01", send_time: "09:00", body: "Too late." }) },
      ],
    },
  },
  include: { rows: { orderBy: { position: "asc" } } },
});
const [plain, mms, past] = sheet.rows;

console.log("Before approval");
{
  const r = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("an unapproved text is refused", !r.ok && (r.blockers ?? []).some((b) => /approved/.test(b)), JSON.stringify(r.blockers));
  check("...and nothing was made in Klaviyo", (await state()).sms.campaigns.length === 0);
}

console.log("\nPush as a draft");
{
  const a = await toggleSmsApproval(company.id, plain.id, user.id);
  check("an admin approves it", a.ok && a.approved === true);
  const r = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("the push succeeds", r.ok, r.error ?? JSON.stringify(r.blockers));
  const s = await state();
  check("one SMS campaign exists", s.sms.campaigns.length === 1);
  const v = s.sms.variations[0];
  check("the body is on the variation", v?.details.body === "Flash sale today only: 30% off everything.");
  check("it is an SMS, not an MMS", v?.details.text_message_type === "SMS");
  check("opt-out wording is requested", v?.details.add_opt_out_language === true);
  check("the default audience and exclusion resolved to ids",
    s.sms.audiences[0]?.included.join() === "S1" && s.sms.audiences[0]?.excluded.join() === "S2",
    JSON.stringify(s.sms.audiences[0]));
  check("no email campaign was touched", s.calls.every((c) => !c.includes("assign-template") && !c.startsWith("POST /templates")));
  const push = await prisma.smsPush.findUniqueOrThrow({ where: { rowId: plain.id } });
  check("the push is recorded as a draft", push.status === "draft" && push.provider === "klaviyo");
  check("...with where it went", /Engaged 90 days \(segment\)/.test(push.audienceNames) && /excluding VIP/.test(push.audienceNames), push.audienceNames);
}

console.log("\nEdit, and the approval goes stale");
{
  await applyFields(user.id, plain.id, { body: "Flash sale today only: 40% off everything." });
  const r = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("the edited text is refused until approved again", !r.ok && (r.blockers ?? []).some((b) => /edited since/.test(b)), JSON.stringify(r.blockers));
  const texts = await listTexts(company.id);
  const t = texts.find((x) => x.rowId === plain.id);
  check("the list shows the push as out of date", t?.push?.stale === true);
  await toggleSmsApproval(company.id, plain.id, user.id);
  const again = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("pushing again succeeds", again.ok, again.error);
  const s = await state();
  check("...into the same campaign, not a second one", s.sms.campaigns.length === 1);
  check("...with the new words", s.sms.variations[0]?.details.body === "Flash sale today only: 40% off everything.");
}

console.log("\nSchedule, and what a schedule protects");
{
  const r = await performSmsPush(company.id, plain.id, user.id, "scheduled");
  check("scheduling succeeds", r.ok, r.error ?? JSON.stringify(r.blockers));
  const s = await state();
  check("Klaviyo holds one schedule", s.sms.schedules.length === 1);
  check("...for the sheet's time in New York (EDT in June)", s.sms.schedules[0]?.sendTime === `${nextYear}-06-10T14:00:00.000Z`, s.sms.schedules[0]?.sendTime);
  check("the message is scheduled", s.sms.messages[0]?.status === "scheduled");
  check("a scheduled text cannot be edited from a sheet", Boolean(await scheduledTextGuard(plain.id)));
  check("an email row is not guarded by it", (await scheduledTextGuard("not-a-text")) === null);

  const draft = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("pushing it as a draft takes it out of the queue first", draft.ok && (draft.notes ?? []).some((n) => /out of the queue/.test(n)), JSON.stringify(draft));
  const s2 = await state();
  check("...and Klaviyo has it as a draft again", s2.sms.messages[0]?.status === "draft" && s2.sms.schedules.length === 0);
  check("...still the same campaign", s2.sms.campaigns.length === 1);

  await performSmsPush(company.id, plain.id, user.id, "scheduled");
  const un = await performSmsUnschedule(company.id, plain.id);
  check("unscheduling succeeds", un.ok, un.error);
  const after = await prisma.smsPush.findUniqueOrThrow({ where: { rowId: plain.id } });
  check("...and is recorded", after.status === "draft" && after.scheduledFor === null && !JSON.parse(after.refs).scheduleId);
  check("...and Klaviyo agrees", (await state()).sms.messages[0]?.status === "draft");
}

console.log("\nMMS");
{
  await toggleSmsApproval(company.id, mms.id, user.id);
  const r = await performSmsPush(company.id, mms.id, user.id, "draft");
  check("an MMS pushes", r.ok, r.error ?? JSON.stringify(r.blockers));
  let s = await state();
  check("the image was copied into Klaviyo, hidden from the library",
    s.sms.images.length === 1 && s.sms.images[0].url === "https://cdn.example.com/spring.jpg" && s.sms.images[0].hidden === true);
  const v = s.sms.variations.find((x) => x.details.body === "The spring drop is here.");
  check("the variation is an MMS carrying that image",
    v?.details.text_message_type === "MMS" && String(v?.details.mms_static_image_asset_id) === s.sms.images[0]?.id, JSON.stringify(v?.details));
  await performSmsPush(company.id, mms.id, user.id, "draft");
  s = await state();
  check("pushing again does not copy the same image twice", s.sms.images.length === 1);
}

console.log("\nAfter it has gone out");
{
  const push = await prisma.smsPush.findUniqueOrThrow({ where: { rowId: plain.id } });
  await fetch(`${MOCK}/__sms-status?message=${push.messageId}&status=sent`);
  const r = await performSmsPush(company.id, plain.id, user.id, "draft");
  check("a sent text is not written to; a new campaign is made", r.ok && (r.notes ?? []).some((n) => /sent in Klaviyo/.test(n)), JSON.stringify(r));
  const s = await state();
  check("...so there are now two text campaigns for these rows plus the MMS", s.sms.campaigns.length === 3, String(s.sms.campaigns.length));
}

console.log("\nRefusals");
{
  await toggleSmsApproval(company.id, past.id, user.id);
  const r = await performSmsPush(company.id, past.id, user.id, "scheduled");
  check("a send time in the past cannot be scheduled", !r.ok && (r.blockers ?? []).some((b) => /already passed/.test(b)), JSON.stringify(r.blockers));
  const d = await performSmsPush(company.id, past.id, user.id, "draft");
  check("...but it can still be a draft", d.ok, d.error);

  await prisma.company.update({ where: { id: company.id }, data: { smsAddOptOut: false } });
  await applyFields(user.id, past.id, { send_date: `${nextYear}-04-01` });
  await toggleSmsApproval(company.id, past.id, user.id);
  const o = await performSmsPush(company.id, past.id, user.id, "draft");
  check("without platform opt-out wording, copy without STOP is refused", !o.ok && (o.blockers ?? []).some((b) => /how to stop/.test(b)), JSON.stringify(o.blockers));
  await prisma.company.update({ where: { id: company.id }, data: { smsAddOptOut: true } });

  await prisma.company.update({ where: { id: company.id }, data: { smsProvider: "attentive" } });
  const at = await performSmsPush(company.id, past.id, user.id, "draft");
  check("an Attentive company is told to hand off through Claude", !at.ok && /Claude/.test(at.error ?? ""), at.error);
  await prisma.company.update({ where: { id: company.id }, data: { smsProvider: null } });
  const none = await performSmsPush(company.id, past.id, user.id, "draft");
  check("a company with no texting platform is told to choose one", !none.ok && /No platform/.test(none.error ?? ""), none.error);
  await prisma.company.update({ where: { id: company.id }, data: { smsProvider: "klaviyo" } });

  const anyTemplate = await prisma.template.findFirst({ where: { companyId: company.id } });
  if (anyTemplate) {
    const e = await performPush(company.id, plain.id, anyTemplate.id, user.id, "draft");
    check("the email push will not take a text row", !e.ok, e.error);
  }
}

// --- leave the company as it was --------------------------------------------
await prisma.contentSheet.delete({ where: { id: sheet.id } });
await prisma.company.update({
  where: { id: company.id },
  data: {
    emailProvider: before.emailProvider,
    espKeyCipher: before.espKeyCipher,
    espTimezone: before.espTimezone,
    smsProvider: before.smsProvider,
    smsKeyCipher: before.smsKeyCipher,
    smsAudience: before.smsAudience,
    smsAudienceExclude: before.smsAudienceExclude,
    smsAddOptOut: before.smsAddOptOut,
  },
});
await prisma.$disconnect();

if (bad) {
  console.log(`\n${bad} SMS PUSH CHECK${bad === 1 ? "" : "S"} FAILED`);
  process.exit(1);
}
console.log("\nALL SMS PUSH CHECKS PASSED");
