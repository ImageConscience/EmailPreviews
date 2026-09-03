"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addNoteAction, deleteNoteAction } from "@/actions/notes";
import { NOTE_LIMIT, type NoteView } from "@/lib/note";

/**
 * The row's conversation, kept out of the way until it is wanted.
 *
 * A flyout rather than a panel because the preview is already dense and the
 * notes are read at particular moments -- picking up someone else's work,
 * explaining a decision -- rather than continuously. The button carries the
 * count, so nothing has to be opened to find out whether there is anything
 * inside.
 *
 * Notes belong to the row, not the row-and-template pair an approval belongs
 * to, so the thread is the same whichever layout is on screen.
 */
export function NotesFlyout({
  companyId,
  rowId,
  count,
  onCountChange,
}: {
  companyId: string;
  rowId: string | null;
  /** Known before the thread is fetched, so the button can be honest at rest. */
  count: number;
  onCountChange: (rowId: string, count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  // Moving to another row is a different conversation.
  useEffect(() => {
    setOpen(false);
    setNotes(null);
    setDraft("");
    setError(null);
  }, [rowId]);

  useEffect(() => {
    if (!open || !rowId) return;
    let cancelled = false;
    fetch(`/api/c/${companyId}/rows/${rowId}/notes`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { notes: NoteView[] }) => {
        if (cancelled) return;
        setNotes(data.notes);
        onCountChange(rowId, data.notes.length);
      })
      .catch(() => !cancelled && setError("Could not load the notes."));
    return () => {
      cancelled = true;
    };
  }, [open, companyId, rowId, onCountChange]);

  // Newest at the foot, so opening a thread lands on the latest word.
  useEffect(() => {
    if (notes) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [notes]);

  // Click away and Escape both close it, the way a menu does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const post = useCallback(async () => {
    if (!rowId || busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    const result = await addNoteAction(companyId, rowId, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that note.");
      return;
    }
    setNotes(result.notes ?? []);
    onCountChange(rowId, (result.notes ?? []).length);
    setDraft("");
  }, [busy, companyId, draft, onCountChange, rowId]);

  const remove = useCallback(
    async (noteId: string) => {
      if (!rowId || busy) return;
      setBusy(true);
      const result = await deleteNoteAction(companyId, noteId);
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? "Could not remove that note.");
        return;
      }
      setNotes(result.notes ?? []);
      onCountChange(rowId, (result.notes ?? []).length);
    },
    [busy, companyId, onCountChange, rowId],
  );

  if (!rowId) return null;

  return (
    <div className="notes-wrap" ref={panel}>
      <button
        type="button"
        className={`btn btn-sm${count > 0 ? " has-notes" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={count > 0 ? `${count} ${count === 1 ? "note" : "notes"} on this row` : "Add a note"}
      >
        Notes{count > 0 ? ` (${count})` : ""}
      </button>

      {open && (
        <div className="notes-panel">
          <div className="notes-scroll">
            {notes === null && !error && <p className="hint">Loading…</p>}
            {notes !== null && notes.length === 0 && (
              <p className="hint">
                No notes yet. Anything written here is visible to everyone on this company.
              </p>
            )}
            {notes?.map((note) => (
              <div key={note.id} className={`note${note.mine ? " mine" : ""}`}>
                <span
                  className="av"
                  style={{
                    background: note.userId ? `hsl(${note.hue} 58% 42%)` : "var(--text-faint)",
                  }}
                  aria-hidden
                >
                  {note.initials}
                </span>
                <div className="note-body">
                  <div className="note-meta">
                    <strong>{note.name}</strong>
                    <span>{whenText(note.at)}</span>
                    {note.mine && (
                      <button
                        type="button"
                        className="note-remove"
                        onClick={() => void remove(note.id)}
                        disabled={busy}
                        title="Remove your note"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {/* Plain text, wrapped: someone's line breaks are part of
                      what they wrote, and nothing here is rendered as markup. */}
                  <p>{note.body}</p>
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>

          <div className="notes-compose">
            <textarea
              value={draft}
              maxLength={NOTE_LIMIT}
              rows={3}
              placeholder="Add a note for the team…"
              onChange={(e) => setDraft(e.target.value)}
              // Enter sends, Shift+Enter breaks the line -- the same bargain
              // every chat box makes, and the one people's hands expect.
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void post();
                }
              }}
            />
            <div className="notes-actions">
              {error ? <span className="note-error">{error}</span> : <span className="hint">Enter to send</span>}
              <div className="spacer" />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void post()}
                disabled={busy || !draft.trim()}
              >
                {busy ? "…" : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Today shows a clock; anything older shows a date, since that is what you ask. */
function whenText(iso: string): string {
  const at = new Date(iso);
  const sameDay = new Date().toDateString() === at.toDateString();
  return at.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
