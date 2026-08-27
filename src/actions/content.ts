"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { extractPlaceholders } from "@/lib/template";
import { parseSheetFile } from "@/lib/sheet";
import { parseRecord, parseStringArray } from "@/lib/json";

export interface FormState {
  error?: string;
  ok?: string;
}

function fail(error: unknown): FormState {
  if (error instanceof AuthError) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  return { error: "Something went wrong." };
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name."),
  description: z.string().trim().optional(),
  html: z.string().min(1, "Paste the template HTML."),
});

export async function createTemplateAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let templateId: string;
  try {
    await requireCompanyAccess(companyId, "member");
    const parsed = templateSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      html: formData.get("html"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const template = await prisma.template.create({
      data: {
        companyId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        html: parsed.data.html,
        placeholders: JSON.stringify(extractPlaceholders(parsed.data.html)),
      },
    });
    templateId = template.id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/c/${companyId}/templates`);
  redirect(`/c/${companyId}/templates/${templateId}`);
}

export async function updateTemplateAction(
  companyId: string,
  templateId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireCompanyAccess(companyId, "member");
    const parsed = templateSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      html: formData.get("html"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    // scoped by companyId so a guessed id from another tenant cannot be written
    const result = await prisma.template.updateMany({
      where: { id: templateId, companyId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        html: parsed.data.html,
        placeholders: JSON.stringify(extractPlaceholders(parsed.data.html)),
      },
    });
    if (result.count === 0) return { error: "Template not found." };
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/c/${companyId}/templates/${templateId}`);
  return { ok: "Template saved." };
}

export async function deleteTemplateAction(companyId: string, templateId: string): Promise<void> {
  await requireCompanyAccess(companyId, "admin");
  await prisma.template.deleteMany({ where: { id: templateId, companyId } });
  revalidatePath(`/c/${companyId}/templates`);
  redirect(`/c/${companyId}/templates`);
}

/* ------------------------------------------------------------------ */
/* Content sheets                                                      */
/* ------------------------------------------------------------------ */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function uploadSheetAction(
  companyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let sheetId: string;
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a .csv, .tsv or .xlsx file to upload." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { error: "That file is larger than 10 MB." };
    }

    const worksheet = (formData.get("worksheet") as string | null)?.trim() || undefined;
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseSheetFile(file.name, buffer, worksheet);

    if (parsed.columns.length === 0) {
      return { error: "That file has no header row, so there are no fields to map." };
    }
    if (parsed.rows.length === 0) {
      return { error: "That file has headers but no data rows." };
    }

    const name =
      ((formData.get("name") as string | null) ?? "").trim() ||
      file.name.replace(/\.[^.]+$/, "");

    const sheet = await prisma.contentSheet.create({
      data: {
        companyId,
        name,
        sourceFilename: file.name,
        columns: JSON.stringify(parsed.columns),
        rows: {
          create: parsed.rows.map((data, index) => ({
            position: index,
            data: JSON.stringify(data),
            createdById: access.user.id,
          })),
        },
      },
    });
    sheetId = sheet.id;
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/c/${companyId}/sheets`);
  redirect(`/c/${companyId}/sheets/${sheetId}`);
}

export async function renameSheetAction(
  companyId: string,
  sheetId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireCompanyAccess(companyId, "member");
    const name = ((formData.get("name") as string | null) ?? "").trim();
    if (!name) return { error: "Give the sheet a name." };
    await prisma.contentSheet.updateMany({ where: { id: sheetId, companyId }, data: { name } });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/c/${companyId}/sheets/${sheetId}`);
  return { ok: "Renamed." };
}

export async function deleteSheetAction(companyId: string, sheetId: string): Promise<void> {
  await requireCompanyAccess(companyId, "admin");
  await prisma.contentSheet.deleteMany({ where: { id: sheetId, companyId } });
  revalidatePath(`/c/${companyId}/sheets`);
  redirect(`/c/${companyId}/sheets`);
}

/** Add a column to the sheet's header list. Existing rows simply have it blank. */
export async function addColumnAction(
  companyId: string,
  sheetId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await requireCompanyAccess(companyId, "member");
    const column = ((formData.get("column") as string | null) ?? "").trim();
    if (!column) return { error: "Name the column." };

    const sheet = await prisma.contentSheet.findFirst({ where: { id: sheetId, companyId } });
    if (!sheet) return { error: "Sheet not found." };

    const columns = parseStringArray(sheet.columns);
    if (columns.some((c) => c.toLowerCase() === column.toLowerCase())) {
      return { error: `"${column}" is already a column.` };
    }
    await prisma.contentSheet.update({
      where: { id: sheet.id },
      data: { columns: JSON.stringify([...columns, column]) },
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/c/${companyId}/sheets/${sheetId}`);
  return { ok: "Column added." };
}

export async function addRowAction(companyId: string, sheetId: string): Promise<void> {
  const access = await requireCompanyAccess(companyId, "member");
  const sheet = await prisma.contentSheet.findFirst({ where: { id: sheetId, companyId } });
  if (!sheet) throw new AuthError("Sheet not found.", 404);

  const last = await prisma.sheetRow.findFirst({
    where: { sheetId },
    orderBy: { position: "desc" },
  });
  const blank = Object.fromEntries(parseStringArray(sheet.columns).map((c) => [c, ""]));

  await prisma.sheetRow.create({
    data: {
      sheetId,
      position: (last?.position ?? -1) + 1,
      data: JSON.stringify(blank),
      createdById: access.user.id,
    },
  });
  revalidatePath(`/c/${companyId}/sheets/${sheetId}`);
}

/** Duplicate a row -- the common way to start a new email from an existing one. */
export async function duplicateRowAction(companyId: string, rowId: string): Promise<void> {
  const access = await requireCompanyAccess(companyId, "member");
  const row = await prisma.sheetRow.findFirst({
    where: { id: rowId, sheet: { companyId } },
  });
  if (!row) throw new AuthError("Row not found.", 404);

  await prisma.$transaction([
    prisma.sheetRow.updateMany({
      where: { sheetId: row.sheetId, position: { gt: row.position } },
      data: { position: { increment: 1 } },
    }),
    prisma.sheetRow.create({
      data: {
        sheetId: row.sheetId,
        position: row.position + 1,
        data: row.data,
        createdById: access.user.id,
      },
    }),
  ]);
  revalidatePath(`/c/${companyId}/sheets/${row.sheetId}`);
}

export async function deleteRowAction(companyId: string, rowId: string): Promise<void> {
  await requireCompanyAccess(companyId, "member");
  const row = await prisma.sheetRow.findFirst({ where: { id: rowId, sheet: { companyId } } });
  if (!row) return;
  await prisma.sheetRow.delete({ where: { id: rowId } });
  revalidatePath(`/c/${companyId}/sheets/${row.sheetId}`);
}

export interface SaveRowResult {
  ok: boolean;
  error?: string;
  updatedAt?: string;
}

/**
 * Persist edits made in the preview. The previous values are kept as a
 * RowRevision so a collaborator's change is always recoverable.
 */
export async function saveRowAction(
  companyId: string,
  rowId: string,
  values: Record<string, string>,
  note?: string,
): Promise<SaveRowResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const row = await prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      include: { sheet: true },
    });
    if (!row) return { ok: false, error: "Row not found." };

    const previous = parseRecord(row.data);
    const next: Record<string, string> = { ...previous };
    for (const [key, value] of Object.entries(values)) {
      next[key] = value == null ? "" : String(value);
    }

    if (JSON.stringify(previous) === JSON.stringify(next)) {
      return { ok: true, updatedAt: row.updatedAt.toISOString() };
    }

    // Any header the preview introduced becomes a real column on the sheet.
    const columns = parseStringArray(row.sheet.columns);
    const lowered = new Set(columns.map((c) => c.toLowerCase()));
    const added = Object.keys(next).filter((k) => !lowered.has(k.toLowerCase()));

    const [, updated] = await prisma.$transaction([
      prisma.rowRevision.create({
        data: {
          rowId: row.id,
          data: JSON.stringify(previous),
          changedById: access.user.id,
          note: note || null,
        },
      }),
      prisma.sheetRow.update({ where: { id: row.id }, data: { data: JSON.stringify(next) } }),
      ...(added.length > 0
        ? [
            prisma.contentSheet.update({
              where: { id: row.sheetId },
              data: { columns: JSON.stringify([...columns, ...added]) },
            }),
          ]
        : []),
    ]);

    revalidatePath(`/c/${companyId}/sheets/${row.sheetId}`);
    return { ok: true, updatedAt: updated.updatedAt.toISOString() };
  } catch (error) {
    const message = fail(error).error;
    return { ok: false, error: message };
  }
}

/** Roll a row back to the values captured in one of its revisions. */
export async function restoreRevisionAction(
  companyId: string,
  revisionId: string,
): Promise<void> {
  const access = await requireCompanyAccess(companyId, "member");
  const revision = await prisma.rowRevision.findFirst({
    where: { id: revisionId, row: { sheet: { companyId } } },
    include: { row: true },
  });
  if (!revision) throw new AuthError("Revision not found.", 404);

  await prisma.$transaction([
    prisma.rowRevision.create({
      data: {
        rowId: revision.rowId,
        data: revision.row.data,
        changedById: access.user.id,
        note: "Before restore",
      },
    }),
    prisma.sheetRow.update({ where: { id: revision.rowId }, data: { data: revision.data } }),
  ]);
  revalidatePath(`/c/${companyId}/sheets/${revision.row.sheetId}`);
}
