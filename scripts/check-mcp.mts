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
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { mintToken } from "@/lib/api-token";
import { describeFields, describeShortcuts } from "@/lib/field-guide";
import { approvalFingerprint } from "@/lib/fingerprint";

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
check("every tool is listed", names.length === 7, names.join(", "));
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

// A campaign already in Klaviyo is not a draft any more.
await prisma.klaviyoPush.create({
  data: {
    rowId,
    templateId: template.id,
    campaignId: "check", messageId: "check", klaviyoTemplateId: "check",
    contentHash: "check", status: "scheduled", campaignName: "check:mcp row",
  },
});
const published = await callTool("set_fields", {
  companyId, rowId, values: { headline: "Nope" }, withdrawApprovals: true,
});
check("a row already scheduled in Klaviyo refuses every write", published.isError);
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

// Revoking is immediate.
await prisma.apiToken.updateMany({ where: { hash: { not: "" }, label: "check:mcp" }, data: { revokedAt: new Date() } });
check("a revoked token stops working at once", (await rpc("tools/list", {})).status === 401);

/* --------------------------------------------------------------- tidy up */
await prisma.klaviyoPush.deleteMany({ where: { rowId } });
await prisma.approval.deleteMany({ where: { rowId } });
await prisma.sheetRow.delete({ where: { id: rowId } });
await prisma.apiToken.deleteMany({ where: { label: "check:mcp" } });
await prisma.template.deleteMany({ where: { companyId: stranger.id } });
await prisma.company.delete({ where: { id: stranger.id } });

console.log(`\n${passed} passed, ${failed} failed`);
await prisma.$disconnect();
if (failed > 0) process.exit(1);
console.log("ALL MCP CHECKS PASSED");
