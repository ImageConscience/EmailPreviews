"use client";

import { useEffect, useState } from "react";
import { searchProductsAction, type ProductOption } from "@/actions/catalog";

/**
 * Fill a whole product tile from the company's catalog in one click.
 *
 * A tile is four or five cells -- image, title, price, link, sometimes a
 * description -- and pasting each from a browser tab is where the time went on
 * a category send with eight products. Picking here writes all of them.
 */
export function ProductPicker({
  companyId,
  group,
  onPick,
  onClose,
}: {
  companyId: string;
  /** The tile being filled, e.g. "product_3", shown so it is clear which. */
  group: string;
  onPick: (product: ProductOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ProductOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Typing a word at a time should not fire a query per keystroke.
    const timer = setTimeout(() => {
      searchProductsAction(companyId, query)
        .then((result) => {
          if (!cancelled) setItems(result);
        })
        .catch(() => {
          if (!cancelled) setError("Could not load the product catalog.");
        });
    }, query ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [companyId, query]);

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
      aria-label="Choose a product"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="picker">
        <div className="picker-head">
          <h2>Choose a product</h2>
          <span className="badge badge-accent">{group.replace(/_/g, " ")}</span>
          <div className="spacer" style={{ flex: 1 }} />
          <a
            href={`/c/${companyId}/integrations`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
          >
            Catalog settings
          </a>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="picker-body">
          {error && <div className="alert alert-error">{error}</div>}

          <input
            type="text"
            autoFocus
            placeholder="Search by title, type or tag…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ marginBottom: 12 }}
          />

          {items === null && !error && <p className="hint">Loading…</p>}

          {items && items.length === 0 && (
            <div className="empty">
              <h3>{query ? "Nothing matches" : "No products cached yet"}</h3>
              <p>
                {query ? (
                  "Try a shorter search."
                ) : (
                  <>
                    Set the storefront under{" "}
                    <a href={`/c/${companyId}/integrations`}>Integrations</a> and sync.
                  </>
                )}
              </p>
            </div>
          )}

          {items && items.length > 0 && (
            <div className="picker-grid">
              {items.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="picker-item"
                  onClick={() => {
                    onPick(product);
                    onClose();
                  }}
                  title={`${product.title}${product.price ? ` — $${product.price}` : ""}`}
                >
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
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
