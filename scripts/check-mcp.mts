/**
 * The connector, checked end to end against a running server.
 *
 * Two things are worth protecting here and they are different in kind. The
 * derived field guide is a claim about what the templates actually say, so it
 * is checked against the real template files -- if someone adds a raw field or
 * a derived one, this notices. The write guards are a claim about what the
 * connector refuses, so they are checked by actually trying it.
 *
 * Usage: npm run check:mcp  (needs the dev server and a database)
 */
import { existsSync, readFileSync } from "node:fs";

// Read .env before anything imports the database client, which reads
// DATABASE_URL as it is constructed. `npm run dev` loads this file for you;
// a bare script does not, and "works only if you exported it first" is a
// miserable property for a documented command.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) {
      process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
}

const { prisma } = await import("@/lib/db");
import { mintToken } from "@/lib/api-token";
import { describeFields, describeShortcuts } from "@/lib/field-guide";
import { approvalFingerprint, smsFingerprint } from "@/lib/fingerprint";

const BASE = process.env.MCP_BASE ?? "http://localhost:3100";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

/* ---------------------------------------------------------------- derived */
console.log("\nThe field guide, against the real templates");

const tee = describeFields(
  readFileSync("templates/museum-of-graffiti/04-tee-membership.html", "utf8"),
);
const kinds = (fs: ReturnType<typeof describeFields>, k: string) =>
  fs.filter((f) => f.kind === k).map((f) => f.name).sort();

check(
  "the two masthead fields are the only raw-HTML ones in Tee Membership",
  JSON.stringify(kinds(tee, "raw_html")) === JSON.stringify(["masthead_body", "masthead_title"]),
  kinds(tee, "raw_html").join(", "),
);
check(
  "member_price and retail_price are reported as derived, not as copy to write",
  JSON.stringify(kinds(tee, "derived")) === JSON.stringify(["member_price", "retail_price"]),
  kinds(tee, "derived").join(", "),
);

const focus = describeFields(
  readFileSync("templates/museum-of-graffiti/06-single-product-focus.html", "utf8"),
);
check(
  "Single Product Focus reports no derived fields, because it has no membership price",
  kinds(focus, "derived").length === 0,
  kinds(focus, "derived").join(", "),
);
check(
  "product_1_price is ordinary copy there, not derived",
  focus.some((f) => f.name === "product_1_price" && f.kind === "content"),
);

const palette = describeFields(
  readFileSync("templates/burju-shoes/04-palette-block.html", "utf8"),
);
check(
  "the packed band cells are offered on a template that uses them",
  describeShortcuts(palette).map((s) => s.cell).join(",") === "band_1,band_2,band_3",
);
check(
  "and not offered on one that does not",
  describeShortcuts(tee).length === 0,
);

/* ------------------------------------------------------------------ live */
console.log("\nThe endpoint");

const user = await prisma.user.findFirstOrThrow({ where: { email: "demo@example.com" } });
const membership = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
const companyId = membership.companyId;
const { token } = await mintToken(user.id, "check:mcp");

let id = 0;
async function rpc(method: string, params: unknown, auth = token) {
  const response = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  const result = body?.result;
  const text = result?.content?.[0]?.text;
  return { isError: Boolean(result?.isError), data: text ? JSON.parse(text) : null };
}

check("a request with no token is refused", (await rpc("initialize", {}, "")).status === 401);
check("a made-up token is refused", (await rpc("initialize", {}, "ep_nope")).status === 401);

// A client that sets its own headers may not let you set Authorization, so the
// token is accepted three ways. All three are checked, because "works when
// pasted the obvious way" is exactly the assumption that costs a round trip.
async function headerAuth(headers: Record<string, string>) {
  const response = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 9999, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } },
    }),
  });
  const body = await response.json().catch(() => null);
  return body?.result?.serverInfo?.name === "email-previews";
}

check("Authorization: Bearer <token> works", await headerAuth({ authorization: `Bearer ${token}` }));

// A protocol version this SDK has not heard of used to be a 400, which a
// client reads as a dead connection and recovers from by re-handshaking --
// losing the connector mid-conversation. Speaking an older dialect beats
// dropping the connection.
check(
  "a newer protocol version than this SDK knows is tolerated, not refused",
  await headerAuth({ authorization: `Bearer ${token}`, "mcp-protocol-version": "2099-01-01" }),
);
check(
  "a protocol version it does know still works",
  await headerAuth({ authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }),
);

// There is no server-to-client channel here, and holding one open looks from
// the client's end exactly like a connection that died.
const stream = await fetch(`${BASE}/api/mcp`, {
  method: "GET",
  headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
});
check("GET is refused rather than left hanging", stream.status === 405, `got ${stream.status}`);
check("and it says which method to use", stream.headers.get("allow") === "POST");
await stream.body?.cancel();

// WWW-Authenticate reads as an offer of OAuth, and a client that takes it up
// goes hunting for discovery documents this server does not have.
const anon = await fetch(`${BASE}/api/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
check("the 401 does not advertise an OAuth flow that does not exist", anon.headers.get("www-authenticate") === null);
check("X-Api-Key: <token> works, for clients that reserve Authorization", await headerAuth({ "x-api-key": token }));
check("a bare token with no Bearer prefix works too", await headerAuth({ authorization: token }));

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "check", version: "1" },
});
check("initialize succeeds with a real token", init.body?.result?.serverInfo?.name === "email-previews");

const tools = (await rpc("tools/list", {})).body?.result?.tools ?? [];
const names = tools.map((t: { name: string }) => t.name);
check("every tool is listed", names.length === 17, names.join(", "));
check(
  "texts are reachable over the connector, not only emails",
  ["describe_texting", "list_texts", "get_text", "create_text", "set_text_fields", "hide_text"]
    .every((n) => names.includes(n)),
  names.join(", "),
);
check(
  "the Attentive handoff tools are there -- Attentive is reached through Claude, not the app",
  ["list_attentive_handoffs", "record_attentive_campaign", "save_attentive_segments"].every((n) => names.includes(n)),
);
check("there is a hide tool", names.includes("hide_email"));
check(
  "and no delete tool -- taking a row away for good stays in the app",
  !names.some((n: string) => /delete|remove|destroy/i.test(n)),
);
check(
  "there is no approve or push tool -- those stay in the app",
  !names.some((n: string) => /approve|push|send|schedule/i.test(n)),
);

const template = await prisma.template.findFirstOrThrow({ where: { companyId } });
const guide = await callTool("describe_template", { companyId, templateId: template.id });
check("describe_template answers for a real template", guide.data?.template?.id === template.id);
check("it says how to use the field kinds", Array.isArray(guide.data?.howToUse));
check("it names the row fields the template does not own", Array.isArray(guide.data?.rowFields?.envelope));

const made = await callTool("create_email", {
  companyId,
  templateId: template.id,
  campaign: "check:mcp row",
  subject: "Checking",
});
check("create_email makes a row", Boolean(made.data?.rowId));
const rowId: string = made.data.rowId;

check(
  "create_email refuses a row with no name",
  (await callTool("create_email", { companyId, templateId: template.id, campaign: " " })).isError,
);
check(
  "create_email refuses a send time with no date",
  (await callTool("create_email", { companyId, templateId: template.id, campaign: "x", sendTime: "09:00" })).isError,
);

const wrote = await callTool("set_fields", { companyId, rowId, values: { headline: "Written" } });
check("set_fields writes", wrote.data?.unchanged === false);
const readBack = await callTool("get_email", { companyId, rowId });
check("and the value is there afterwards", readBack.data?.values?.headline === "Written");

check(
  "writing the same value again is reported as no change",
  (await callTool("set_fields", { companyId, rowId, values: { headline: "Written" } })).data?.unchanged === true,
);

// An approval covers the whole row, so any write withdraws it. The connector
// has to say so rather than let it happen quietly.
const row = await prisma.sheetRow.findUniqueOrThrow({ where: { id: rowId } });
await prisma.approval.create({
  data: {
    rowId,
    templateId: template.id,
    userId: user.id,
    contentHash: approvalFingerprint(row.data, template.id, template.updatedAt),
  },
});

const blocked = await callTool("set_fields", { companyId, rowId, values: { headline: "Changed" } });
check("a write that would withdraw a sign-off is refused", blocked.isError);
check("and it names who would lose it", (blocked.data?.wouldUnapprove ?? []).includes(user.name ?? user.email));

const forced = await callTool("set_fields", {
  companyId,
  rowId,
  values: { headline: "Changed" },
  withdrawApprovals: true,
});
check("saying so explicitly lets it through", forced.data?.unchanged === false);
check("and it reports whose sign-off it cost", (forced.data?.withdrewApprovalsOf ?? []).length === 1);

const after = await prisma.sheetRow.findUniqueOrThrow({
  where: { id: rowId },
  include: { approvals: true },
});
check(
  "the approval really is stale now, so the refusal was not theoretical",
  after.approvals[0].contentHash !==
    approvalFingerprint(after.data, template.id, template.updatedAt),
);
check(
  "the previous values are recoverable from a revision",
  (await prisma.rowRevision.count({ where: { rowId } })) > 0,
);

// Hiding is the reversible way to take a row away, so it is checked both ways
// and checked for leaving the row's content alone.
const hid = await callTool("hide_email", { companyId, rowId });
check("hide_email hides a row", hid.data?.hiddenAt != null && hid.data?.unchanged === false);
check("and records who did it", Boolean(hid.data?.hiddenBy));
check(
  "hiding again is reported as no change rather than failing",
  (await callTool("hide_email", { companyId, rowId })).data?.unchanged === true,
);
check(
  "the row's content survives being hidden",
  (await callTool("get_email", { companyId, rowId })).data?.values?.headline === "Changed",
);
const shown = await callTool("hide_email", { companyId, rowId, hidden: false });
check("and it can be brought back", shown.data?.hiddenAt === null);
check(
  "a hidden row still appears to the connector, marked hidden",
  await (async () => {
    await callTool("hide_email", { companyId, rowId });
    const listed = await callTool("list_emails", { companyId, limit: 200 });
    const found = (listed.data ?? []).find((r: { rowId: string }) => r.rowId === rowId);
    const ok = found?.hidden === true;
    await callTool("hide_email", { companyId, rowId, hidden: false });
    return ok;
  })(),
);

// A campaign already in Klaviyo is not a draft any more.
await prisma.espPush.create({
  data: {
    rowId,
    templateId: template.id,
    campaignId: "check", messageId: "check",
    provider: "klaviyo", refs: JSON.stringify({ templateId: "check" }),
    contentHash: "check", status: "scheduled", campaignName: "check:mcp row",
  },
});
const published = await callTool("set_fields", {
  companyId, rowId, values: { headline: "Nope" }, withdrawApprovals: true,
});
check("a row already scheduled in Klaviyo refuses every write", published.isError);
// Hiding a live campaign would take it off the screen without stopping it.
const hidePublished = await callTool("hide_email", { companyId, rowId });
check("and refuses to be hidden, which would hide the problem not fix it", hidePublished.isError);
check(
  "but can still be brought back into view",
  !(await callTool("hide_email", { companyId, rowId, hidden: false })).isError,
);
check("and says so in terms of Klaviyo, not of this app", /Klaviyo/.test(published.data?.error ?? ""));

// A token reaches only what its owner reaches. Made rather than looked for:
// whether the seed happens to contain a second company is not a good reason to
// skip the one check here that is about somebody else's data.
const stranger = await prisma.company.create({ data: { name: "check:mcp stranger" } });
const strangerTemplate = await prisma.template.create({
  data: {
    companyId: stranger.id,
    name: "Not yours",
    html: "<p>{{ headline }}</p>",
    placeholders: JSON.stringify(["headline"]),
  },
});

const reach = await rpc("tools/call", {
  name: "list_templates",
  arguments: { companyId: stranger.id },
});
check(
  "a company this token's owner does not belong to is refused",
  reach.body?.error != null || reach.body?.result?.isError === true,
  JSON.stringify(reach.body).slice(0, 120),
);
check(
  "and the refusal does not confirm that the company exists",
  /no such company/i.test(JSON.stringify(reach.body ?? {})),
);
check(
  "a template id from it cannot be reached through a company that is allowed",
  (await callTool("describe_template", { companyId, templateId: strangerTemplate.id })).isError,
);

/* ------------------------------------------------------------- texts ---- */
//
// The whole channel over the connector: what a text is, writing one, reading it
// back, and the two states that must refuse a write. Texting was reachable only
// through the app until now, which textMade a text the one thing a Claude session
// could plan and then not write.
console.log("\nTexts over the connector");

await prisma.company.update({
  where: { id: companyId },
  data: {
    smsProvider: "attentive", smsAddOptOut: true, smsAudience: "Newsletter",
    attentiveSegments: JSON.stringify([{ id: "SEG1", name: "Newsletter", kind: "list" }]),
    attentiveSegmentsSyncedAt: new Date(),
  },
});

const textGuide = await callTool("describe_texting", { companyId });
check("describe_texting names the platform", textGuide.data?.platform === "attentive", JSON.stringify(textGuide.data?.platform));
check("...and the audiences it can name, from the saved copy",
  textGuide.data?.audiencesFrom === "attentive" && textGuide.data?.audiences?.[0]?.name === "Newsletter",
  JSON.stringify(textGuide.data?.audiences));
check("...and says the opt-out wording is added for you",
  /appends/i.test(String(textGuide.data?.optOut)), String(textGuide.data?.optOut).slice(0, 60));
check("...and how characters count into segments",
  textGuide.data?.counting?.gsm7?.single === 160 && textGuide.data?.counting?.ucs2?.single === 70);
check("...and the company's default audience", textGuide.data?.defaults?.audience === "Newsletter");

const textMade = await callTool("create_text", {
  companyId, name: "Connector text", body: "Doors open at six. Reply STOP to opt out.",
  sendDate: "2027-03-02", sendTime: "10:00", audience: "Newsletter",
});
check("create_text makes one", !textMade.isError && Boolean(textMade.data?.rowId), JSON.stringify(textMade.data));
const textRowId = textMade.data?.rowId as string;

const textGot = await callTool("get_text", { companyId, rowId: textRowId });
check("get_text reads it back", textGot.data?.text?.name === "Connector text", JSON.stringify(textGot.data?.text));
check("...with the message", textGot.data?.text?.body === "Doors open at six. Reply STOP to opt out.");
check("...the send time and audience", textGot.data?.text?.sendDate === "2027-03-02" && textGot.data?.text?.audience === "Newsletter");
check("...and the segment count, not a guess at one",
  textGot.data?.counts?.encoding === "GSM-7" && textGot.data?.counts?.segments === 1, JSON.stringify(textGot.data?.counts));

const textListed = await callTool("list_texts", { companyId });
check("list_texts includes it", (textListed.data ?? []).some((t: { rowId: string }) => t.rowId === textRowId));

// A curly apostrophe is one character to a person and a different encoding to a
// carrier; the count has to say so rather than be out by half a message.
await callTool("set_text_fields", { companyId, rowId: textRowId, values: { body: "Doors open at six — don’t be late. Reply STOP to opt out." } });
const textWide = await callTool("get_text", { companyId, rowId: textRowId });
check("one character outside GSM-7 moves the whole message to UCS-2",
  textWide.data?.counts?.encoding === "UCS-2", JSON.stringify(textWide.data?.counts));

// The copy rules are the push's, reported rather than re-stated.
await prisma.company.update({ where: { id: companyId }, data: { smsAddOptOut: false } });
await callTool("set_text_fields", { companyId, rowId: textRowId, values: { body: "No way out of this one." } });
const noOptOut = await callTool("get_text", { companyId, rowId: textRowId });
check("a message with no opt-out wording is reported when the platform adds none",
  (noOptOut.data?.problems ?? []).concat(noOptOut.data?.warnings ?? []).some((m: string) => /stop|opt/i.test(m)),
  JSON.stringify({ problems: noOptOut.data?.problems, warnings: noOptOut.data?.warnings }));
await prisma.company.update({ where: { id: companyId }, data: { smsAddOptOut: true } });

// A sign-off covers the whole message, so a write takes it away.
await prisma.smsApproval.create({
  data: { rowId: textRowId, userId: user.id, contentHash: smsFingerprint((await prisma.sheetRow.findUniqueOrThrow({ where: { id: textRowId } })).data) },
});
const wouldLose = await callTool("set_text_fields", { companyId, rowId: textRowId, values: { body: "Changed again." } });
check("a write that would withdraw a sign-off is refused", wouldLose.isError);
check("...and it names who would lose it", /Demo User/.test(JSON.stringify(wouldLose.data)), JSON.stringify(wouldLose.data));
const textForced = await callTool("set_text_fields", { companyId, rowId: textRowId, values: { body: "Changed again." }, withdrawApprovals: true });
check("...and saying so explicitly lets it through", !textForced.isError, JSON.stringify(textForced.data));

// Scheduled is the state nothing may write through.
await prisma.smsPush.create({
  data: {
    rowId: textRowId, provider: "attentive", campaignId: "c", messageId: "m",
    contentHash: "x", status: "scheduled", campaignName: "Connector text",
  },
});
const textBlocked = await callTool("set_text_fields", { companyId, rowId: textRowId, values: { body: "Too late." } });
check("a scheduled text refuses every write", textBlocked.isError, JSON.stringify(textBlocked.data));
const hideLive = await callTool("hide_text", { companyId, rowId: textRowId });
check("...and refuses to be hidden, which would hide the problem not fix it", hideLive.isError);
check("...saying which platform it is in", /Attentive/.test(JSON.stringify(hideLive.data)), JSON.stringify(hideLive.data));

await prisma.smsPush.deleteMany({ where: { rowId: textRowId } });
const textHidden = await callTool("hide_text", { companyId, rowId: textRowId });
check("an unpushed text can be hidden", !textHidden.isError, JSON.stringify(textHidden.data));
const afterHide = await callTool("list_texts", { companyId });
check("...and drops out of the list", !(afterHide.data ?? []).some((t: { rowId: string }) => t.rowId === textRowId));
const textShown = await callTool("list_texts", { companyId, includeHidden: true });
check("...unless asked for", (textShown.data ?? []).some((t: { rowId: string }) => t.rowId === textRowId));
check("...and comes back", !(await callTool("hide_text", { companyId, rowId: textRowId, hidden: false })).isError);

// Revoking is immediate.
await prisma.apiToken.updateMany({ where: { hash: { not: "" }, label: "check:mcp" }, data: { revokedAt: new Date() } });
check("a revoked token stops working at once", (await rpc("tools/list", {})).status === 401);

/* --------------------------------------------------------------- tidy up */
await prisma.espPush.deleteMany({ where: { rowId } });
await prisma.approval.deleteMany({ where: { rowId } });
const textSheet = await prisma.sheetRow.findUnique({ where: { id: textRowId }, select: { sheetId: true } });
await prisma.sheetRow.delete({ where: { id: textRowId } }).catch(() => {});
if (textSheet) {
  const left = await prisma.sheetRow.count({ where: { sheetId: textSheet.sheetId } });
  if (left === 0) await prisma.contentSheet.delete({ where: { id: textSheet.sheetId } }).catch(() => {});
}
await prisma.sheetRow.delete({ where: { id: rowId } });
await prisma.apiToken.deleteMany({ where: { label: "check:mcp" } });
await prisma.template.deleteMany({ where: { companyId: stranger.id } });
await prisma.company.delete({ where: { id: stranger.id } });

console.log(`\n${passed} passed, ${failed} failed`);
await prisma.$disconnect();
if (failed > 0) process.exit(1);
console.log("ALL MCP CHECKS PASSED");
