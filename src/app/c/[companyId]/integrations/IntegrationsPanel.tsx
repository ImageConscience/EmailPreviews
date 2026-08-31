"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveShopDomainAction, syncCatalogAction, type SyncResult } from "@/actions/catalog";

interface SampleProduct {
  id: string;
  title: string;
  price: string | null;
  imageUrl: string | null;
  available: boolean;
}

export function IntegrationsPanel({
  companyId,
  canEdit,
  domain,
  syncedAt,
  productCount,
  sample,
}: {
  companyId: string;
  canEdit: boolean;
  domain: string;
  syncedAt: string | null;
  productCount: number;
  sample: SampleProduct[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(domain);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const save = async () => {
    setBusy("Saving…");
    setError(null);
    setResult(null);
    const saved = await saveShopDomainAction(companyId, value);
    if (!saved.ok) {
      setBusy(null);
      setError(saved.error ?? "Could not save that.");
      return;
    }
    setValue(saved.domain ?? "");
    if (!saved.domain) {
      setBusy(null);
      router.refresh();
      return;
    }
    // Saving a domain and then having to press Sync separately is a step with
    // no decision in it, so the first sync runs straight away.
    setBusy("Reading the storefront…");
    const synced = await syncCatalogAction(companyId);
    setBusy(null);
    if (!synced.ok) setError(synced.error ?? "The sync failed.");
    else setResult(synced);
    router.refresh();
  };

  const sync = async () => {
    setBusy("Reading the storefront…");
    setError(null);
    setResult(null);
    const synced = await syncCatalogAction(companyId);
    setBusy(null);
    if (!synced.ok) setError(synced.error ?? "The sync failed.");
    else setResult(synced);
    router.refresh();
  };

  return (
    <>
      <div className="card card-pad">
        <h2 style={{ marginBottom: 4 }}>Product catalog</h2>
        <p className="hint" style={{ marginBottom: 14 }}>
          Give the storefront domain and every product is cached here, so filling a product
          tile in the preview is one click instead of pasting an image, a title, a price and
          a link. Nothing is written to the store — this only reads.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {busy && <div className="alert alert-warn">{busy}</div>}
        {result?.ok && (
          <div className="alert alert-ok">
            {result.total} {result.total === 1 ? "product" : "products"} in the catalog
            {result.added ? ` · ${result.added} new` : ""}
            {result.removed ? ` · ${result.removed} removed` : ""}.
          </div>
        )}

        <label className="field">
          <span>Storefront domain</span>
          <input
            type="text"
            value={value}
            placeholder="museumofgraffiti.com"
            disabled={!canEdit || Boolean(busy)}
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="hint">
            Paste the address of the shop; the rest of the URL is trimmed off. Leave it empty
            for a company that sells nothing.
          </span>
        </label>

        {canEdit && (
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save()}>
              Save{value.trim() ? " and sync" : ""}
            </button>
            {domain && (
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void sync()}>
                Sync now
              </button>
            )}
          </div>
        )}
        {!canEdit && (
          <p className="hint">Only an admin or owner can change this.</p>
        )}
      </div>

      {domain && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <h2>Cached products</h2>
            <div className="spacer" />
            <span className="hint" style={{ marginTop: 0 }}>
              {productCount} {productCount === 1 ? "product" : "products"}
              {syncedAt ? ` · synced ${new Date(syncedAt).toLocaleString()}` : ""}
            </span>
          </div>
          {productCount === 0 ? (
            <div className="empty">
              <h3>Nothing cached yet</h3>
              <p>Press Sync now to read the storefront.</p>
            </div>
          ) : (
            <div className="card-pad">
              <div className="picker-grid">
                {sample.map((product) => (
                  <div className="picker-item" key={product.id}>
                    <span className="box">
                      {product.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={product.imageUrl} alt={product.title} />
                      ) : null}
                    </span>
                    <span className="cap">
                      {product.title}
                      {product.price ? ` · $${product.price}` : ""}
                      {product.available ? "" : " · sold out"}
                    </span>
                  </div>
                ))}
              </div>
              {productCount > sample.length && (
                <p className="hint" style={{ marginTop: 10 }}>
                  Showing {sample.length} of {productCount}. The rest are searchable from the
                  preview.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
