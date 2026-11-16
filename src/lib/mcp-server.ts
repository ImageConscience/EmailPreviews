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
  setHidden,
  writeRisk,
} from "@/lib/compose";
import {
  type TokenBearer,
  tokenCompanies,
  tokenCompanyAccess,
} from "@/lib/api-token";
import {
  listAttentiveHandoffs,
  recordAttentiveHandoff,
  saveAttentiveSegments,
} from "@/lib/attentive-handoff";
import {
  createText,
  listTexts,
  scheduledTextGuard,
  smsAudiences,
  smsWriteRisk,
  textReadiness,
  type NewText,
} from "@/lib/sms-core";
import { analyseSms, checkSms, MMS_MAX_CHARACTERS } from "@/lib/sms";
import { readSmsRow, smsSlots, SMS_FIELD_LABELS } from "@/lib/sms-row";

/**
 * The connector's view of this app.
 *
 * Deliberately small. The app is where an email is reviewed, approved and
 * pushed; this is where one gets written. Anything to do with sign-off or
 * sending stays on the screens where a person can see what they are agreeing
 * to, so there is no approve tool and no push tool here -- on purpose.
 *
 * The one exception in spirit is Attentive, which this app cannot reach (its
 * published API has no campaigns). For an Attentive company the connector
 * hands *already approved* work to the person's Claude session, which builds
 * it in Attentive through Attentive's own MCP server -- where the person
 * approves each write -- and then records here what it made. Nothing in these
 * tools sends anything, and recording is refused for a row that is no longer
 * approved as it reads.
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
        "Message Baker holds each brand's campaigns: emails as rows against an " +
        "HTML template, texts as rows of their own. Start with list_companies. " +
        "For an email, call describe_template before writing any content: it " +
        "reports that template's real field list, which fields take HTML, and " +
        "which the app works out for itself and must be left blank. For a text, " +
        "call describe_texting first: it reports the platform, whether the " +
        "opt-out wording is added for you, how characters count into segments, " +
        "and the audiences this company can name. Emails are written with " +
        "create_email and set_fields, texts with create_text and " +
        "set_text_fields, and both are read back with get_email / get_text. " +
        "A row is taken away by hiding it, which is reversible and " +
        "keeps its history; there is no delete. Approving and sending happen in " +
        "the app, not here. For a company that sends through Attentive, " +
        "list_attentive_handoffs returns what is approved and ready; build each " +
        "in Attentive with Attentive's own tools, then call " +
        "record_attentive_campaign with the campaign id it created. " +
        "save_attentive_segments keeps the app's audience pickers current.",
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
        where: { companyId, kind: "email" },
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
        where: { id: rowId, sheet: { companyId, kind: "email" } },
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
        "already pushed to the sending platform, and refuses to silently withdraw " +
        "an approval unless you pass withdrawApprovals.",
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
      const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId, kind: "email" } } });
      if (!row) return refuse("No such row in this company.");

      const risk = await writeRisk(rowId);

      // A campaign that already exists in the sending platform is not a draft
      // any more. Changing it here would leave the two quietly disagreeing.
      if (risk.published) {
        const where = risk.publishedIn ?? "the sending platform";
        return refuse(
          risk.published === "scheduled"
            ? `This row is already scheduled in ${where}. ${where} will not let a queued campaign be edited, so change it there or withdraw it in the app first.`
            : `This row is already in ${where} as a draft. Change it there, or push again from the app once it has been edited.`,
          { published: risk.published, publishedIn: risk.publishedIn },
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

  server.registerTool(
    "hide_email",
    {
      title: "Hide or unhide an email",
      description:
        "Take a row out of the working view, or put it back. Hiding is how a row " +
        "is taken away here -- it keeps its content, history and sign-offs, and can " +
        "be undone. There is no delete: removing a row for good is done in the app.",
      inputSchema: {
        companyId: z.string(),
        rowId: z.string(),
        hidden: z
          .boolean()
          .optional()
          .describe("True to hide (the default), false to bring it back."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ companyId, rowId, hidden = true }) => {
      await tokenCompanyAccess(bearer, companyId, "member");
      const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId, kind: "email" } } });
      if (!row) return refuse("No such row in this company.");

      // A campaign that is already in the sending platform keeps sending
      // whatever this app shows. Hiding the row would take it off the screen
      // where somebody might notice that, which is the opposite of what hiding
      // is for.
      const risk = await writeRisk(rowId);
      if (hidden && risk.published) {
        const where = risk.publishedIn ?? "the sending platform";
        return refuse(
          `This row is ${risk.published === "scheduled" ? "scheduled" : "a draft"} in ${where}. ` +
            "Hiding it here would not stop that, and would take it off the screen where you " +
            `would see it. Withdraw it in ${where} first.`,
          { published: risk.published, publishedIn: risk.publishedIn },
        );
      }

      const result = await setHidden(bearer.userId, rowId, hidden);
      return json({ rowId, ...result });
    },
  );

  server.registerTool(
    "list_attentive_handoffs",
    {
      title: "List approved work waiting to be built in Attentive",
      description:
        "For a company whose email and/or texts go through Attentive: every row an admin has " +
        "approved as it now reads, ready to build in Attentive with Attentive's own MCP tools. " +
        "Emails come with the complete rendered HTML, subject, preview text and sender; texts " +
        "with the body and optional MMS image URL. Audiences are given as Attentive segment ids " +
        "resolved from the saved segment list. Rows already recorded and unchanged are left out " +
        "unless includeRecorded is true. notReady lists approved rows that cannot go yet, and why.",
      inputSchema: {
        companyId: z.string(),
        includeRecorded: z.boolean().optional().describe("Also return rows already recorded as built."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ companyId, includeRecorded }) => {
      await tokenCompanyAccess(bearer, companyId, "admin");
      return json(await listAttentiveHandoffs(companyId, { includeRecorded }));
    },
  );

  server.registerTool(
    "record_attentive_campaign",
    {
      title: "Record a campaign built in Attentive",
      description:
        "After building an approved email or text in Attentive with Attentive's own tools, " +
        "record the campaign it created so this app shows the row as in Attentive (draft or " +
        "scheduled) and guards it like any other pushed row. Refused if the row is no longer " +
        "approved as it reads now -- list the handoffs again in that case. This sends nothing.",
      inputSchema: {
        companyId: z.string(),
        channel: z.enum(["email", "sms"]),
        rowId: z.string(),
        templateId: z.string().optional().describe("Required for email: the template it was rendered in."),
        campaignId: z.string().describe("Attentive's id for the campaign that was created."),
        messageId: z.string().optional(),
        status: z.enum(["draft", "scheduled"]),
        scheduledFor: z.string().optional().describe("ISO 8601 instant, when status is scheduled."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      await tokenCompanyAccess(bearer, input.companyId, "admin");
      const { companyId, ...rest } = input;
      const result = await recordAttentiveHandoff(companyId, bearer.userId, rest);
      return result.ok ? json({ recorded: true, ...rest }) : refuse(result.error ?? "Not recorded.");
    },
  );

  server.registerTool(
    "save_attentive_segments",
    {
      title: "Save the company's Attentive segments",
      description:
        "Replace this app's copy of the company's Attentive segment list with the one just read " +
        "from Attentive (for example with Attentive's list_segments). The app holds no Attentive " +
        "key, so this copy is what its audience pickers and defaults offer, and what " +
        "list_attentive_handoffs resolves audience names against.",
      inputSchema: {
        companyId: z.string(),
        segments: z
          .array(z.object({ id: z.string(), name: z.string(), kind: z.string().optional() }))
          .min(1),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ companyId, segments }) => {
      await tokenCompanyAccess(bearer, companyId, "admin");
      const result = await saveAttentiveSegments(companyId, segments);
      return result.ok ? json({ saved: result.saved }) : refuse(result.error ?? "Not saved.");
    },
  );

  /* ----------------------------------------------------------- texts ---- */
  //
  // The same six moves as email, on the other channel. A text has no template,
  // so where email has describe_template teaching a template's fields, texting
  // has describe_texting teaching the ones every text has and the rules the
  // copy is judged by -- all computed from this company's settings rather than
  // written down here, so they cannot drift from what the push enforces.

  server.registerTool(
    "describe_texting",
    {
      title: "How texts work for this company",
      description:
        "Read this before writing a text. Reports the platform this company texts through, " +
        "the fields a text row has, whether the platform appends its own opt-out wording, " +
        "how characters are counted into segments, and the audiences a text can name.",
      inputSchema: { companyId: z.string() },
    },
    async ({ companyId }) => {
      await tokenCompanyAccess(bearer, companyId);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { smsProvider: true, smsAddOptOut: true, smsAudience: true, smsAudienceExclude: true, espTimezone: true },
      });
      if (!company) return refuse("No such company.");
      if (!company.smsProvider) {
        return refuse(
          "This company does not text. Choose a platform under Settings → Integrations first.",
          { texting: false },
        );
      }
      // The audience list is the one part of this that leaves the building, so
      // it is the one part allowed to fail on its own. Everything else here --
      // the fields, the opt-out rule, the segment arithmetic -- is worth having
      // when the platform is unreachable, and losing all of it because a list
      // could not be fetched would be the tool refusing to answer the question
      // it was asked.
      let found: Awaited<ReturnType<typeof smsAudiences>> = { audiences: [], source: null, syncedAt: null };
      let audienceError: string | null = null;
      try {
        found = await smsAudiences(companyId);
      } catch (error) {
        audienceError =
          error instanceof Error
            ? `Could not read this company's audiences: ${error.message}`
            : "Could not read this company's audiences.";
      }
      const sheets = await prisma.contentSheet.findMany({
        where: { companyId, kind: "sms" },
        select: { id: true, name: true, columns: true, _count: { select: { rows: true } } },
        orderBy: { createdAt: "asc" },
      });

      return json({
        platform: company.smsProvider,
        fields: SMS_FIELD_LABELS,
        required: ["body", "audience (or a company default)", "sendDate and sendTime to schedule"],
        optOut: company.smsAddOptOut
          ? "The platform appends the account's opt-out wording at send time, so the copy must not repeat it."
          : "The platform adds nothing, so every message must carry opt-out wording itself (for example “Reply STOP to opt out”).",
        counting: {
          note:
            "A plain-text message is sent in GSM-7 segments; one character outside that set " +
            "(a curly quote, an emoji, an en dash) moves the whole message to UCS-2 and shortens " +
            "every segment. get_text reports the count for a given body.",
          gsm7: { single: 160, perSegmentWhenSplit: 153 },
          ucs2: { single: 70, perSegmentWhenSplit: 67 },
          mmsMaxCharacters: MMS_MAX_CHARACTERS,
        },
        imageMakesItMms: true,
        timezone: company.espTimezone ?? "UTC",
        defaults: { audience: company.smsAudience, exclude: company.smsAudienceExclude },
        audiences: found.audiences,
        audiencesFrom: found.source,
        audiencesSyncedAt: found.syncedAt,
        audiencesError: audienceError,
        sheets: sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, rows: sheet._count.rows })),
      });
    },
  );

  server.registerTool(
    "list_texts",
    {
      title: "List texts",
      description:
        "Every text in this company, with its message, when it goes, who it goes to, " +
        "its sign-offs and whether it is already in the sending platform.",
      inputSchema: {
        companyId: z.string(),
        search: z.string().optional().describe("Match on the campaign name or the message."),
        includeHidden: z.boolean().optional().describe("Default false."),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ companyId, search, includeHidden = false, limit = 50 }) => {
      await tokenCompanyAccess(bearer, companyId);
      const needle = (search ?? "").trim().toLowerCase();
      const texts = (await listTexts(companyId))
        .filter((t) => (includeHidden ? true : !t.hidden))
        .filter((t) => !needle || `${t.label} ${t.sms.body}`.toLowerCase().includes(needle))
        .slice(0, limit);

      return json(
        texts.map((t) => ({
          rowId: t.rowId,
          sheet: { id: t.sheetId, name: t.sheetName },
          name: t.sms.name || t.label,
          body: t.sms.body,
          imageUrl: t.sms.imageUrl || null,
          sendDate: t.sms.sendDate || null,
          sendTime: t.sms.sendTime || null,
          audience: t.sms.audience || null,
          exclude: t.sms.exclude || null,
          hidden: t.hidden,
          approvedBy: t.approvals.filter((a) => a.current).map((a) => a.name),
          staleApprovals: t.approvals.filter((a) => !a.current).map((a) => a.name),
          push: t.push
            ? { provider: t.push.provider, status: t.push.status, scheduledFor: t.push.scheduledFor, stale: t.push.stale }
            : null,
        })),
      );
    },
  );

  server.registerTool(
    "get_text",
    {
      title: "Get one text",
      description:
        "One text in full: its fields as written, how the message counts into segments, " +
        "anything wrong with the copy, and what still stands between it and a send.",
      inputSchema: { companyId: z.string(), rowId: z.string() },
    },
    async ({ companyId, rowId }) => {
      await tokenCompanyAccess(bearer, companyId);
      const row = await prisma.sheetRow.findFirst({
        where: { id: rowId, sheet: { companyId, kind: "sms" } },
        include: { sheet: { select: { id: true, name: true, columns: true } } },
      });
      if (!row) return refuse("No such text in this company.");
      const company = await prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { smsAddOptOut: true },
      });

      const values = parseRecord(row.data);
      const sms = readSmsRow(values, smsSlots(parseStringArray(row.sheet.columns)));
      const copy = checkSms({ body: sms.body, imageUrl: sms.imageUrl, platformAddsOptOut: company.smsAddOptOut });
      const ready = await textReadiness(companyId, rowId);
      const risk = await smsWriteRisk(rowId);

      return json({
        rowId: row.id,
        sheet: { id: row.sheet.id, name: row.sheet.name },
        hidden: Boolean(row.hiddenAt),
        text: sms,
        // Counted for the message as it stands; an image makes it an MMS and
        // the segment arithmetic stops applying.
        counts: sms.imageUrl ? { mms: true, characters: Array.from(sms.body).length } : analyseSms(sms.body),
        problems: copy.problems,
        warnings: [...copy.warnings, ...(ready?.warnings ?? [])],
        blockers: ready?.blockers ?? [],
        published: risk.published,
        publishedIn: risk.publishedIn,
        values,
      });
    },
  );

  server.registerTool(
    "create_text",
    {
      title: "Create a text",
      description:
        "Start a text row. Everything is optional but the company -- a bare row is fine and " +
        "can be filled in with set_text_fields -- though a message and an audience are what " +
        "it needs before anyone can approve it.",
      inputSchema: {
        companyId: z.string(),
        name: z.string().optional().describe("What this is called internally."),
        body: z.string().optional().describe("The message itself."),
        imageUrl: z.string().optional().describe("A public https:// image. Makes it an MMS."),
        sendDate: z.string().optional().describe("yyyy-mm-dd."),
        sendTime: z.string().optional().describe("HH:MM, 24-hour. Needs a date too."),
        audience: z.string().optional().describe("Segment or list names, comma separated. Defaults to the company's."),
        exclude: z.string().optional(),
        sheetId: z.string().optional().describe("Defaults to the company's newest text sheet, or starts one."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      await tokenCompanyAccess(bearer, input.companyId, "member");
      const { companyId, ...rest } = input;
      const made = await createText(bearer.userId, companyId, rest as NewText);
      return json({ ...made, next: "Check it with get_text; approving and sending happen in the app." });
    },
  );

  server.registerTool(
    "set_text_fields",
    {
      title: "Write fields to a text",
      description:
        "Merge values into a text. Only the fields you send change. Refuses a text that is " +
        "scheduled to send, and refuses to silently withdraw a sign-off unless you pass " +
        "withdrawApprovals.",
      inputSchema: {
        companyId: z.string(),
        rowId: z.string(),
        values: z
          .record(z.string())
          .describe("Any of: name, body, imageUrl, sendDate, sendTime, audience, exclude."),
        withdrawApprovals: z
          .boolean()
          .optional()
          .describe("Write even though it withdraws a current sign-off. Default false."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ companyId, rowId, values, withdrawApprovals = false }) => {
      await tokenCompanyAccess(bearer, companyId, "member");
      const row = await prisma.sheetRow.findFirst({
        where: { id: rowId, sheet: { companyId, kind: "sms" } },
        include: { sheet: { select: { columns: true } } },
      });
      if (!row) return refuse("No such text in this company.");

      // Scheduled is the one state that cannot be written through: the platform
      // will send what it holds, so an edit here would make this app show words
      // that are not the ones going out.
      const scheduled = await scheduledTextGuard(rowId);
      if (scheduled) return refuse(scheduled, { published: "scheduled" });

      const risk = await smsWriteRisk(rowId);
      if (risk.wouldUnapprove.length > 0 && !withdrawApprovals) {
        return refuse(
          `Writing to this text would withdraw the current sign-off of ${risk.wouldUnapprove.join(", ")}, ` +
            "because an approval covers the whole message. Pass withdrawApprovals: true if that is intended.",
          { wouldUnapprove: risk.wouldUnapprove },
        );
      }

      // Named the way a person writing a text thinks of them, then mapped onto
      // whatever this sheet happens to call its columns.
      const slots = smsSlots(parseStringArray(row.sheet.columns));
      const byField: Record<string, string> = {
        name: slots.name, body: slots.body, imageUrl: slots.image, image: slots.image,
        sendDate: slots.sendDate, sendTime: slots.sendTime,
        audience: slots.audience, exclude: slots.exclude,
      };
      const write: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        write[byField[key] ?? byField[normalizeKey(key)] ?? key] = value;
      }

      const applied = await applyFields(
        bearer.userId,
        rowId,
        write,
        `Written over the connector by ${bearer.name ?? bearer.email}`,
      );
      return json({ rowId, ...applied, withdrew: withdrawApprovals ? risk.wouldUnapprove : [] });
    },
  );

  server.registerTool(
    "hide_text",
    {
      title: "Hide or unhide a text",
      description:
        "Take a text out of the working view, or put it back. The message, its history and " +
        "its sign-offs are kept. Refuses to hide one that is already in the sending platform.",
      inputSchema: {
        companyId: z.string(),
        rowId: z.string(),
        hidden: z.boolean().optional().describe("Default true. Pass false to bring it back."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ companyId, rowId, hidden = true }) => {
      await tokenCompanyAccess(bearer, companyId, "member");
      const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId, kind: "sms" } } });
      if (!row) return refuse("No such text in this company.");

      const risk = await smsWriteRisk(rowId);
      if (hidden && risk.published) {
        const where = risk.publishedIn ?? "the sending platform";
        return refuse(
          `This text is ${risk.published === "scheduled" ? "scheduled" : "a draft"} in ${where}. ` +
            "Hiding it here would not stop that, and would take it off the screen where you " +
            `would see it. Withdraw it in ${where} first.`,
          { published: risk.published, publishedIn: risk.publishedIn },
        );
      }

      const result = await setHidden(bearer.userId, rowId, hidden);
      return json({ rowId, ...result });
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
      where: { sheet: { companyId, kind: "email" }, hiddenAt: null },
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
    where: { companyId, kind: "email" },
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
