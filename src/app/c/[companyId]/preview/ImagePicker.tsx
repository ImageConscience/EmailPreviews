"use client";

import { useEffect, useState } from "react";
import { listMediaAction, type MediaItem } from "@/actions/media";
import { LARGE_IMAGE_BYTES, RISKY_TYPES, formatBytes } from "@/lib/media";

/**
 * Choose an image from the company library for one field.
 *
 * Picking never replaces pasting: an image hosted anywhere else -- Constant
 * Contact's own library, a CDN -- stays perfectly valid, so the field remains a
 * plain text box and this is an additional way to fill it.
 */
export function ImagePicker({
  companyId,
  onPick,
  onClose,
}: {
  companyId: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMediaAction(companyId)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the image library.");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Choose an image"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="picker">
        <div className="picker-head">
          <h2>Choose an image</h2>
          <div className="spacer" style={{ flex: 1 }} />
          <a href={`/c/${companyId}/media`} target="_blank" rel="noreferrer" className="btn btn-sm">
            Manage library
          </a>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="picker-body">
          {error && <div className="alert alert-error">{error}</div>}
          {items === null && !error && <p className="hint">Loading…</p>}

          {items && items.length === 0 && (
            <div className="empty">
              <h3>No images uploaded yet</h3>
              <p>
                Add some under <a href={`/c/${companyId}/media`}>Images</a>, or paste any
                external URL straight into the field.
              </p>
            </div>
          )}

          {items && items.length > 0 && (
            <div className="picker-grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="picker-item"
                  onClick={() => {
                    onPick(item.url);
                    onClose();
                  }}
                  title={`${item.filename}\n${item.width ?? "?"}×${item.height ?? "?"} · ${formatBytes(item.size)}`}
                >
                  <span className="box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.filename} />
                  </span>
                  <span className="cap">
                    {item.filename}
                    {RISKY_TYPES.has(item.mimeType) ? " · WebP" : ""}
                    {item.size > LARGE_IMAGE_BYTES ? " · large" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
