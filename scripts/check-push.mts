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
import { CANDIDATE_REVISIONS, fetchAudiences, fetchTemplate, revision } from "../src/lib/klaviyo.ts";
import { checkEligibility, type ApprovalForPush } from "../src/lib/push-eligibility.ts";
import { audienceSlots, findAudienceColumns } from "../src/lib/template.ts";
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
// The gate turns on one current ADMIN sign-off, so the fixture has to say who
// is one. A member's approval is exercised separately below.
await prisma.membership.update({
  where: { userId_companyId: { userId: user.id, companyId: company.id } },
  data: { role: "admin" },
});
const member = await prisma.user.upsert({
  where: { email: "push-member@example.com" },
  update: {},
  create: { email: "push-member@example.com", name: "Plain Member", passwordHash: "x" },
});
await prisma.membership.upsert({
  where: { userId_companyId: { userId: member.id, companyId: company.id } },
  update: { role: "member" },
  create: { userId: member.id, companyId: company.id, role: "member" },
});
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

// An admin's own approval, given against an earlier version, is not a current
// sign-off and does not open the gate.
await prisma.approval.create({ data: {
  rowId: row.id, templateId: tpl.id, userId: user.id, contentHash: "an-older-version" } });
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a stale admin approval does not open the gate",
  !r.ok && /has to sign off on this one/.test(r.error ?? ""), r.error);
check("...and still nothing was created", (await state()).campaigns.length === 0);

// A member's current approval is a real sign-off, and still not the one that
// lets an email leave for a client's customers.
await prisma.approval.deleteMany({ where: { rowId: row.id } });
const fresh0 = await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } });
const t0 = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });
await prisma.approval.create({ data: { rowId: row.id, templateId: tpl.id, userId: member.id,
  contentHash: approvalFingerprint(fresh0.data, tpl.id, t0.updatedAt) } });
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a member's approval alone does not open the gate",
  !r.ok && /No admin has approved/.test(r.error ?? ""), r.error);
check("...and still nothing was created", (await state()).campaigns.length === 0);

// The point of the change: a colleague's stale approval must NOT hold the push
// up once an admin has signed off on what is there now. Preparing a row for a
// push edits it, and that edit is what stales everyone else.
await prisma.approval.updateMany({
  where: { rowId: row.id, userId: member.id }, data: { contentHash: "an-older-version" } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a stale colleague no longer blocks a current admin sign-off", r.ok, r.error);
check("...and it really was pushed", (await state()).campaigns.length === 1);

await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
await prisma.approval.deleteMany({ where: { rowId: row.id } });
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
    include: { approvals: { select: { templateId: true, contentHash: true, userId: true,
      user: { select: { name: true, email: true } } } } },
  });
  const data = JSON.stringify({ ...JSON.parse(fresh.data), ...over });
  return { data, values: JSON.parse(data), columns,
    hiddenAt: extra.hiddenAt !== undefined ? extra.hiddenAt : fresh.hiddenAt,
    approvals: fresh.approvals.map((a) => ({ ...a, admin: a.userId === user.id })) };
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

// --- the API revision ----------------------------------------------------
// A revision Klaviyo does not publish is not an error: it is treated as the
// oldest one they still support, so an endpoint quietly behaves as it did years
// ago. That is how a fix that looked right shipped and failed the same way.
console.log("\nThe API revision");
check("a revision is sent, and it is a date", /^\d{4}-\d{2}-\d{2}$/.test(revision()), revision());

const asked = process.env.KLAVIYO_API_REVISION;
process.env.KLAVIYO_API_REVISION = "2024-10-15";
try {
  await fetchTemplate(KEY, "BASE01");
  check("a revision that hands over the definition no way at all fails", false, "it succeeded");
} catch (error) {
  const detail = (error as Error).message;
  check("a revision that hands over the definition no way at all fails",
    /must be in/.test(detail), detail.slice(0, 60));
  check("...and the error names the revision that was used, not just the symptom",
    detail.includes("2024-10-15"), detail.slice(-90));
  check("...and says which knob changes it", /KLAVIYO_API_REVISION/.test(detail));
  check("...rather than claiming the template has no blocks",
    !/no blocks to fill/.test(detail));
}
// Assigning undefined stores the string "undefined", which is not a date and
// so is not a revision Klaviyo would take.
if (asked === undefined) delete process.env.KLAVIYO_API_REVISION;
else process.env.KLAVIYO_API_REVISION = asked;
check("the default revision can read one", (await fetchTemplate(KEY, "BASE01")).definition !== null);

// The setup check answers the question the failure raises: which revision does
// work. Only the check does this -- the push stays on one revision, because a
// send that negotiates its own API version is a send nobody can reason about.
process.env.KLAVIYO_API_REVISION = "2024-10-15";
let worked: string | null = null;
for (const candidate of CANDIDATE_REVISIONS) {
  try {
    if ((await fetchTemplate(KEY, "BASE01", candidate)).definition) { worked = candidate; break; }
  } catch { /* not this one */ }
}
check("a working revision can be found by trying the candidates", worked !== null, worked ?? "none");

// A revision Klaviyo does not publish is answered as the oldest one it does,
// which reads exactly like the field not existing. Telling those apart is the
// difference between changing one setting and changing it three times.
try {
  await fetchTemplate(KEY, "BASE01", "2099-01-15");
  check("an unpublished revision is called out as such", false, "it succeeded");
} catch (error) {
  const detail = (error as Error).message;
  check("an unpublished revision is called out as such",
    /does not publish that one/.test(detail), detail.slice(-120));
  check("...naming what Klaviyo answered as instead",
    /answered as revision 2024-10-15/.test(detail));
}
if (asked === undefined) delete process.env.KLAVIYO_API_REVISION;
else process.env.KLAVIYO_API_REVISION = asked;

// --- an account where additional-fields is refused outright ---------------
// The live failure: the parameter is understood, the allowed list is empty, and
// the definition is an ordinary field returned by default. No revision fixes
// that, so asking a different way has to.
console.log("\nWhen additional-fields is refused at every revision");
await fetch("http://127.0.0.1:4599/__template-mode?mode=plain");
try {
  const read = await fetchTemplate(KEY, "BASE01");
  check("the definition still comes back", read.definition !== null);
  check("...by asking a different way", read.readBy !== "additional-fields", read.readBy ?? "?");
  check("...and it is the real structure, not an empty shell",
    JSON.stringify(read.definition).includes("EMAILPREVIEWS:CONTENT"));
} catch (error) {
  check("the definition still comes back", false, (error as Error).message);
}

// And the whole push has to work in that world, not just the read.
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "draft");
check("and a push works against such an account", r.ok, r.error);
s = await state();
const filledPlain = (() => {
  const clone = s.templates.find((t) => t.id.startsWith("TPL"));
  const out: string[] = [];
  JSON.stringify(clone?.definition, (k, v) => {
    if (v && typeof v === "object" && (v as { type?: string }).type === "html") {
      out.push(((v as { data?: { content?: string } }).data?.content) ?? "");
    }
    return v;
  });
  return out;
})();
check("...filling the marked block as usual",
  filledPlain.some((c) => c.includes("<table")) && filledPlain.some((c) => c.includes("unsubscribe")),
  `${filledPlain.length} blocks`);
await fetch("http://127.0.0.1:4599/__template-mode?mode=additional-fields");
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });

// --- reading the account's lists -----------------------------------------
// Klaviyo rejects a sparse fieldset naming a type the endpoint cannot return,
// rather than ignoring it. Asking /lists for `fields[segment]` failed the whole
// call, which is how the audience picker shipped showing nothing at all.
console.log("\nReading the account's audiences");
try {
  const found = await fetchAudiences(KEY);
  check("lists and segments both come back", found.length === 5, `${found.length}`);
  check("...lists are labelled as lists",
    found.filter((a) => a.kind === "list").map((a) => a.name).join(", ") === "Newsletter, Ambiguous",
    found.filter((a) => a.kind === "list").map((a) => a.name).join(", "));
  check("...and segments as segments",
    found.filter((a) => a.kind === "segment").length === 3,
    `${found.filter((a) => a.kind === "segment").length}`);
  check("...each with an id to resolve it by", found.every((a) => a.id.length > 0));
} catch (error) {
  check("lists and segments both come back", false, (error as Error).message);
}

// --- naming the audience column ------------------------------------------
// The preview writes to whichever column the sheet already uses, and the push
// reads it the same way. A sheet saying "list" and a push looking only for
// "audience" would put a field on screen that changed nothing.
console.log("\nWhich column names the audience");
for (const [header, why] of [
  ["audience", "the default"],
  ["list", "a sheet that calls it a list"],
  ["Segment", "capitalised, as a spreadsheet would have it"],
  ["send_to", "a sheet that calls it send_to"],
] as const) {
  const slots = audienceSlots(findAudienceColumns([header, "subject"]));
  check(`${why} resolves to “${header}”`, slots.audience === header, slots.audience);
}
const bare = audienceSlots(findAudienceColumns(["subject"]));
check("a sheet with no audience column gets the default to write into",
  bare.audience === "audience" && bare.exclude === "audience_exclude",
  `${bare.audience} / ${bare.exclude}`);

// And the eligibility rule has to read that column, not a hard-coded one.
const aliased = {
  data: JSON.stringify({ subject: "Hello", list: "Newsletter" }),
  values: { subject: "Hello", list: "Newsletter" },
  columns: ["subject", "list"],
  hiddenAt: null,
  approvals: [] as ApprovalForPush[],
};
let e2 = checkEligibility(aliased, tplNow, settings);
check("eligibility reads the sheet's own audience column",
  !e2.blockers.some((b) => /audience/.test(b)) && e2.audience === "Newsletter", e2.audience);
e2 = checkEligibility({ ...aliased, values: { subject: "Hello", list: "" } }, tplNow, settings);
check("...and says which column it means when it is empty",
  e2.blockers.some((b) => b.includes("“list”")), e2.blockers.find((b) => /list/.test(b)));

// --- who signed it off, for the dots on the queue -------------------------
console.log("\nThe sign-off shown beside the push");
const withPeople = (rows: { userId: string; admin: boolean; stale: boolean }[]) => ({
  data: JSON.stringify({ subject: "Hello", audience: "Newsletter" }),
  values: { subject: "Hello", audience: "Newsletter" },
  columns: ["subject", "audience"],
  hiddenAt: null,
  approvals: rows.map((p, i) => ({
    templateId: tplNow.id,
    contentHash: p.stale
      ? "older"
      : approvalFingerprint(JSON.stringify({ subject: "Hello", audience: "Newsletter" }), tplNow.id, tplNow.updatedAt),
    userId: p.userId,
    admin: p.admin,
    user: { name: `Person ${i}`, email: `p${i}@example.com` },
  })) as ApprovalForPush[],
});

let g = checkEligibility(
  withPeople([{ userId: "u1", admin: true, stale: false }, { userId: "u2", admin: false, stale: true }]),
  tplNow, settings);
check("one current admin sign-off is enough", g.ok, g.blockers.join(" "));
check("...and both people are still shown", g.approvers.length === 2, `${g.approvers.length}`);
check("...with the stale one marked as such",
  g.approvers.filter((a) => a.stale).length === 1);
check("...and the admin marked as the one that counts",
  g.approvers.filter((a) => a.admin).length === 1);

g = checkEligibility(withPeople([{ userId: "u2", admin: false, stale: false }]), tplNow, settings);
check("members alone are not enough", !g.ok && g.blockers.some((b) => /No admin has approved/.test(b)),
  g.blockers.join(" "));
g = checkEligibility(withPeople([{ userId: "u1", admin: true, stale: true }]), tplNow, settings);
check("a stale admin is not enough either",
  !g.ok && g.blockers.some((b) => /sign off on this one/.test(b)), g.blockers.join(" "));

// --- the company default audience ----------------------------------------
// Filling an audience into every row would make every sign-off on those rows
// stale, since an approval is fingerprinted against the row. So the company
// carries a default and a row only names one when it differs.
console.log("\nThe default audience");
const noAudience = {
  data: JSON.stringify({ subject: "Hello", audience: "" }),
  values: { subject: "Hello", audience: "" },
  columns: ["subject", "audience"],
  hiddenAt: null,
  approvals: [] as ApprovalForPush[],
};
let d = checkEligibility(noAudience, tplNow, settings);
check("a row with no audience and no default is not offered",
  d.blockers.some((b) => /no default audience/.test(b)), d.blockers.join(" "));

d = checkEligibility(noAudience, tplNow, { ...settings, audience: "Newsletter" });
check("...but the company default fills it in", d.audience === "Newsletter", d.audience);
check("...and it is marked as inherited, not the row's own", d.audienceInherited);

d = checkEligibility(
  { ...noAudience, values: { subject: "Hello", audience: "VIP" } },
  tplNow, { ...settings, audience: "Newsletter" });
check("a row that names one overrides the default", d.audience === "VIP", d.audience);
check("...and is not marked inherited", !d.audienceInherited);

// End to end: the default has to reach Klaviyo, not just the list.
await fetch("http://127.0.0.1:4599/__reset");
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
const kept2 = JSON.parse((await prisma.sheetRow.findUniqueOrThrow({ where: { id: row.id } })).data);
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...kept2, audience: "", audience_exclude: "",
    send_date: "2026-12-01", send_time: "10:00" }) } });
await prisma.company.update({ where: { id: company.id },
  data: { klaviyoAudience: "Newsletter", klaviyoAudienceExclude: "VIP" } });
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id, "draft");
check("a row with no audience of its own pushes on the default", r.ok, r.error);
s = await state();
check("...to the audiences the default names",
  JSON.stringify(s.campaigns[0]?.attributes?.audiences) === JSON.stringify({ included: ["L1"], excluded: ["S2"] }),
  JSON.stringify(s.campaigns[0]?.attributes?.audiences));

// And the row still wins where it has an opinion.
await prisma.sheetRow.update({ where: { id: row.id },
  data: { data: JSON.stringify({ ...kept2, audience: "Engaged 90 days", audience_exclude: "",
    send_date: "2026-12-01", send_time: "10:00" }) } });
await approve();
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });
await fetch("http://127.0.0.1:4599/__reset");
r = await performPush(company.id, row.id, tpl.id, user.id, "draft");
s = await state();
check("a row that names its own audience overrides the default in the push",
  r.ok && JSON.stringify(s.campaigns[0]?.attributes?.audiences?.included) === JSON.stringify(["S1"]),
  JSON.stringify(s.campaigns[0]?.attributes?.audiences));
check("...while still taking the company's exclusions",
  JSON.stringify(s.campaigns[0]?.attributes?.audiences?.excluded) === JSON.stringify(["S2"]),
  JSON.stringify(s.campaigns[0]?.attributes?.audiences?.excluded));

await prisma.company.update({ where: { id: company.id },
  data: { klaviyoAudience: null, klaviyoAudienceExclude: null } });
await prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(kept2) } });
await prisma.klaviyoPush.deleteMany({ where: { rowId: row.id } });

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
