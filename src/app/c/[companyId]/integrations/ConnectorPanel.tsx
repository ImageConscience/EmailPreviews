"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { mintTokenAction, revokeTokenAction, type TokenSummary } from "@/actions/tokens";

/**
 * Connect Claude, or anything else, to this content.
 *
 * The token is shown once. That is not a limitation to apologise for -- it is
 * why a leaked database is not a leaked set of credentials -- so the panel says
 * so plainly rather than hiding it in small print after the fact.
 */
export function ConnectorPanel({
  companyId,
  origin,
  tokens,
}: {
  companyId: string;
  origin: string;
  tokens: TokenSummary[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = `${origin}/api/mcp`;
  const live = tokens.filter((t) => !t.revokedAt);

  const mint = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await mintTokenAction(companyId, label);
      if (!result.ok || !result.token) setError(result.error ?? "That did not work.");
      else {
        setMinted(result.token);
        setLabel("");
        router.refresh();
      }
    } catch {
      setError("That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, name: string) => {
    if (!confirm(`Revoke “${name}”? Anything using it stops working immediately.`)) return;
    setBusy(true);
    try {
      const result = await revokeTokenAction(companyId, id);
      if (!result.ok) setError(result.error ?? "That did not work.");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Claude connector</h2>
      </div>
      <div className="card-pad">
        <p style={{ marginTop: 0 }}>
          Write campaign content in a Claude project and have it land here, instead of
          exporting a sheet and uploading the result. Claude reads each template&rsquo;s real
          field list before it writes, so it knows which fields take HTML and which ones this
          app works out for itself.
        </p>

        <label className="field">
          <span>Server URL</span>
          <input type="text" value={url} readOnly onFocus={(e) => e.target.select()} />
        </label>
        <p className="hint">
          Add this as a custom connector in Claude, then paste a token below when it asks
          you to sign in.
        </p>

        <hr style={{ margin: "22px 0", border: 0, borderTop: "1px solid var(--border)" }} />

        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Your tokens</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          A token is yours, not this company&rsquo;s: it reaches every company you belong to,
          with exactly the permissions you already have. It can never do anything you
          could not do yourself.
        </p>

        {minted && (
          <div className="tok-new">
            <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
              Copy this now — it is not shown again.
            </p>
            <code className="tok-value">{minted}</code>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(minted);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    /* Clipboard blocked; it is on screen to select. */
                  }
                }}
              >
                {copied ? "Copied" : "Copy token"}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setMinted(null)}>
                Done
              </button>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              Only the hash is kept, so nobody — including this app — can read it back. Lose
              it and you make another.
            </p>
          </div>
        )}

        {live.length > 0 && (
          <table className="tok-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Token</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.map((token) => (
                <tr key={token.id}>
                  <td>{token.label}</td>
                  <td>
                    <code>{token.prefix}…</code>
                  </td>
                  <td className="hint">
                    {token.lastUsedAt
                      ? new Date(token.lastUsedAt).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => revoke(token.id, token.label)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row" style={{ gap: 8, alignItems: "flex-end", marginTop: 14 }}>
          <label className="field" style={{ margin: 0, flex: "1 1 220px" }}>
            <span>New token</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What will use it — “Claude desktop”"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={mint} disabled={busy}>
            {busy ? "Working…" : "Create token"}
          </button>
        </div>

        {error && (
          <p className="hint" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
