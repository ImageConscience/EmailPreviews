import { avatarHue, initialsOf } from "@/lib/approval";

/**
 * One message on a row, ready to render.
 *
 * Carries the same `hue` and `initials` an approval does, from the same
 * functions, so a person looks like themselves wherever they turn up -- the
 * bubble beside the Approve button, the dot on the calendar, the avatar on
 * their note.
 */
export interface NoteView {
  id: string;
  /** Null when the author's account has been removed. */
  userId: string | null;
  name: string;
  initials: string;
  hue: number;
  body: string;
  at: string;
  /** Whether the person reading it wrote it, so their own notes can sit apart. */
  mine: boolean;
}

interface NoteRecord {
  id: string;
  userId: string | null;
  body: string;
  createdAt: Date;
  user: { name: string | null; email: string } | null;
}

/** A note whose author is gone still shows, and says so plainly. */
const DEPARTED = "Former member";

export function presentNotes(notes: NoteRecord[], currentUserId: string): NoteView[] {
  return notes.map((note) => ({
    id: note.id,
    userId: note.userId,
    name: note.user ? (note.user.name ?? note.user.email) : DEPARTED,
    initials: note.user ? initialsOf(note.user.name, note.user.email) : "–",
    // A missing author gets a neutral grey rather than a colour that would
    // read as somebody in particular.
    hue: note.userId ? avatarHue(note.userId) : 0,
    body: note.body,
    at: note.createdAt.toISOString(),
    mine: note.userId !== null && note.userId === currentUserId,
  }));
}

/**
 * How much of a note to keep.
 *
 * Generous, because a note is where someone explains a decision and the next
 * person along needs the reasoning rather than a summary of it. Long enough to
 * paste a paragraph of client feedback; short enough that a runaway paste
 * cannot bloat a row.
 */
export const NOTE_LIMIT = 4000;

/** Trim, collapse the runs of blank lines a paste leaves behind, and cap. */
export function cleanNote(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, NOTE_LIMIT);
}
