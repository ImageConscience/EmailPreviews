"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteMediaAction, type MediaItem } from "@/actions/media";
import { LARGE_IMAGE_BYTES, MAX_IMAGE_BYTES, RISKY_TYPES, formatBytes } from "@/lib/media";
import type { StoreResult } from "@/lib/media-store";

export function MediaLibrary({
  companyId,
  items,
  canDelete,
}: {
  companyId: string;
  items: MediaItem[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StoreResult[]>([]);

  /**
   * One request per file rather than one for all of them: a single request
   * carrying six photos is the size of six photos, and a failure part way
   * through would say nothing about which one was at fault.
   */
  const upload = async (files: File[]) => {
    setError(null);
    setResults([]);

    const tooBig = files.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setError(
        `"${tooBig.name}" is ${formatBytes(tooBig.size)}, over the ${formatBytes(MAX_IMAGE_BYTES)} limit. Resize it and try again.`,
      );
      return;
    }

    const collected: StoreResult[] = [];
    for (const [index, file] of files.entries()) {
      setBusy(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const body = new FormData();
      body.append("files", file);
      try {
        const response = await fetch(`/api/c/${companyId}/media`, { method: "POST", body });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          collected.push({
            filename: file.name,
            status: "rejected",
            reason: payload.error ?? `Upload failed (HTTP ${response.status}).`,
          });
          continue;
        }
        const payload = (await response.json()) as { results: StoreResult[] };
        collected.push(...payload.results);
      } catch {
        collected.push({
          filename: file.name,
          status: "rejected",
          reason: "The upload did not reach the server. Check your connection and try again.",
        });
      }
    }

    setBusy(null);
    setResults(collected);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  const copy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked; the URL is still visible on the card */
    }
  };

  const added = results.filter((r) => r.status === "added").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const rejected = results.filter((r) => r.status === "rejected");

  return (
    <>
      <div className="card card-pad">
        <h2 style={{ marginBottom: 12 }}>Upload images</h2>

        {error && <div className="alert alert-error">{error}</div>}
        {busy && <div className="alert alert-warn">{busy}</div>}

        {results.length > 0 && !busy && (
          <>
            {(added > 0 || duplicates > 0) && (
              <div className="alert alert-ok">
                {[
                  added ? `${added} image${added === 1 ? "" : "s"} added` : "",
                  duplicates ? `${duplicates} already in the library` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </div>
            )}
            {rejected.length > 0 && (
              <div className="alert alert-error">
                {rejected.map((r) => (
                  <div key={r.filename}>
                    <strong>{r.filename}</strong> — {r.reason}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <label className="field">
          <span>Images</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            disabled={Boolean(busy)}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) void upload(files);
            }}
          />
          <span className="hint">
            PNG, JPEG, GIF or WebP, up to {formatBytes(MAX_IMAGE_BYTES)} each. Uploading starts as
            soon as you choose. The same file twice keeps one copy. SVG is not accepted &mdash;
            email clients cannot render it.
          </span>
        </label>
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
            <p>Upload an image above and it gets a permanent link you can use in any campaign.</p>
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
