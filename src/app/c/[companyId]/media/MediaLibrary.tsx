"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteMediaAction,
  uploadMediaAction,
  type MediaItem,
  type UploadState,
} from "@/actions/media";
import { LARGE_IMAGE_BYTES, RISKY_TYPES, formatBytes } from "@/lib/media";
import { SubmitButton } from "@/components/SubmitButton";

const initial: UploadState = {};

export function MediaLibrary({
  companyId,
  items,
  canDelete,
}: {
  companyId: string;
  items: MediaItem[];
  canDelete: boolean;
}) {
  const [state, upload] = useActionState(uploadMediaAction.bind(null, companyId), initial);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked; the URL is selectable in the field below */
    }
  };

  return (
    <>
      <div className="card card-pad">
        <h2 style={{ marginBottom: 12 }}>Upload images</h2>
        <form action={upload}>
          {state.error && <div className="alert alert-error">{state.error}</div>}
          {state.ok && <div className="alert alert-ok">{state.ok}</div>}
          <label className="field">
            <span>Images</span>
            <input type="file" name="files" accept="image/png,image/jpeg,image/gif,image/webp" multiple required />
            <span className="hint">
              PNG, JPEG, GIF or WebP, up to 8&nbsp;MB each. Uploading the same file twice keeps
              one copy. SVG is not accepted &mdash; email clients cannot render it.
            </span>
          </label>
          <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
        </form>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>Library</h2>
          <div className="spacer" />
          <span className="hint" style={{ marginTop: 0 }}>
            {items.length} {items.length === 1 ? "image" : "images"}
          </span>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <h3>Nothing here yet</h3>
            <p>
              Upload an image above and it gets a permanent link you can use in any campaign.
            </p>
          </div>
        ) : (
          <div className="card-pad">
            <div className="media-grid">
              {items.map((item) => (
                <div className="media-card" key={item.id}>
                  <div className="thumb-box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.filename} />
                  </div>
                  <div className="meta">
                    <div className="name" title={item.filename}>
                      {item.filename}
                    </div>
                    <div className="dim">
                      {item.width && item.height ? `${item.width}×${item.height} · ` : ""}
                      {formatBytes(item.size)} · {item.uploadedBy}
                    </div>
                    {RISKY_TYPES.has(item.mimeType) && (
                      <div className="media-warn">WebP — Outlook on Windows cannot show this</div>
                    )}
                    {item.size > LARGE_IMAGE_BYTES && (
                      <div className="media-warn">Over 1 MB — slow to load in an inbox</div>
                    )}
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void copy(item.url, item.id)}
                    >
                      {copied === item.id ? "Copied" : "Copy URL"}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete "${item.filename}"?\n\nAny email already sent using it will show a broken image.`,
                            )
                          )
                            return;
                          startTransition(() => deleteMediaAction(companyId, item.id));
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
