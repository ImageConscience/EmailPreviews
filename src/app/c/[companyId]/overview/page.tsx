import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseRecord, parseStringArray } from "@/lib/json";
import { avatarHue, initialsOf } from "@/lib/approval";
import { approvalFingerprint } from "@/lib/fingerprint";
import { findEnvelopeColumns, findTemplateColumn, matchTemplateName } from "@/lib/template";
import { parseSendDate, rowLabel } from "@/lib/campaign";
import { isEmailProvider, PROVIDER_LABELS } from "@/lib/esp/types";
import { smsFingerprint } from "@/lib/fingerprint";
import { readSmsRow, smsLabel, smsSlots } from "@/lib/sms-row";
import { OverviewBoard, type OverviewItem } from "./OverviewBoard";

export const dynamic = "force-dynamic";

/**
 * Everything the company has, in one place.
 *
 * The preview answers "what does this one look like"; this answers "what is
 * going out, and is any of it ready". Summarising happens on the server so the
 * browser is handed one small list rather than every row of every sheet.
 *
 * Both channels, in one calendar. An email and a text going out the same
 * morning are one morning's work, and a schedule that shows half of it is a
 * schedule somebody has to hold the rest of in their head. They are summarised
 * separately because almost nothing about them is the same underneath -- a text
 * has no template, its own approvals table and its own pushes -- and they meet
 * only here, as items with a channel on them.
 */
export default async function OverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const access = await guardCompany(companyId);

  const [sheets, templates] = await Promise.all([
    // Both kinds in one read. The rows of one kind carry the other's relations
    // empty, which costs little and saves a second round trip and a merge.
    prisma.contentSheet.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: {
        rows: {
          orderBy: { position: "asc" },
          include: {
            hiddenBy: { select: { name: true, email: true } },
            _count: { select: { notes: true } },
            pushes: { select: { templateId: true, status: true, provider: true } },
            approvals: {
              orderBy: { createdAt: "asc" },
              select: {
                templateId: true,
                contentHash: true,
                userId: true,
                user: { select: { name: true, email: true } },
              },
            },
            smsPush: { select: { status: true, provider: true } },
            smsApprovals: {
              orderBy: { createdAt: "asc" },
              select: {
                contentHash: true,
                userId: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    }),
    prisma.template.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, updatedAt: true },
    }),
  ]);

  const templateSummaries = templates.map((t) => ({ id: t.id, name: t.name }));
  const templateUpdatedAt = new Map(templates.map((t) => [t.id, t.updatedAt]));

  const items: OverviewItem[] = [];
  for (const sheet of sheets) {
    const columns = parseStringArray(sheet.columns);

    // A text sheet reads nothing like an email one: no template, its own
    // approvals, its own push, and the message itself where a subject would be.
    if (sheet.kind === "sms") {
      const slots = smsSlots(columns);
      for (const row of sheet.rows) {
        const sms = readSmsRow(parseRecord(row.data), slots);
        const hash = smsFingerprint(row.data);

        let approvals = 0;
        let staleApprovals = 0;
        let approvedByMe = false;
        const byPerson = new Map<string, { name: string; initials: string; hue: number; stale: boolean }>();
        for (const approval of row.smsApprovals) {
          const current = approval.contentHash === hash;
          if (current) approvals += 1;
          else staleApprovals += 1;
          if (current && approval.userId === access.user.id) approvedByMe = true;
          const held = byPerson.get(approval.userId);
          if (!held || (held.stale && current)) {
            byPerson.set(approval.userId, {
              name: approval.user.name ?? approval.user.email,
              initials: initialsOf(approval.user.name, approval.user.email),
              hue: avatarHue(approval.userId),
              stale: !current,
            });
          }
        }

        items.push({
          channel: "text",
          rowId: row.id,
          sheetId: sheet.id,
          sheetName: sheet.name,
          position: row.position,
          title: smsLabel(sms),
          campaign: sms.name,
          theme: "",
          templateId: null,
          // A text has no template, and saying so with an empty string rather
          // than a dash keeps the column honest: there is nothing to assign.
          templateName: "",
          templateKnown: true,
          sendDate: parseSendDate(sms.sendDate),
          sendTime: sms.sendTime,
          // The message stands where a subject line would: it is what the
          // person reading the schedule wants to recognise it by.
          subject: sms.body,
          approvals,
          staleApprovals,
          approvers: [...byPerson.values()],
          approvedByMe,
          notes: row._count.notes,
          published:
            row.smsPush?.status === "scheduled" || row.smsPush?.status === "draft"
              ? row.smsPush.status
              : null,
          publishedIn: row.smsPush
            ? PROVIDER_LABELS[isEmailProvider(row.smsPush.provider) ? row.smsPush.provider : "klaviyo"]
            : null,
          hidden: Boolean(row.hiddenAt),
          hiddenBy: row.hiddenBy?.name ?? row.hiddenBy?.email ?? null,
        });
      }
      continue;
    }

    const templateColumn = findTemplateColumn(columns);
    const envelope = findEnvelopeColumns(columns);

    for (const row of sheet.rows) {
      const data = parseRecord(row.data);
      const matched = templateColumn
        ? matchTemplateName(data[templateColumn] ?? "", templateSummaries)
        : null;

      // An approval only counts while the row and the template it was given
      // against are both unchanged -- the same rule the preview applies.
      let approvals = 0;
      let staleApprovals = 0;
      // One entry per person, not per approval: the calendar shows who has
      // signed off, and somebody who approved the row in two templates is
      // still one person and should be one dot.
      const byPerson = new Map<string, { name: string; initials: string; hue: number; stale: boolean }>();
      let approvedByMe = false;
      for (const approval of row.approvals) {
        const updatedAt = templateUpdatedAt.get(approval.templateId);
        const current = Boolean(
          updatedAt && approval.contentHash === approvalFingerprint(row.data, approval.templateId, updatedAt),
        );
        if (current) approvals += 1;
        else staleApprovals += 1;
        if (current && approval.userId === access.user.id) approvedByMe = true;

        const held = byPerson.get(approval.userId);
        // Current beats stale: having re-approved the latest version is the
        // fact worth showing, whatever else they signed off earlier.
        if (!held || (held.stale && current)) {
          byPerson.set(approval.userId, {
            name: approval.user.name ?? approval.user.email,
            initials: initialsOf(approval.user.name, approval.user.email),
            hue: avatarHue(approval.userId),
            stale: !current,
          });
        }
      }

      items.push({
        channel: "email",
        rowId: row.id,
        sheetId: sheet.id,
        sheetName: sheet.name,
        position: row.position,
        title: rowLabel(data, columns),
        campaign: pick(data, ["campaign", "campaign_name"]),
        theme: pick(data, ["theme", "series"]),
        templateId: matched?.id ?? null,
        templateName: matched?.name ?? (templateColumn ? (data[templateColumn] ?? "").trim() : ""),
        templateKnown: Boolean(matched),
        sendDate: envelope.sendDate ? parseSendDate(data[envelope.sendDate]) : null,
        sendTime: envelope.sendTime ? (data[envelope.sendTime] ?? "").trim() : "",
        subject: envelope.subject ? (data[envelope.subject] ?? "").trim() : "",
        approvals,
        staleApprovals,
        approvers: [...byPerson.values()],
        approvedByMe,
        notes: row._count.notes,
        // Only the template this row is actually shown in: a campaign pushed
        // from a template the row no longer asks for is not this row's status.
        published: publishedIn(row.pushes, matched?.id ?? null),
        publishedIn: pushedPlatform(row.pushes, matched?.id ?? null),
        hidden: Boolean(row.hiddenAt),
        hiddenBy: row.hiddenBy?.name ?? row.hiddenBy?.email ?? null,
      });
    }
  }

  return (
    <OverviewBoard
      companyId={companyId}
      items={items}
      currentUserId={access.user.id}
      templates={templateSummaries}
      sheets={sheets.map((s) => ({ id: s.id, name: s.name, kind: s.kind === "sms" ? "text" : "email" }))}
    />
  );
}

/** First non-empty value among columns whose header matches one of these. */
function pick(data: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const key = Object.keys(data).find(
      (column) => column.toLowerCase().replace(/[^a-z0-9]+/g, "_") === name,
    );
    const value = key ? data[key]?.trim() : "";
    if (value) return value;
  }
  return "";
}

/** "scheduled", "draft", or null -- what this row is in its platform, if anything. */
function publishedIn(
  pushes: { templateId: string; status: string }[],
  templateId: string | null,
): string | null {
  if (!templateId) return null;
  const push = pushes.find((p) => p.templateId === templateId);
  if (!push) return null;
  return push.status === "scheduled" || push.status === "draft" ? push.status : null;
}

/**
 * Which platform it went to, by name.
 *
 * From the push, not the company: the calendar shows months of history, and a
 * company that changed platform in March has campaigns in both.
 */
function pushedPlatform(
  pushes: { templateId: string; status: string; provider: string }[],
  templateId: string | null,
): string | null {
  if (!templateId) return null;
  const push = pushes.find((p) => p.templateId === templateId);
  if (!push) return null;
  return PROVIDER_LABELS[isEmailProvider(push.provider) ? push.provider : "klaviyo"];
}
