import Link from "next/link";

import { prisma } from "@/lib/db";
import { guardCompany } from "@/lib/guard";
import { parseRecord, parseStringArray } from "@/lib/json";
import { rowLabel } from "@/lib/campaign";
import { avatarHue, initialsOf } from "@/lib/approval";
import { envelopeSlots, findEnvelopeColumns, findTemplateColumn, matchTemplateName } from "@/lib/template";
import { checkEligibility } from "@/lib/push-eligibility";
import { DEFAULT_TIMEZONE } from "@/lib/zone";
import { PushBoard, type PushItem } from "./PushBoard";

export const dynamic = "force-dynamic";

/**
 * The queue of emails that are ready to leave this app.
 *
 * Deliberately a different screen from the overview rather than a column on it.
 * The overview answers "how is the work going"; this answers "what am I about
 * to put into a client's Klaviyo", which is a smaller list, a narrower question
 * and a heavier button. Rows that are not ready are not shown at all -- a list
 * of things you cannot do is a list you learn to scroll past, and the place to
 * find out why a row is not ready is the row's own preview.
 */
export default async function PushPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  // Admin and above. Pushing mails a client's customers, which is not the same
  // permission as approving a row in here.
  await guardCompany(companyId, "admin");

  const [company, sheets, templates, adminships] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        klaviyoKeyCipher: true, klaviyoAccountName: true, klaviyoFromEmail: true,
        klaviyoFromLabel: true, klaviyoTimezone: true, klaviyoBaseTemplateId: true,
        klaviyoAudience: true, klaviyoAudienceExclude: true,
      },
    }),
    prisma.contentSheet.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
      include: {
        rows: {
          orderBy: { position: "asc" },
          include: {
            approvals: {
              orderBy: { createdAt: "asc" },
              select: {
                templateId: true, contentHash: true, userId: true,
                user: { select: { name: true, email: true } },
              },
            },
            pushes: {
              select: {
                templateId: true, campaignId: true, campaignName: true, status: true,
                scheduledFor: true, contentHash: true, audienceNames: true, pushedAt: true,
                pushedBy: { select: { name: true, email: true } },
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
    // Who can sign a row off for sending, as opposed to for reading. One query
    // for the company, rather than one per row.
    prisma.membership.findMany({
      where: { companyId, role: { in: ["admin", "owner"] } },
      select: { userId: true },
    }),
  ]);
  const admins = new Set(adminships.map((m) => m.userId));

  const connected = Boolean(company.klaviyoKeyCipher);
  const settings = {
    fromEmail: company.klaviyoFromEmail,
    baseTemplateId: company.klaviyoBaseTemplateId,
    timezone: company.klaviyoTimezone,
    connected,
    audience: company.klaviyoAudience,
    audienceExclude: company.klaviyoAudienceExclude,
  };

  const summaries = templates.map((t) => ({ id: t.id, name: t.name }));
  const byId = new Map(templates.map((t) => [t.id, t]));

  const items: PushItem[] = [];
  for (const sheet of sheets) {
    const columns = parseStringArray(sheet.columns);
    const templateColumn = findTemplateColumn(columns);
    const slots = envelopeSlots(findEnvelopeColumns(columns));

    for (const row of sheet.rows) {
      const data = parseRecord(row.data);
      const matched = templateColumn
        ? matchTemplateName(data[templateColumn] ?? "", summaries)
        : null;
      // A row whose template cannot be resolved cannot be rendered, so it is
      // not a candidate at all -- and saying so per row would drown the list.
      if (!matched) continue;
      const template = byId.get(matched.id);
      if (!template) continue;

      const check = checkEligibility(
        {
          data: row.data,
          values: data,
          columns,
          hiddenAt: row.hiddenAt,
          approvals: row.approvals.map((a) => ({ ...a, admin: admins.has(a.userId) })),
        },
        template,
        settings,
      );
      if (!check.ok) continue;

      const pushed = row.pushes.find((p) => p.templateId === template.id) ?? null;
      items.push({
        rowId: row.id,
        sheetId: sheet.id,
        sheetName: sheet.name,
        templateId: template.id,
        templateName: template.name,
        title: rowLabel(data, columns),
        subject: check.subject,
        campaignName: check.campaignName,
        // Same dots as the calendar, so "who signed this off" reads the same
        // wherever it is asked.
        approvers: check.approvers.map((a) => ({
          name: a.name,
          initials: initialsOf(a.name.includes("@") ? null : a.name, a.name),
          hue: avatarHue(a.userId),
          admin: a.admin,
          stale: a.stale,
        })),
        audience: check.audience,
        audienceInherited: check.audienceInherited,
        sendAt: check.sendAt?.toISOString() ?? null,
        // The raw cells, so the dialog can offer them for editing and say what
        // the sheet currently holds.
        sheetDate: (data[slots.sendDate] ?? "").trim(),
        sheetTime: (data[slots.sendTime] ?? "").trim(),
        sendAtLabel: check.sendAtLabel,
        canSchedule: check.canSchedule,
        past: Boolean(check.sendAt && check.sendAt.getTime() <= Date.now()),
        warning: check.warning ?? null,
        pushed: pushed
          ? {
              campaignId: pushed.campaignId,
              campaignName: pushed.campaignName,
              status: pushed.status,
              scheduledFor: pushed.scheduledFor?.toISOString() ?? null,
              audienceNames: pushed.audienceNames,
              pushedAt: pushed.pushedAt.toISOString(),
              pushedBy: pushed.pushedBy?.name ?? pushed.pushedBy?.email ?? null,
              stale: pushed.contentHash !== check.contentHash,
            }
          : null,
      });
    }
  }

  // Soonest first, but only among sends that are still ahead. A row dated last
  // year is still pushable as a draft, and sorting it purely by date would park
  // it permanently at the top of a queue that is worked from the top.
  const now = new Date().toISOString();
  const bucket = (item: PushItem) => (!item.sendAt ? 1 : item.sendAt >= now ? 0 : 2);
  items.sort((a, b) => {
    const order = bucket(a) - bucket(b);
    if (order !== 0) return order;
    if (a.sendAt && b.sendAt) return a.sendAt.localeCompare(b.sendAt);
    return a.title.localeCompare(b.title);
  });

  if (!connected) {
    return (
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Push to Klaviyo</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty">
            <h3>This company is not connected to Klaviyo</h3>
            <p>
              Connect an account under{" "}
              <Link href={`/c/${companyId}/integrations`}>Settings → Integrations</Link> to push
              approved emails into it.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <PushBoard
      companyId={companyId}
      items={items}
      accountName={company.klaviyoAccountName ?? "the connected account"}
      fromLabel={
        [company.klaviyoFromLabel, company.klaviyoFromEmail].filter(Boolean).join(" · ") ||
        "no from-address set"
      }
      timezone={company.klaviyoTimezone ?? DEFAULT_TIMEZONE}
      ready={Boolean(company.klaviyoBaseTemplateId && company.klaviyoFromEmail)}
    />
  );
}
