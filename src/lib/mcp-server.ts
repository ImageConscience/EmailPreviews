import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { parseRecord, parseStringArray } from "@/lib/json";
import { rowLabel } from "@/lib/campaign";
import {
  findEnvelopeColumns,
  findTemplateColumn,
  envelopeSlots,
  matchTemplateName,
  normalizeKey,
} from "@/lib/template";
import {
  describeFields,
  describeRowFields,
  describeShortcuts,
  requiredToPush,
} from "@/lib/field-guide";
import {
  applyFields,
  ComposeError,
  createEmail,
  writeRisk,
} from "@/lib/compose";
import {
  type TokenBearer,
  tokenCompanies,
  tokenCompanyAccess,
} from "@/lib/api-token";

/**
 * The connector's view of this app.
 *
 * Deliberately small. The app is where an email is reviewed, approved and
 * pushed; this is where one gets written. Anything to do with sign-off or
 * sending stays on the screens where a person can see what they are agreeing
 * to, so there is no approve tool and no push tool here -- on purpose.
 */

/** Tool results are JSON as text: precise to read, and readable in a log. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function refuse(message: string, extra: Record<string, unknown> = {}) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message, ...extra }, null, 2) },
    ],
  };
}

export function buildServer(bearer: TokenBearer): McpServer {
  const server = new McpServer(
    { name: "email-previews", version: "1.0.0" },
    {
      instructions:
        "Email Previews holds each brand's campaigns as rows against an HTML " +
        "template. Start with list_companies, then describe_template before " +
        "writing any content: it reports that template's real field list, which " +
        "fields take HTML, and which the app works out for itself and must be " +
        "left blank. Approving and sending happen in the app, not here.",
    },
  );

  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description: "Every brand this token can reach, with the role it has in each.",
      inputSchema: {},
    },
    async () => json(await tokenCompanies(bearer)),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "The templates a company has. Call describe_template before filling one in.",
      inputSchema: { companyId: z.string().describe("From list_companies.") },
    },
    async ({ companyId }) => {
      await tokenCompanyAccess(bearer, companyId);
      const templates = await prisma.template.findMany({
        where: { companyId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, updatedAt: true },
      });
      return json(templates);
    },
  );

  server.registerTool(
    "describe_template",
    {
      title: "Describe a template",
      description:
        "This template's field list, annotated: which fields are ordinary copy, " +
        "which are rendered as raw HTML, and which the app derives and must be " +
        "left blank. Read this before writing content for a template.",
      inputSchema: {
        companyId: z.string(),
        templateId: z.string().describe("From list_templates."),
        examples: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe("How many already-written rows to include as examples. Default 2."),
      },
    },
    async ({ companyId, templateId, examples = 2 }) => {
      await tokenCompanyAccess(bearer, companyId);
      const template = await prisma.template.findFirst({
        where: { id: templateId, companyId },
      });
      if (!template) return refuse("No such template in this company.");

      const fields = describeFields(template.html);
      const sheets = await prisma.contentSheet.findMany({
        where: { companyId },
        select: { columns: true },
      });
      const columns = [...new Set(sheets.flatMap((s) => parseStringArray(s.columns)))];
      const row = describeRowFields(columns);
      const envelope = envelopeSlots(findEnvelopeColumns(columns));

      return json({
        template: { id: template.id, name: template.name },
        howToUse: [
          "Fill the `content` fields. Leave every `derived` field blank -- writing one overrides a figure the app would have worked out.",
          "Never write a `switch` field; the app sets it from whether the slot is used.",
          "Only `raw_html` fields accept tags. Every other field is escaped, so a tag would print literally.",
          "A field left blank collapses rather than leaving a gap, so a shorter email is a legitimate row, not a broken one.",
          "Field names are matched loosely: case and punctuation are ignored, so `Hero Image URL` and `hero_image_url` are the same field.",
        ],
        fields,
        shortcuts: describeShortcuts(fields),
        rowFields: {
          note: "These belong to the row rather than the template -- the sending platform sets them.",
          envelope: row.envelope,
          audience: row.audience,
        },
        requiredToPush: requiredToPush(envelope),
        guidance: template.guidance,
        examples: examples > 0 ? await exampleRows(companyId, template, examples) : [],
      });
    },
  );

  server.registerTool(
    "list_emails",
    {
      title: "List emails",
      description: "Campaigns in this company, newest sheets first. Use get_email for one row's content.",
      inputSchema: {
        companyId: z.string(),
        templateId: z.string().optional().describe("Only rows written against this template."),
        search: z.string().optional().describe("Match on campaign name or subject."),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ companyId, templateId, search, limit = 50 }) => {
      await tokenCompanyAccess(bearer, companyId);
      const listed = await listEmails(companyId, { templateId, search, limit });
      return json(listed);
    },
  );

  server.registerTool(
    "get_email",
    {
      title: "Get one email",
      description: "Every field of one row, as written. Use this to read prior campaigns as examples.",
      inputSchema: { companyId: z.string(), rowId: z.string() },
    },
    async ({ companyId, rowId }) => {
      await tokenCompanyAccess(bearer, companyId);
      const row = await prisma.sheetRow.findFirst({
        where: { id: rowId, sheet: { companyId } },
        include: { sheet: { select: { id: true, name: true, columns: true } } },
      });
      if (!row) return refuse("No such row in this company.");
      return json({
        rowId: row.id,
        sheet: { id: row.sheet.id, name: row.sheet.name },
        hidden: Boolean(row.hiddenAt),
        values: parseRecord(row.data),
      });
    },
  );

  server.registerTool(
    "create_email",
    {
      title: "Create an email",
      description:
        "Start a row against a template, with the fields that decide what it is. " +
        "Fill the content afterwards with set_fields.",
      inputSchema: {
        companyId: z.string(),
        templateId: z.string(),
        campaign: z.string().describe("What this is called internally. Required."),
        subject: z.string().optional(),
        preheader: z.string().optional(),
        sendDate: z.string().optional().describe("yyyy-mm-dd."),
        sendTime: z.string().optional().describe("HH:MM, 24-hour. Needs a date too."),
        sheetId: z.string().optional().describe("Defaults to the company's first sheet."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      await tokenCompanyAccess(bearer, args.companyId, "member");
      try {
        const made = await createEmail(bearer.userId, args.companyId, {
          sheetId: args.sheetId ?? "",
          templateId: args.templateId,
          campaign: args.campaign,
          subject: args.subject ?? "",
          preheader: args.preheader ?? "",
          sendDate: args.sendDate ?? "",
          sendTime: args.sendTime ?? "",
        });
        return json({ ...made, next: "Fill the content with set_fields." });
      } catch (error) {
        if (error instanceof ComposeError) return refuse(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "set_fields",
    {
      title: "Write fields to an email",
      description:
        "Merge values into a row. Only the fields you send change. Refuses a row " +
        "already in Klaviyo, and refuses to silently withdraw an approval unless " +
        "you pass withdrawApprovals.",
      inputSchema: {
        companyId: z.string(),
        rowId: z.string(),
        values: z
          .record(z.string())
          .describe("Field name to value. Use describe_template for the names."),
        withdrawApprovals: z
          .boolean()
          .optional()
          .describe("Write even though it withdraws a current sign-off. Default false."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ companyId, rowId, values, withdrawApprovals = false }) => {
      await tokenCompanyAccess(bearer, companyId, "member");
      const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId } } });
      if (!row) return refuse("No such row in this company.");

      const risk = await writeRisk(rowId);

      // A campaign that already exists in Klaviyo is not a draft any more.
      // Changing it here would leave the two quietly disagreeing.
      if (risk.published) {
        return refuse(
          risk.published === "scheduled"
            ? "This row is already scheduled in Klaviyo. Klaviyo will not let a queued campaign be edited, so change it there or withdraw it in the app first."
            : "This row is already in Klaviyo as a draft. Change it there, or push again from the app once it has been edited.",
          { published: risk.published },
        );
      }

      if (risk.wouldUnapprove.length > 0 && !withdrawApprovals) {
        return refuse(
          `Writing to this row would withdraw the current sign-off of ` +
            `${risk.wouldUnapprove.join(", ")}, because an approval covers the whole ` +
            "row. Pass withdrawApprovals: true if that is intended.",
          { wouldUnapprove: risk.wouldUnapprove },
        );
      }

      const applied = await applyFields(
        bearer.userId,
        rowId,
        values,
        `Written over the connector by ${bearer.name ?? bearer.email}`,
      );
      return json({
        rowId,
        ...applied,
        withdrewApprovalsOf: risk.wouldUnapprove.length > 0 ? risk.wouldUnapprove : undefined,
      });
    },
  );

  return server;
}

/**
 * Worked examples: rows already written against this template.
 *
 * Rows that name the template win. Where a sheet has no template column -- or
 * has one nobody filled in -- the rows that best fill this template's fields
 * stand in, ranked by how many of them they actually carry. An empty examples
 * list is the least useful answer this tool could give, and "no template
 * column" is a sheet's shape rather than a reason to withhold them.
 */
async function exampleRows(
  companyId: string,
  template: { id: string; name: string; html: string },
  want: number,
) {
  const named = await listEmails(companyId, { templateId: template.id, limit: want });
  const picked = new Set(named.map((r) => r.rowId));

  if (picked.size < want) {
    const fields = describeFields(template.html)
      .filter((f) => f.kind === "content" || f.kind === "raw_html")
      .map((f) => normalizeKey(f.name));

    const candidates = await prisma.sheetRow.findMany({
      where: { sheet: { companyId }, hiddenAt: null },
      select: { id: true, data: true },
    });

    const scored = candidates
      .filter((r) => !picked.has(r.id))
      .map((r) => {
        const values = parseRecord(r.data);
        const lookup = new Map(
          Object.entries(values).map(([k, v]) => [normalizeKey(k), (v ?? "").trim()]),
        );
        const filled = fields.filter((f) => (lookup.get(f) ?? "") !== "").length;
        return { id: r.id, filled };
      })
      .filter((r) => r.filled > 0)
      .sort((a, b) => b.filled - a.filled);

    for (const row of scored.slice(0, want - picked.size)) picked.add(row.id);
  }

  const full = await prisma.sheetRow.findMany({ where: { id: { in: [...picked] } } });
  return full.map((r) => ({ rowId: r.id, values: parseRecord(r.data) }));
}

async function listEmails(
  companyId: string,
  opts: { templateId?: string; search?: string; limit?: number },
) {
  const sheets = await prisma.contentSheet.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    include: { rows: { orderBy: { position: "asc" } } },
  });
  const templates = await prisma.template.findMany({
    where: { companyId },
    select: { id: true, name: true },
  });

  const out: {
    rowId: string;
    sheetId: string;
    sheetName: string;
    title: string;
    subject: string;
    templateId: string | null;
    templateName: string;
    sendDate: string;
    hidden: boolean;
  }[] = [];

  const needle = (opts.search ?? "").trim().toLowerCase();

  for (const sheet of sheets) {
    const columns = parseStringArray(sheet.columns);
    const templateColumn = findTemplateColumn(columns);
    const envelope = envelopeSlots(findEnvelopeColumns(columns));
    for (const row of sheet.rows) {
      const data = parseRecord(row.data);
      const matched = templateColumn
        ? matchTemplateName(data[templateColumn] ?? "", templates)
        : null;
      if (opts.templateId && matched?.id !== opts.templateId) continue;

      const title = rowLabel(data, columns);
      const subject = (data[envelope.subject] ?? "").trim();
      if (needle && ![title, subject].some((t) => t.toLowerCase().includes(needle))) continue;

      out.push({
        rowId: row.id,
        sheetId: sheet.id,
        sheetName: sheet.name,
        title,
        subject,
        templateId: matched?.id ?? null,
        templateName: matched?.name ?? "",
        sendDate: (data[envelope.sendDate] ?? "").trim(),
        hidden: Boolean(row.hiddenAt),
      });
      if (out.length >= (opts.limit ?? 50)) return out;
    }
  }
  return out;
}
