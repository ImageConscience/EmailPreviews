import { prisma } from "@/lib/db";
import {
  envelopeSlots,
  findEnvelopeColumns,
  findTemplateColumn,
  normalizeKey,
} from "@/lib/template";
import { parseRecord, parseStringArray } from "@/lib/json";
import { approvalFingerprint } from "@/lib/fingerprint";
import { publishedState } from "@/lib/published";

/**
 * Writing to a row, from wherever the writing came from.
 *
 * The preview screen and the MCP connector change the same rows for the same
 * reasons, so they change them through the same function. Two copies of "save a
 * row" would drift, and the half that drifted would be the one nobody was
 * looking at.
 */

export interface AppliedFields {
  updatedAt: string;
  /** Headers this write introduced to the sheet. */
  addedColumns: string[];
  /** True when the values were already what was asked for. */
  unchanged: boolean;
}

/**
 * Merge values into a row, keeping the previous version as a RowRevision.
 *
 * The caller has already established that this user may write to this company;
 * this function is about the row.
 */
export async function applyFields(
  userId: string,
  rowId: string,
  values: Record<string, string>,
  note?: string,
): Promise<AppliedFields> {
  const row = await prisma.sheetRow.findUniqueOrThrow({
    where: { id: rowId },
    include: { sheet: true },
  });

  const previous = parseRecord(row.data);
  const next: Record<string, string> = { ...previous };
  for (const [key, value] of Object.entries(values)) {
    next[key] = value == null ? "" : String(value);
  }

  if (JSON.stringify(previous) === JSON.stringify(next)) {
    return { updatedAt: row.updatedAt.toISOString(), addedColumns: [], unchanged: true };
  }

  // Any header the caller introduced becomes a real column on the sheet, so a
  // value written here is a value the sheet screen and the export can see.
  const columns = parseStringArray(row.sheet.columns);
  const lowered = new Set(columns.map((c) => c.toLowerCase()));
  const addedColumns = Object.keys(next).filter((k) => !lowered.has(k.toLowerCase()));

  const [, updated] = await prisma.$transaction([
    prisma.rowRevision.create({
      data: {
        rowId: row.id,
        data: JSON.stringify(previous),
        changedById: userId,
        note: note || null,
      },
    }),
    prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(next) } }),
    ...(addedColumns.length > 0
      ? [
          prisma.contentSheet.update({
            where: { id: row.sheetId },
            data: { columns: JSON.stringify([...columns, ...addedColumns]) },
          }),
        ]
      : []),
  ]);

  return { updatedAt: updated.updatedAt.toISOString(), addedColumns, unchanged: false };
}

export interface WriteRisk {
  /** Refuse outright: the row is already in Klaviyo. */
  published: "draft" | "scheduled" | null;
  /** People whose current sign-off this write would silently withdraw. */
  wouldUnapprove: string[];
}

/**
 * What a write to this row would cost, before it happens.
 *
 * An approval is a fingerprint of the whole row, so *any* edit withdraws it.
 * That is right when a person edits in the app -- they can see the approval row
 * change in front of them. A caller reaching in over a connector sees nothing,
 * so it is told first and has to say it meant it.
 */
export async function writeRisk(rowId: string): Promise<WriteRisk> {
  const row = await prisma.sheetRow.findUniqueOrThrow({
    where: { id: rowId },
    include: {
      approvals: {
        include: {
          user: { select: { name: true, email: true } },
          template: { select: { id: true, updatedAt: true } },
        },
      },
      pushes: { select: { templateId: true, status: true } },
    },
  });

  const wouldUnapprove = row.approvals
    .filter(
      (a) =>
        a.contentHash === approvalFingerprint(row.data, a.templateId, a.template.updatedAt),
    )
    .map((a) => a.user.name ?? a.user.email);

  const live = row.pushes.find((p) => p.status === "scheduled") ?? row.pushes.find((p) => p.status === "draft");

  return {
    published: live ? (live.status as "draft" | "scheduled") : null,
    wouldUnapprove: [...new Set(wouldUnapprove)],
  };
}

/** Whether this row is in Klaviyo under the template it is shown in. */
export async function publishedFor(rowId: string, templateId: string) {
  return publishedState(rowId, templateId);
}

/** The fields a new email is started from. Everything else is written later. */
export interface NewEmail {
  /** An existing sheet, or empty to use the company's first (or start one). */
  sheetId: string;
  templateId: string;
  campaign: string;
  subject: string;
  preheader: string;
  sendDate: string;
  sendTime: string;
}

/** A refusal a caller can read and act on, as opposed to a bug. */
export class ComposeError extends Error {}

/**
 * Start an email: one row, already pointed at a template, with the few fields
 * that decide what it *is* filled in and the copy left for later.
 *
 * Every value is written to whichever column the sheet already uses for it, so
 * a row made here lands beside the imported ones rather than in a parallel set
 * of columns only one caller knows about.
 */
export async function createEmail(
  userId: string,
  companyId: string,
  input: NewEmail,
): Promise<{ sheetId: string; rowId: string }> {
    const template = await prisma.template.findFirst({
      where: { id: input.templateId, companyId },
      select: { id: true, name: true },
    });
    if (!template) throw new ComposeError("Choose a template.");

    // A row with no name is a blank line in every list that shows it, and the
    // one thing that cannot be worked out later from the template.
    const campaign = input.campaign.trim();
    if (!campaign) throw new ComposeError("Give it a name.");

    const time = input.sendTime.trim();
    const date = input.sendDate.trim();
    if (time && !date) throw new ComposeError("A send time needs a date to go with it.");

    // A company with no sheet yet still has to be able to start: one is made
    // rather than sending somebody to another screen to make it first.
    let sheet = input.sheetId
      ? await prisma.contentSheet.findFirst({ where: { id: input.sheetId, companyId } })
      : await prisma.contentSheet.findFirst({ where: { companyId }, orderBy: { createdAt: "asc" } });
    if (!sheet) {
      sheet = await prisma.contentSheet.create({
        data: {
          companyId,
          name: "Added in app",
          columns: JSON.stringify(["template", "campaign", "subject", "preheader", "send_date", "send_time"]),
        },
      });
    }

    const columns = parseStringArray(sheet.columns);
    const envelope = envelopeSlots(findEnvelopeColumns(columns));
    const templateColumn = findTemplateColumn(columns) ?? "template";
    const campaignColumn =
      columns.find((c) => ["campaign", "campaign_name"].includes(normalizeKey(c))) ?? "campaign";

    // Start from the sheet's shape so the row has every column the others have,
    // then fill in what was asked for.
    const values: Record<string, string> = Object.fromEntries(columns.map((c) => [c, ""]));
    values[templateColumn] = template.name;
    values[campaignColumn] = campaign;
    values[envelope.subject] = input.subject.trim();
    values[envelope.preheader] = input.preheader.trim();
    values[envelope.sendDate] = date;
    values[envelope.sendTime] = time;

    const lowered = new Set(columns.map((c) => c.toLowerCase()));
    const added = Object.keys(values).filter((k) => !lowered.has(k.toLowerCase()));

    const last = await prisma.sheetRow.findFirst({
      where: { sheetId: sheet.id },
      orderBy: { position: "desc" },
    });

    const [row] = await prisma.$transaction([
      prisma.sheetRow.create({
        data: {
          sheetId: sheet.id,
          position: (last?.position ?? -1) + 1,
          data: JSON.stringify(values),
          createdById: userId,
        },
      }),
      ...(added.length > 0
        ? [
            prisma.contentSheet.update({
              where: { id: sheet.id },
              data: { columns: JSON.stringify([...columns, ...added]) },
            }),
          ]
        : []),
    ]);

    return { sheetId: sheet.id, rowId: row.id };
}
