/**
 * Attentive, as this app actually reaches it: through a person's Claude
 * session, never directly.
 *
 * Attentive's published API has no campaigns (docs.attentive.com, read November
 * 2026), so there is no HTTP client to exercise and no mock. What is checked is
 * this app's half of the handoff: that an Attentive company needs no key, that
 * the in-app push says to hand off instead of trying, that the connector lists
 * exactly the approved rows with what Attentive's tools need (rendered HTML,
 * text body and image, segment ids, send time), that recording what was built
 * is refused for a row edited since approval, and that a recorded row is then
 * guarded like any pushed one.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { approvalFingerprint } from "../src/lib/fingerprint.ts";
import { applyFields } from "../src/lib/compose.ts";
import { performPush } from "../src/lib/push-core.ts";
import { providerFor } from "../src/lib/esp/index.ts";
import { performSmsPush, scheduledTextGuard, toggleSmsApproval } from "../src/lib/sms-core.ts";
import { SMS_SHEET_COLUMNS } from "../src/lib/sms-row.ts";
import {
  listAttentiveHandoffs,
  recordAttentiveHandoff,
  saveAttentiveSegments,
} from "../src/lib/attentive-handoff.ts";

const prisma = new PrismaClient();

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

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
    emailProvider: "attentive",
    espKeyCipher: null, espKeyHint: null, espAccountName: null, espAccountId: null,
    espFromEmail: "hello@pretend.co", espFromLabel: "Pretend Client",
    espTimezone: "America/New_York",
    espAudience: "Email Subscribers", espAudienceExclude: null,
    smsProvider: "attentive", smsKeyCipher: null,
    smsAudience: "SMS Subscribers", smsAudienceExclude: "Recent Purchasers",
    smsAddOptOut: true,
    attentiveSegments: null, attentiveSegmentsSyncedAt: null,
  },
});

const nextYear = new Date().getUTCFullYear() + 1;
const burju = readFileSync("templates/burju-shoes/01-hero-editorial.html", "utf8");
const tpl = await prisma.template.upsert({
  where: { id: "attentive-handoff-template" },
  update: { html: burju },
  create: { id: "attentive-handoff-template", companyId: company.id, name: "Handoff test", html: burju },
});
await prisma.contentSheet.deleteMany({ where: { companyId: company.id, name: { in: ["Handoff emails", "Handoff texts"] } } });
const emails = await prisma.contentSheet.create({
  data: {
    companyId: company.id, name: "Handoff emails", kind: "email",
    columns: JSON.stringify(["template", "campaign", "subject", "preheader", "send_date", "send_time", "audience"]),
    rows: { create: [{ position: 0, data: JSON.stringify({
      template: "Handoff test", campaign: "Spring launch", subject: "Spring is here",
      preheader: "New colours", send_date: `${nextYear}-06-02`, send_time: "09:00", audience: "",
    }) }] },
  },
  include: { rows: true },
});
const texts = await prisma.contentSheet.create({
  data: {
    companyId: company.id, name: "Handoff texts", kind: "sms",
    columns: JSON.stringify(SMS_SHEET_COLUMNS),
    rows: { create: [{ position: 0, data: JSON.stringify({
      campaign: "Spring text", send_date: `${nextYear}-06-02`, send_time: "12:00",
      body: "Spring is here.", image: "https://cdn.example.com/spring.jpg",
    }) }] },
  },
  include: { rows: true },
});
const emailRow = emails.rows[0];
const textRow = texts.rows[0];
const approveEmail = async () => {
  const row = await prisma.sheetRow.findUniqueOrThrow({ where: { id: emailRow.id } });
  const t = await prisma.template.findUniqueOrThrow({ where: { id: tpl.id } });
  await prisma.approval.upsert({
    where: { rowId_templateId_userId: { rowId: row.id, templateId: t.id, userId: user.id } },
    create: { rowId: row.id, templateId: t.id, userId: user.id, contentHash: approvalFingerprint(row.data, t.id, t.updatedAt) },
    update: { contentHash: approvalFingerprint(row.data, t.id, t.updatedAt) },
  });
};

console.log("No key, and no direct push");
{
  check("an Attentive company has no in-app provider", (await providerFor(company.id)) === null);
  const e = await performPush(company.id, emailRow.id, tpl.id, user.id, "draft");
  check("the email push says to hand off through Claude", !e.ok && /Claude/.test(e.error ?? ""), e.error);
  const t = await performSmsPush(company.id, textRow.id, user.id, "draft");
  check("so does the text push", !t.ok && /Claude/.test(t.error ?? ""), t.error);
}

console.log("\nSegments, as Claude saves them");
{
  const empty = await saveAttentiveSegments(company.id, [{ id: "", name: "" }]);
  check("a list with nothing usable is refused", !empty.ok);
  const dup = await saveAttentiveSegments(company.id, [{ id: "1", name: "A" }, { id: "1", name: "B" }]);
  check("a duplicated id is refused", !dup.ok);
  const saved = await saveAttentiveSegments(company.id, [
    { id: "101", name: "Email Subscribers" },
    { id: "102", name: "SMS Subscribers" },
    { id: "103", name: "Recent Purchasers" },
  ]);
  check("three segments are saved", saved.ok && saved.saved === 3);
}

console.log("\nWhat is listed for handing off");
{
  let list = await listAttentiveHandoffs(company.id);
  check("nothing unapproved is listed", list.email.length === 0 && list.sms.length === 0);

  await approveEmail();
  await toggleSmsApproval(company.id, textRow.id, user.id);
  list = await listAttentiveHandoffs(company.id);
  const e = list.email[0];
  check("the approved email is listed", list.email.length === 1 && e?.rowId === emailRow.id, JSON.stringify(list.notReady));
  check("...with its rendered HTML", Boolean(e?.html?.includes("<html")) && (e?.html?.length ?? 0) > 1000);
  check("...its subject, preview text and sender", e?.subject === "Spring is here" && e.previewText === "New colours" && e.fromEmail === "hello@pretend.co");
  check("...the default audience as a segment id", e?.audience.includeIds.join() === "101" && !e.audience.error, JSON.stringify(e?.audience));
  check("...and the send time in New York", e?.sendAt === `${nextYear}-06-02T13:00:00.000Z`, e?.sendAt ?? "");
  const t = list.sms[0];
  check("the approved text is listed", list.sms.length === 1 && t?.body === "Spring is here.");
  check("...as an MMS with its image", t?.imageUrl === "https://cdn.example.com/spring.jpg");
  check("...to and excluding the right segments", t?.audience.includeIds.join() === "102" && t.audience.excludeIds.join() === "103");
}

console.log("\nRecording what was built");
{
  const noId = await recordAttentiveHandoff(company.id, user.id, { channel: "email", rowId: emailRow.id, templateId: tpl.id, campaignId: " ", status: "draft" });
  check("a record without a campaign id is refused", !noId.ok);
  const noTime = await recordAttentiveHandoff(company.id, user.id, { channel: "sms", rowId: textRow.id, campaignId: "ATT-T1", status: "scheduled" });
  check("a scheduled record without its time is refused", !noTime.ok);

  const email = await recordAttentiveHandoff(company.id, user.id, { channel: "email", rowId: emailRow.id, templateId: tpl.id, campaignId: "ATT-E1", status: "draft" });
  check("the email is recorded", email.ok, email.error);
  const push = await prisma.espPush.findUnique({ where: { rowId_templateId: { rowId: emailRow.id, templateId: tpl.id } } });
  check("...as an Attentive draft", push?.provider === "attentive" && push.campaignId === "ATT-E1" && push.status === "draft");

  const text = await recordAttentiveHandoff(company.id, user.id, {
    channel: "sms", rowId: textRow.id, campaignId: "ATT-T1", status: "scheduled", scheduledFor: `${nextYear}-06-02T16:00:00.000Z`,
  });
  check("the text is recorded as scheduled", text.ok, text.error);
  check("...and is then guarded against edits like any scheduled text", Boolean(await scheduledTextGuard(textRow.id)));

  const list = await listAttentiveHandoffs(company.id);
  check("recorded, unchanged rows are not listed again", list.email.length === 0 && list.sms.length === 0);
  const all = await listAttentiveHandoffs(company.id, { includeRecorded: true });
  check("...unless asked for", all.email.length === 1 && all.email[0].existing?.campaignId === "ATT-E1");
}

console.log("\nAn edit after approval");
{
  await applyFields(user.id, emailRow.id, { subject: "Spring is really here" });
  const list = await listAttentiveHandoffs(company.id);
  check("an edited email is not offered as ready", list.email.length === 0);
  check("...it is listed as not ready, with the reason", list.notReady.some((n) => n.rowId === emailRow.id && /approve/i.test(n.reasons.join(" "))), JSON.stringify(list.notReady));
  const again = await recordAttentiveHandoff(company.id, user.id, { channel: "email", rowId: emailRow.id, templateId: tpl.id, campaignId: "ATT-E2", status: "draft" });
  check("recording it is refused until it is approved again", !again.ok, again.error);
  await approveEmail();
  const relisted = await listAttentiveHandoffs(company.id);
  check("once re-approved it is offered again, marked as changed since", relisted.email[0]?.existing?.stale === true);
}

console.log("\nAn audience that is not in the saved list");
{
  await applyFields(user.id, emailRow.id, { audience: "Nobody Called This" });
  await approveEmail();
  const list = await listAttentiveHandoffs(company.id);
  check("is reported on the handoff rather than guessed", Boolean(list.email[0]?.audience.error), JSON.stringify(list.email[0]?.audience));
}

// --- leave the company as it was --------------------------------------------
await prisma.contentSheet.deleteMany({ where: { id: { in: [emails.id, texts.id] } } });
await prisma.template.delete({ where: { id: tpl.id } });
const { id: _id, createdAt: _c, ...restore } = before;
void _id; void _c;
await prisma.company.update({ where: { id: company.id }, data: restore });
await prisma.$disconnect();

if (bad) {
  console.log(`\n${bad} ATTENTIVE CHECK${bad === 1 ? "" : "S"} FAILED`);
  process.exit(1);
}
console.log("\nALL ATTENTIVE CHECKS PASSED");
