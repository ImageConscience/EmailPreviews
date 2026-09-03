/**
 * The push, end to end, against a stand-in Klaviyo.
 *
 * Exercises the shape of the real thing: a base template with two HTML blocks
 * where only one carries the marker, the approval gate, the audience column,
 * and the failures that must not leave a stray campaign or template behind.
 */
process.env.KLAVIYO_API_BASE = "http://127.0.0.1:4599/api";

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/secret.ts";
import { approvalFingerprint } from "../src/lib/fingerprint.ts";
import { performPush, performSchedule } from "../src/lib/push-core.ts";
import { checkEligibility } from "../src/lib/push-eligibility.ts";
import { publishedState, publishedFromStatus } from "../src/lib/published.ts";

const prisma = new PrismaClient();
const KEY = "pk_live_testkey0000000000000000000000ab";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};
const state = async () => (await fetch("http://127.0.0.1:4599/__state")).json() as Promise<{
  templates: { id: string; name: string; definition: unknown }[];
  campaigns: { id: string; attributes: Record<string, unknown>; templateId: string | null; status: string }[];
  sendJobs: unknown[];
}>;

await fetch("http://127.0.0.1:4599/__reset");

// --- a company, a template, a sheet, a row ------------------------------
const company = await prisma.company.findFirstOrThrow({ where: { name: "Acme Retail" } });
const user = await prisma.user.findFirstOrThrow({ where: { email: "demo@example.com" } });
await prisma.company.update({
  where: { id: company.id },
  data: {
    klaviyoKeyCipher: encryptSecret(KEY), klaviyoKeyHint: "••••00ab",
    klaviyoAccountName: "Pretend Client Co", klaviyoAccountId: "AbC123",
    klaviyoFromEmail: "hello@pretend.co", klaviyoFromLabel: "Pretend Client",
    klaviyoTimezone: "America/New_York", klaviyoBaseTemplateId: "BASE01",
  },
});

// A real template, so the mobile-CSS check is testing something. The demo
// seed's template has no media query at all, which made the first run of this
// look like a bug in the extraction when it was a bug in the fixture.
const burju = readFileSync("templates/burju-shoes/01-hero-editorial.html", "utf8");
const tpl = await prisma.template.upsert({
  where: { id: "push-test-template" },
  update: { html: burju },
  create: { id: "push-test-template", companyId: company.id, name: "Hero Editorial", html: burju },
});
await prisma.contentSheet.deleteMany({ where: { companyId: company.id, name: "Push test" } });
const sheet = await prisma.contentSheet.create({
  data: {
    companyId: company.id, name: "Push test",
    columns: JSON.stringify(["template", "send_date", "send_time", "subject", "preheader", "campaign", "audience", "audience_exclude"]),
    rows: { create: [{ position: 0, data: JSON.stringify({
      template: tpl.name, send_date: "2026-12-01", send_time: "10:00",
      subject: "The winter edit", preheader: "Everything that survives a cold morning.",
      campaign: "Winter Edit", audience: "Newsletter", audience_exclude: "VIP",
    }) }] },
  },
  include: { rows: true },
});
const row = sheet.rows[0];
const approve = async () => {
  await prisma.approval.deleteMany({ where: { rowId: row.id } });
  const fresh = await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } });
  const t = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });
  await prisma.approval.create({ data: {
    rowId: row.id, templateId: tpl.id, userId: user.id,
    contentHash: approvalFingerprint(fresh.data, tpl.id, t.updatedAt) } });
};

// --- the gate ------------------------------------------------------------
console.log("The approval gate");
let r = await performPush(company.id, row.id, tpl.id, user.id);
check("an unapproved row cannot push", !r.ok && /Nobody has approved/.test(r.error ?? ""), r.error);
check("...and nothing was created", (await state()).campaigns.length === 0);

// a stale approval blocks it, since this company requires every approval current
await prisma.approval.create({ data: {
  rowId: row.id, templateId: tpl.id, userId: user.id, contentHash: "an-older-version" } });
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a stale approval blocks the push", !r.ok && /approved an earlier version/.test(r.error ?? ""), r.error);
check("...and still nothing was created", (await state()).campaigns.length === 0);

await approve();

// --- a bad audience ------------------------------------------------------
console.log("\nThe audience column");
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(row.data), audience: "Nope" }) } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("an audience Klaviyo does not have is refused", !r.ok && /No list or segment/.test(r.error ?? ""), r.error);

await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(row.data), audience: "Ambiguous" }) } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a name matching both a list and a segment is refused", !r.ok && /matches 2 audiences/.test(r.error ?? ""), r.error);
check("...and no template was cloned for either", (await state()).templates.filter((t) => t.id.startsWith("TPL")).length === 0);

// --- a base template with no blocks --------------------------------------
await prisma.company.update({ where: { id: company.id }, data: { klaviyoBaseTemplateId: "CODEONLY" } });
await prisma.sheetRow.update({ where: { id: row.id }, data: { data: row.data } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("an HTML-only base template is refused", !r.ok && /no blocks to fill/.test(r.error ?? ""), r.error);
check("...without cloning it first", (await state()).templates.filter((t) => t.id.startsWith("TPL")).length === 0);
await prisma.company.update({ where: { id: company.id }, data: { klaviyoBaseTemplateId: "BASE01" } });

// --- the real push -------------------------------------------------------
console.log("\nThe push");
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("an approved row pushes", r.ok, r.error);
r.notes?.forEach((n) => console.log("        note:", n));

let s = await state();
const clone = s.templates.find((t) => t.id.startsWith("TPL"));
check("the base template was cloned", !!clone, clone?.name);
check("the clone is named for the campaign", clone?.name?.startsWith("Winter Edit") ?? false);

const blocks: { type?: string; data?: { content?: string } }[] = [];
JSON.stringify(clone?.definition, (k, v) => {
  if (v && typeof v === "object" && (v as { type?: string }).type === "html") blocks.push(v);
  return v;
});
check("the clone still has both HTML blocks", blocks.length === 2, `${blocks.length}`);
const filled = blocks.find((b) => (b.data?.content ?? "").includes("Winter") || (b.data?.content ?? "").includes("<table"));
const untouched = blocks.find((b) => (b.data?.content ?? "").includes("unsubscribe"));
check("the marked block holds the rendered email", !!filled && (filled.data?.content ?? "").includes("<table"));
check("the marker itself is gone from it", !(filled?.data?.content ?? "").includes("EMAILPREVIEWS:CONTENT"));
check("the OTHER block was left completely alone", (untouched?.data?.content ?? "").includes("{% unsubscribe %}"),
  untouched?.data?.content);
check("the mobile CSS came along", (filled?.data?.content ?? "").includes("@media only screen"),
  `source has @media: ${/@media/.test(burju)}`);
check("no unfilled placeholders were sent", !/\{\{/.test(filled?.data?.content ?? ""));

const campaign = s.campaigns[0];
check("a campaign was created", !!campaign);
check("...named from the sheet", campaign?.attributes?.name === "Winter Edit", String(campaign?.attributes?.name));
check("...with the subject and preview text",
  JSON.stringify(campaign?.attributes).includes("The winter edit") &&
  JSON.stringify(campaign?.attributes).includes("cold morning"));
check("...to the right audiences",
  JSON.stringify(campaign?.attributes?.audiences) === JSON.stringify({ included: ["L1"], excluded: ["S2"] }),
  JSON.stringify(campaign?.attributes?.audiences));
check("...dated 10:00 New York in December, which is 15:00 UTC",
  (campaign?.attributes?.send_strategy as { datetime?: string })?.datetime?.startsWith("2026-12-01T15:00"),
  (campaign?.attributes?.send_strategy as { datetime?: string })?.datetime);
check("the clone is assigned to the message", campaign?.templateId === clone?.id);
check("it is still a draft — nothing was scheduled", campaign?.status === "Draft" && s.sendJobs.length === 0);

// --- pushing again updates rather than duplicating -----------------------
r = await performPush(company.id, row.id, tpl.id, user.id);
s = await state();
check("pushing again reuses the campaign", r.ok && s.campaigns.length === 1, `${s.campaigns.length} campaigns`);

// --- scheduling ----------------------------------------------------------
console.log("\nScheduling");
const before = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...before, subject: "Edited after the push" }) } });
r = await performSchedule(company.id, row.id, tpl.id);
check("a row edited since the push cannot be scheduled", !r.ok && /changed since it was pushed/.test(r.error ?? ""), r.error);
check("...and no send job was made", (await state()).sendJobs.length === 0);

await prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(before) } });
await approve();
await performPush(company.id, row.id, tpl.id, user.id);
r = await performSchedule(company.id, row.id, tpl.id);
check("an unchanged, approved row schedules", r.ok, r.error);
s = await state();
check("Klaviyo got exactly one send job", s.sendJobs.length === 1, `${s.sendJobs.length}`);
check("the campaign is scheduled", s.campaigns[0]?.status === "Scheduled");

// --- what the list offers, and what the push then allows -----------------
// The list screen and the push read one rule. These check they agree, since
// the way they would drift is a row the list offers and the push refuses.
console.log("\nEligibility, as the list sees it");
const settings = {
  fromEmail: "hello@pretend.co", baseTemplateId: "BASE01",
  timezone: "America/New_York", connected: true,
};
const columns = JSON.parse(sheet.columns) as string[];
const forPush = async (over: Record<string, string> = {}, extra: Partial<{ hiddenAt: Date | null }> = {}) => {
  const fresh = await prisma.sheetRow.findUniqueOrThrow({
    where: { id: row.id },
    include: { approvals: { select: { templateId: true, contentHash: true,
      user: { select: { name: true, email: true } } } } },
  });
  const data = JSON.stringify({ ...JSON.parse(fresh.data), ...over });
  return { data, values: JSON.parse(data), columns,
    hiddenAt: extra.hiddenAt !== undefined ? extra.hiddenAt : fresh.hiddenAt,
    approvals: fresh.approvals };
};
const tplNow = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });

await approve();
let e = checkEligibility(await forPush(), tplNow, settings);
check("an approved, complete row is eligible", e.ok && e.blockers.length === 0, e.blockers.join(" "));
check("...and can be scheduled, since it has a future date", e.canSchedule);
check("...reading the send time in the company's zone", e.sendAtLabel?.includes("EST") ?? false, e.sendAtLabel ?? "");

// Overriding the row's JSON changes the fingerprint, so the standing approval
// no longer matches -- which is the staleness rule doing its job.
e = checkEligibility(await forPush({ subject: "" }), tplNow, settings);
check("a row with no subject is not offered", !e.ok && e.blockers.some((b) => /no subject/.test(b)));
e = checkEligibility(await forPush({ audience: "" }), tplNow, settings);
check("a row with no audience is not offered", !e.ok && e.blockers.some((b) => /audience/.test(b)));
e = checkEligibility(await forPush({}, { hiddenAt: new Date() }), tplNow, settings);
check("a hidden row is not offered", !e.ok && e.blockers.some((b) => /hidden/.test(b)));

await approve();
e = checkEligibility(await forPush({ send_date: "", send_time: "" }), tplNow, settings);
check("a dateless row can still be drafted", e.blockers.every((b) => !/date/.test(b)));
check("...but not scheduled", !e.canSchedule);

e = checkEligibility(await forPush({ send_date: "2020-01-01" }), tplNow, settings);
check("a row dated in the past cannot be scheduled", !e.canSchedule);

e = checkEligibility(await forPush(), tplNow, { ...settings, connected: false });
check("no rows are offered when the company is not connected",
  !e.ok && e.blockers.some((b) => /not connected/.test(b)));
e = checkEligibility(await forPush(), tplNow, { ...settings, baseTemplateId: null });
check("...or when no base template is set", !e.ok && e.blockers.some((b) => /base template/.test(b)));

// --- pushing straight to scheduled ---------------------------------------
// The one door that can put a real send in a client's queue in a single act,
// so its refusals matter more than its successes.
console.log("\nPush as scheduled, in one step");
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });

const dated = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...dated, send_date: "", send_time: "" }) } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
check("a row with no send time cannot be pushed as scheduled",
  !r.ok && /needs a send date and time/.test(r.error ?? ""), r.error);
check("...and nothing at all was created in Klaviyo",
  (await state()).campaigns.length === 0 && (await state()).sendJobs.length === 0);

await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...dated, send_date: "2020-01-01" }) } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
check("a row dated in the past cannot be pushed as scheduled",
  !r.ok && /already passed/.test(r.error ?? ""), r.error);
check("...and still nothing was created", (await state()).sendJobs.length === 0);

// An unapproved row must not reach the scheduler by this door either.
await prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(dated) } });
await prisma.approval.deleteMany({ where: { rowId: row.id } });
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
check("an unapproved row cannot be pushed as scheduled",
  !r.ok && /Nobody has approved/.test(r.error ?? ""), r.error);
check("...and no send job was made", (await state()).sendJobs.length === 0);

await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
check("an approved, dated row pushes and schedules in one step", r.ok, r.error);
s = await state();
check("Klaviyo got exactly one send job", s.sendJobs.length === 1, `${s.sendJobs.length}`);
check("the campaign is scheduled, not a draft", s.campaigns[0]?.status === "Scheduled",
  s.campaigns[0]?.status);
check("and we recorded it as scheduled rather than a draft",
  (await prisma.klaviyoPush.findFirstOrThrow({ where: { rowId: row.id } })).status === "scheduled");

// Klaviyo refuses to edit a campaign that is already in the send queue, so
// pushing over a scheduled one has to take it out first. Without this the
// "Push again" button on a scheduled row fails with Klaviyo's own 409.
r = await performPush(company.id, row.id, tpl.id, user.id, "draft");
check("pushing over a scheduled campaign succeeds", r.ok, r.error);
s = await state();
check("...by taking it out of the send queue", s.campaigns[0]?.status === "Draft", s.campaigns[0]?.status);
check("...and the send job is gone with it", s.sendJobs.length === 0, `${s.sendJobs.length}`);
check("...and it says so rather than leaving you to notice",
  (r.notes ?? []).some((n) => /back to a draft/.test(n)), (r.notes ?? []).join(" | "));
check("...without making a second campaign", s.campaigns.length === 1, `${s.campaigns.length}`);

r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
s = await state();
check("and re-scheduling it puts exactly one job back",
  r.ok && s.sendJobs.length === 1 && s.campaigns[0]?.status === "Scheduled",
  `${s.sendJobs.length} job(s), ${s.campaigns[0]?.status}`);

// --- overriding the send time at the push --------------------------------
// The sheet is where a send time lives, so an override is written back to it
// rather than kept beside it. The interesting part is what happens to the
// sign-offs: a send time is not content, so an approval survives it -- unless
// the template actually prints the date, in which case it must not.
console.log("\nOverriding the send time");
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(row.data), send_date: "2026-12-01", send_time: "10:00" }) } });
await approve();

r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled",
  { date: "2026-12-04", time: "14:30" });
check("an overridden time pushes", r.ok, r.error);

let saved = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
check("...and is written back to the sheet",
  saved.send_date === "2026-12-04" && saved.send_time === "14:30",
  `${saved.send_date} ${saved.send_time}`);
check("...and says so", (r.notes ?? []).some((n) => /sheet's send time was changed/.test(n)),
  (r.notes ?? []).find((n) => /sheet/.test(n)));
check("...keeping the old values as a revision",
  (await prisma.rowRevision.findFirst({ where: { rowId: row.id }, orderBy: { changedAt: "desc" } }))
    ?.data.includes('"send_date":"2026-12-01"') ?? false);

// 14:30 New York on 4 Dec is 19:30 UTC.
s = await state();
check("...and Klaviyo got the new time, in UTC",
  (s.campaigns[0]?.attributes?.send_strategy as { datetime?: string })?.datetime?.startsWith("2026-12-04T19:30"),
  (s.campaigns[0]?.attributes?.send_strategy as { datetime?: string })?.datetime);

// The sign-off has to survive, or the row falls out of the queue the instant
// somebody nudges the time.
const kept = await prisma.approval.findFirstOrThrow({ where: { rowId: row.id, templateId: tpl.id } });
const tplNow2 = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });
const rowNow = await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } });
check("the sign-off survives a time change",
  kept.contentHash === approvalFingerprint(rowNow.data, tpl.id, tplNow2.updatedAt));
check("...so the row is still eligible afterwards",
  checkEligibility(await forPush(), tplNow2, settings).ok);

// Setting a date on a row that had none, from here.
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(rowNow.data), send_date: "", send_time: "" }) } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled",
  { date: "2026-12-05", time: "09:00" });
check("a row with no date can be given one here", r.ok, r.error);
saved = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
check("...and the sheet now has it", saved.send_date === "2026-12-05", saved.send_date);

// Refusals, before anything is written.
const before2 = (await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data;
r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled", { date: "2020-01-01", time: "09:00" });
check("an overridden time in the past is refused", !r.ok && /already passed/.test(r.error ?? ""), r.error);
r = await performPush(company.id, row.id, tpl.id, user.id, "draft", { date: "2026-13-45", time: "09:00" });
check("an unreadable overridden date is refused", !r.ok && /is not a date and time/.test(r.error ?? ""), r.error);
r = await performPush(company.id, row.id, tpl.id, user.id, "draft", { date: "", time: "09:00" });
check("a time with no date is refused", !r.ok && /needs a date/.test(r.error ?? ""), r.error);
check("...and none of those touched the sheet",
  (await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data === before2);

// A template that prints the send date is the one case where a time change is
// a content change, and the sign-off must not be carried over it.
const printing = await prisma.template.create({ data: {
  companyId: company.id, name: "Prints The Date",
  html: "<html><body><p>Out on {{ send_date }}</p><p>{{ subject }}</p></body></html>" } });
await prisma.approval.create({ data: { rowId: row.id, templateId: printing.id, userId: user.id,
  contentHash: approvalFingerprint(before2, printing.id, printing.updatedAt) } });
r = await performPush(company.id, row.id, printing.id, user.id, "draft", { date: "2026-12-08", time: "09:00" });
check("a template that prints the date refuses the override",
  !r.ok && /prints the send date/.test(r.error ?? ""), r.error);
check("...without changing the sheet",
  (await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data === before2);

// ...and pushing a different template must leave that one's sign-off stale.
// (approve() clears the row's approvals, so the date-printing one is put back
// afterwards -- it is the thing under test here.)
await approve();
await prisma.approval.create({ data: { rowId: row.id, templateId: printing.id, userId: user.id,
  contentHash: approvalFingerprint(
    (await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data,
    printing.id, printing.updatedAt) } });
r = await performPush(company.id, row.id, tpl.id, user.id, "draft", { date: "2026-12-10", time: "07:00" });
check("overriding elsewhere still pushes", r.ok, r.error);
const after = await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } });
const printed = await prisma.approval.findFirstOrThrow({ where: { rowId: row.id, templateId: printing.id } });
check("...but the date-printing template's sign-off went stale",
  printed.contentHash !== approvalFingerprint(after.data, printing.id, printing.updatedAt));
check("...and it said so", (r.notes ?? []).some((n) => /went stale/.test(n)),
  (r.notes ?? []).find((n) => /stale/.test(n)));
await prisma.template.delete({ where: { id: printing.id } });

// --- the sign-off after it has gone out ----------------------------------
// Once a pair is in Klaviyo the approval it went out on stops being a toggle.
// Withdrawing it would leave a live campaign that this app says nobody
// approved; editing the row is still the way to take something back.
console.log("\nWithdrawing a sign-off after the push");
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(row.data), send_date: "2026-12-01", send_time: "10:00" }) } });
await approve();

const beforePush = await prisma.approval.count({ where: { rowId: row.id, templateId: tpl.id } });
check("the row is approved before it goes", beforePush === 1, `${beforePush}`);

r = await performPush(company.id, row.id, tpl.id, user.id, "draft");
check("it pushes as a draft", r.ok, r.error);
let mark = await prisma.klaviyoPush.findFirstOrThrow({ where: { rowId: row.id, templateId: tpl.id } });
check("...and the push is recorded as a draft", publishedFromStatus(mark.status) === "drafted", mark.status);

// The action needs a request context, so the rule itself is exercised here the
// way the action reads it: a live push for this pair means no withdrawal.
const blocksWithdrawal = async (rowId: string, templateId: string) =>
  (await publishedState(rowId, templateId)) !== null;
check("a drafted pair blocks a withdrawal", await blocksWithdrawal(row.id, tpl.id));

r = await performPush(company.id, row.id, tpl.id, user.id, "scheduled");
check("it schedules", r.ok, r.error);
mark = await prisma.klaviyoPush.findFirstOrThrow({ where: { rowId: row.id, templateId: tpl.id } });
check("...and is recorded as scheduled", publishedFromStatus(mark.status) === "scheduled", mark.status);
check("a scheduled pair blocks a withdrawal too", await blocksWithdrawal(row.id, tpl.id));
check("a cancelled one does not", publishedFromStatus("cancelled") === null);

// A different template on the same row is a different email and is untouched.
const other = await prisma.template.create({ data: {
  companyId: company.id, name: "Another Layout", html: "<html><body><p>{{ subject }}</p></body></html>" } });
check("another template on the same row is not blocked", !(await blocksWithdrawal(row.id, other.id)));
await prisma.template.delete({ where: { id: other.id } });

// Editing the row is the way back: it makes every sign-off stale, which is what
// takes the approval away without needing to withdraw it.
const held = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...held, subject: "Changed my mind" }) } });
const tplLive = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });
const rowLive = await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } });
const stillHeld = await prisma.approval.findFirstOrThrow({ where: { rowId: row.id, templateId: tpl.id } });
check("editing the row makes the sign-off stale, published or not",
  stillHeld.contentHash !== approvalFingerprint(rowLive.data, tpl.id, tplLive.updatedAt));
check("...so the row is no longer eligible to push",
  !checkEligibility(await forPush(), tplLive, settings).ok);
await prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(held) } });

await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });

await prisma.contentSheet.delete({ where: { id: sheet.id } });
await prisma.template.delete({ where: { id: tpl.id } }).catch(() => {});
console.log(bad === 0 ? "\nALL PUSH CHECKS PASSED" : `\n${bad} FAILED`);
await prisma.$disconnect();
process.exit(bad === 0 ? 0 : 1);
