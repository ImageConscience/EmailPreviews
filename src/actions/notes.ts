"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { AuthError, requireCompanyAccess } from "@/lib/auth";
import { cleanNote, presentNotes, type NoteView } from "@/lib/note";

interface NoteResult {
  ok: boolean;
  error?: string;
  notes?: NoteView[];
}

/** Every note on a row, oldest first, the way a conversation reads. */
async function threadFor(rowId: string, currentUserId: string): Promise<NoteView[]> {
  const notes = await prisma.rowNote.findMany({
    where: { rowId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
  return presentNotes(notes, currentUserId);
}

/**
 * Add a note to a row.
 *
 * Returns the whole thread rather than the one note. Two people are often in
 * the same row at once, and handing back the thread means posting also catches
 * you up on anything said while you were typing.
 */
export async function addNoteAction(
  companyId: string,
  rowId: string,
  body: string,
): Promise<NoteResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const text = cleanNote(body);
    if (!text) return { ok: false, error: "Write something first." };

    const row = await prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { id: true },
    });
    if (!row) return { ok: false, error: "Row not found." };

    await prisma.rowNote.create({
      data: { rowId: row.id, userId: access.user.id, body: text },
    });

    revalidatePath(`/c/${companyId}/overview`);
    return { ok: true, notes: await threadFor(row.id, access.user.id) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not save that note." };
  }
}

/**
 * Remove one of your own notes.
 *
 * Only your own, for the same reason only you can add or withdraw your own
 * approval: a thread is worth reading precisely because nobody can edit what
 * someone else said in it.
 */
export async function deleteNoteAction(
  companyId: string,
  noteId: string,
): Promise<NoteResult> {
  try {
    const access = await requireCompanyAccess(companyId, "member");

    const note = await prisma.rowNote.findFirst({
      where: { id: noteId, row: { sheet: { companyId } } },
      select: { id: true, rowId: true, userId: true },
    });
    if (!note) return { ok: false, error: "Note not found." };
    if (note.userId !== access.user.id) return { ok: false, error: "That is not your note." };

    await prisma.rowNote.delete({ where: { id: note.id } });

    revalidatePath(`/c/${companyId}/overview`);
    return { ok: true, notes: await threadFor(note.rowId, access.user.id) };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not remove that note." };
  }
}
