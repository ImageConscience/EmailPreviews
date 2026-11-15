/**
 * The push through Attentive, and what happens when a company changes platform.
 *
 * The Klaviyo path has its own check and is the longer one, because Klaviyo's
 * content model is the complicated half. This covers the other provider end to
 * end -- key, audiences, campaign, schedule, push again -- and then the thing
 * neither provider can check alone: a company that switches, and the pushes it
 * already made in the platform it left.
 *
 * The endpoint paths this exercises are the ones the client calls. They were
 * taken from Attentive's own tool definitions and could not be verified against
 * its HTTP documentation from the machine this was written on, so the mock is
 * asserted to serve exactly what the client asks for: if the paths turn out to
 * be wrong, correcting `ATTENTIVE_ENDPOINTS` makes this check fail until the
 * mock is corrected with it, rather than letting the two drift apart.
 */
process.env.ATTENTIVE_API_BASE = "http://127.0.0.1:4600";
process.env.KLAVIYO_API_BASE = "http://127.0.0.1:4599/api";

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/secret.ts";
import { approvalFingerprint } from "../src/lib/fingerprint.ts";
import { performPush, performSchedule } from "../src/lib/push-core.ts";
import { providerFromKey, setupBlockers } from "../src/lib/esp/index.ts";
import { ATTENTIVE_ENDPOINTS } from "../src/lib/esp/attentive-api.ts";

const prisma = new PrismaClient();
const KEY = "attn_live_testkey000000000000000000cd";
const BASE = "http://127.0.0.1:4600";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

const state = async () => (await fetch(`${BASE}/__state`)).json() as Promise<{
  calls: string[];
  campaigns: {
    campaignId: string; messageGroupId: string; messageId: string;
    name: string; status: string;
    message: Record<string, string> | null;
    group: { audience?: { includedSegmentIds?: string[]; excludedSegmentIds?: string[] }; sendAt?: string } | null;
  }[];
}>;

try {
  await fetch(`${BASE}/__reset`);
} catch {
  console.error("No mock Attentive on 4600. Start it with: npm run attentive:mock");
  process.exit(1);
}

// --- a company that sends through Attentive -------------------------------
const company = await prisma.company.findFirstOrThrow({ where: { name: "Acme Retail" } });
const user = await prisma.user.findFirstOrThrow({ where: { email: "demo@example.com" } });
await prisma.membership.update({
  where: { userId_companyId: { userId: user.id, companyId: company.id } },
  data: { role: "admin" },
});
await prisma.company.update({
  where: { id: company.id },
  data: {
    emailProvider: "attentive",
    espKeyCipher: encryptSecret(KEY), espKeyHint: "••••00cd",
    espAccountName: "Pretend Client Co", espAccountId: "CO123",
    espFromEmail: "hello@pretend.co", espFromLabel: "Pretend Client",
    espTimezone: "America/New_York", espReplyTo: null,
    espAudience: null, espAudienceExclude: null,
    // Deliberately left set. Attentive must ignore it rather than be blocked
    // by it or, worse, try to use it.
    klaviyoBaseTemplateId: "BASE01",
  },
});

const burju = readFileSync("templates/burju-shoes/01-hero-editorial.html", "utf8");
const tpl = await prisma.template.upsert({
  where: { id: "attentive-test-template" },
  update: { html: burju },
  create: { id: "attentive-test-template", companyId: company.id, name: "Hero Editorial", html: burju },
});
await prisma.contentSheet.deleteMany({ where: { companyId: company.id, name: "Attentive test" } });
const sheet = await prisma.contentSheet.create({
  data: {
    companyId: company.id, name: "Attentive test",
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

// --- the key, and whose it is --------------------------------------------
console.log("The key");
const provider = providerFromKey("attentive", KEY);
const account = await provider.account();
check("a good key names the account", account.name === "Pretend Client Co", account.name);
check("...and its id", account.id === "CO123", account.id);
check("the provider knows what it is", provider.id === "attentive" && provider.label === "Attentive");
check("nothing is outstanding before a push", (await provider.blockers()).length === 0);
check("...and the gate agrees without asking the network",
  setupBlockers("attentive", { klaviyoBaseTemplateId: null }).length === 0);

// The flat shape of /me, which the client also has to read.
await fetch(`${BASE}/__me-shape?shape=flat`);
check("an unwrapped account is read the same way",
  (await providerFromKey("attentive", KEY).account()).name === "Pretend Client Co");
await fetch(`${BASE}/__me-shape?shape=company`);

let threw = "";
try {
  await providerFromKey("attentive", "attn_wrong").account();
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
}
check("a bad key is refused in words a person can act on",
  /private app key/.test(threw), threw);

// --- audiences, across pages ---------------------------------------------
console.log("\nAudiences");
const audiences = await provider.audiences();
check("every segment is read, not just the first page", audiences.length === 5, `${audiences.length}`);
check("...including the last one, which is on page three",
  audiences.some((a) => a.id === "SEG5"), audiences.map((a) => a.id).join(","));
check("lists and segments are told apart",
  audiences.find((a) => a.id === "SEG1")?.kind === "list" &&
  audiences.find((a) => a.id === "SEG2")?.kind === "segment",
  audiences.map((a) => `${a.id}:${a.kind}`).join(" "));

// --- the push ------------------------------------------------------------
console.log("\nThe push");
await prisma.espPush.deleteMany({ where: { rowId: row.id } });
await approve();
let r = await performPush(company.id, row.id, tpl.id, user.id);
check("an approved row pushes", r.ok, r.error ?? "");
for (const note of r.notes ?? []) console.log(`        note: ${note}`);

let live = await state();
check("one campaign was made", live.campaigns.length === 1, `${live.campaigns.length}`);
const made = live.campaigns[0];
check("...named from the sheet", made?.name === "Winter Edit", made?.name ?? "");
check("...and it is a draft, not scheduled", made?.status === "DRAFT", made?.status ?? "");
check("the subject and preheader are on the message",
  made?.message?.subject === "The winter edit" &&
  made?.message?.preheaderText === "Everything that survives a cold morning.",
  JSON.stringify({ s: made?.message?.subject, p: made?.message?.preheaderText }));
check("the sender is the company's", made?.message?.fromEmail === "hello@pretend.co" &&
  made?.message?.fromName === "Pretend Client",
  `${made?.message?.fromEmail} / ${made?.message?.fromName}`);

// The thing that makes this provider simple: the whole document goes over as
// it is, head and media query included. Klaviyo has to take it apart.
const html = made?.message?.htmlContent ?? "";
check("the whole HTML document went over, not a fragment",
  /^\s*<!DOCTYPE/i.test(html) && /<\/html>/i.test(html), html.slice(0, 40));
check("...with the mobile media query still in the head",
  /@media/.test(html) && html.indexOf("@media") < html.indexOf("</head>"));
check("...and the rendered content in it", /Hero/i.test(html) || html.length > 2000, `${html.length} chars`);
check("no unfilled placeholders were sent", !/\{\{\s*\w+\s*\}\}/.test(html));

check("the audience is on the group, by id",
  JSON.stringify(made?.group?.audience?.includedSegmentIds) === '["SEG1"]' &&
  JSON.stringify(made?.group?.audience?.excludedSegmentIds) === '["SEG3"]',
  JSON.stringify(made?.group?.audience));
check("...and the send time, 10:00 New York in December, as 15:00 UTC",
  made?.group?.sendAt === "2026-12-01T15:00:00.000Z", made?.group?.sendAt ?? "");

const stored = await prisma.espPush.findFirstOrThrow({ where: { rowId: row.id } });
check("the push records which platform made it", stored.provider === "attentive", stored.provider);
check("...and the message group, so the next push can find it",
  JSON.parse(stored.refs).messageGroupId === made?.messageGroupId, stored.refs);
check("...as a draft", stored.status === "draft", stored.status);

// --- scheduling ----------------------------------------------------------
console.log("\nScheduling");
r = await performSchedule(company.id, row.id, tpl.id);
check("an unchanged, approved row schedules", r.ok, r.error ?? "");
live = await state();
check("...and Attentive has it queued", live.campaigns[0]?.status === "SCHEDULED",
  live.campaigns[0]?.status ?? "");
check("...recorded as scheduled",
  (await prisma.espPush.findFirstOrThrow({ where: { rowId: row.id } })).status === "scheduled");

// --- pushing over a queued campaign --------------------------------------
console.log("\nPushing again over a queued campaign");
r = await performPush(company.id, row.id, tpl.id, user.id);
check("it pushes", r.ok, r.error ?? "");
live = await state();
check("...without making a second campaign", live.campaigns.length === 1, `${live.campaigns.length}`);
check("...by taking it out of the queue first", live.campaigns[0]?.status === "DRAFT",
  live.campaigns[0]?.status ?? "");
check("...and saying so rather than leaving you to notice",
  (r.notes ?? []).some((n) => /back to a draft/.test(n)), (r.notes ?? []).join(" | "));

// --- a campaign somebody deleted in Attentive ----------------------------
console.log("\nWhen the campaign is gone");
await prisma.espPush.updateMany({
  where: { rowId: row.id },
  data: { campaignId: "CMP-deleted-by-hand" },
});
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a push whose campaign has vanished starts a fresh one", r.ok, r.error ?? "");
live = await state();
check("...so there are now two", live.campaigns.length === 2, `${live.campaigns.length}`);

// --- the paths the client actually used ----------------------------------
console.log("\nThe calls");
const calls = (await state()).calls;
const used = new Set(calls.map((c) => c.split(" ")[1]));
const expected = [
  ATTENTIVE_ENDPOINTS.me(),
  ATTENTIVE_ENDPOINTS.segments(),
  ATTENTIVE_ENDPOINTS.campaigns(),
];
for (const path of expected) {
  check(`the client asked for ${path}`, used.has(path), [...used].join(" "));
}
check("...and for a campaign, its message, its group, send and pause",
  [...used].some((p) => /^\/campaigns\/[^/]+$/.test(p)) &&
  [...used].some((p) => /^\/messages\/[^/]+$/.test(p)) &&
  [...used].some((p) => /^\/message-groups\/[^/]+$/.test(p)) &&
  [...used].some((p) => /^\/campaigns\/[^/]+\/send$/.test(p)) &&
  [...used].some((p) => /^\/campaigns\/[^/]+\/pause$/.test(p)),
  [...used].join(" "));
// Nothing Klaviyo-shaped: the base template is still set on this company, and
// a provider that reached for it would be reaching into the wrong platform.
check("nothing template-shaped was asked for",
  !calls.some((c) => /template/i.test(c)), calls.filter((c) => /template/i.test(c)).join(" "));

// --- changing platform ---------------------------------------------------
// What a company's own pushes look like after it moves. The campaigns it made
// in the platform it left still exist, and must not be mistaken for ones here.
console.log("\nAfter a company changes platform");
const before = await prisma.espPush.findFirstOrThrow({ where: { rowId: row.id } });
await prisma.espPush.update({
  where: { id: before.id },
  data: { provider: "klaviyo", status: "draft" },
});
r = await performSchedule(company.id, row.id, tpl.id);
check("a push made in the other platform cannot be scheduled from here",
  !r.ok && /now sends through Attentive/.test(r.error ?? ""), r.error ?? "");

const countBefore = (await state()).campaigns.length;
r = await performPush(company.id, row.id, tpl.id, user.id);
check("...and pushing it again makes it afresh here", r.ok, r.error ?? "");
live = await state();
check("...as a new campaign rather than writing to the old refs",
  live.campaigns.length === countBefore + 1, `${countBefore} -> ${live.campaigns.length}`);
check("...recorded against this platform now",
  (await prisma.espPush.findFirstOrThrow({ where: { rowId: row.id } })).provider === "attentive");

// --- an ambiguous audience -----------------------------------------------
console.log("\nAn ambiguous audience name");
await prisma.sheetRow.update({
  where: { id: row.id },
  data: { data: JSON.stringify({ ...JSON.parse(row.data), audience: "Ambiguous" }) },
});
await approve();
r = await performPush(company.id, row.id, tpl.id, user.id);
check("a name held by two audiences is refused rather than guessed",
  !r.ok && /Ambiguous/.test(r.error ?? ""), r.error ?? "");

// --- put the company back ------------------------------------------------
await prisma.sheetRow.update({ where: { id: row.id }, data: { data: row.data } });
await prisma.espPush.deleteMany({ where: { rowId: row.id } });
await prisma.approval.deleteMany({ where: { rowId: row.id } });
await prisma.contentSheet.delete({ where: { id: sheet.id } });
await prisma.company.update({
  where: { id: company.id },
  data: { emailProvider: "klaviyo", espKeyCipher: null, espKeyHint: null,
    espAccountName: null, espAccountId: null },
});

await prisma.$disconnect();
console.log(bad === 0 ? "\nALL ATTENTIVE CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
