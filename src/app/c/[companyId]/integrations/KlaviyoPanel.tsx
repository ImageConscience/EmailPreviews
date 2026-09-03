"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  connectKlaviyoAction,
  disconnectKlaviyoAction,
  saveKlaviyoSettingsAction,
} from "@/actions/klaviyo";
import { TIMEZONES } from "@/lib/zone";

export interface KlaviyoState {
  connected: boolean;
  keyHint: string | null;
  accountName: string | null;
  accountId: string | null;
  linkedAt: string | null;
  fromEmail: string;
  fromLabel: string;
  replyTo: string;
  timezone: string;
  /** False when the deployment has no ENCRYPTION_KEY, so nothing can be stored. */
  canStoreSecrets: boolean;
}

/**
 * Connecting a client's Klaviyo account.
 *
 * The screen is built around one question the person has to be able to answer
 * before they push anything: *whose account is this*. So the account name
 * Klaviyo reports is the largest thing here once connected, and the key itself
 * is never shown again -- only its last four characters, which is enough to
 * tell two keys apart and useless to anyone who reads it over a shoulder.
 */
export function KlaviyoPanel({
  companyId,
  canEdit,
  state,
}: {
  companyId: string;
  canEdit: boolean;
  state: KlaviyoState;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const [fromEmail, setFromEmail] = useState(state.fromEmail);
  const [fromLabel, setFromLabel] = useState(state.fromLabel);
  const [replyTo, setReplyTo] = useState(state.replyTo);
  const [timezone, setTimezone] = useState(state.timezone);

  const connect = async () => {
    setBusy("Asking Klaviyo whose key this is…");
    setError(null);
    setNote(null);
    const result = await connectKlaviyoAction(companyId, apiKey);
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "Could not connect.");
      return;
    }
    setApiKey("");
    setNote(`Connected to ${result.accountName}.`);
    router.refresh();
  };

  const disconnect = async () => {
    setBusy("Disconnecting…");
    setError(null);
    const result = await disconnectKlaviyoAction(companyId);
    setBusy(null);
    setConfirmOff(false);
    if (!result.ok) {
      setError(result.error ?? "Could not disconnect.");
      return;
    }
    setNote("Key removed. Campaigns already in Klaviyo are untouched.");
    router.refresh();
  };

  const saveSettings = async () => {
    setBusy("Saving…");
    setError(null);
    setNote(null);
    const result = await saveKlaviyoSettingsAction(companyId, {
      fromEmail,
      fromLabel,
      replyTo,
      timezone,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    setNote("Saved.");
    router.refresh();
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>Klaviyo</h2>
        <div className="spacer" />
        {state.connected && <span className="pill pill-ok">Connected</span>}
      </div>

      <div className="card-pad">
        {!state.canStoreSecrets && (
          <p className="hint" style={{ color: "var(--danger)" }}>
            This deployment has no <code>ENCRYPTION_KEY</code> set, so an API key cannot be stored
            safely. Set one before connecting an account.
          </p>
        )}

        {state.connected ? (
          <>
            {/* The account name is the headline, because the mistake worth
                catching is a working key pointed at the wrong client. */}
            <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600 }}>
              {state.accountName}
            </p>
            <p className="hint" style={{ marginTop: 0 }}>
              Site ID <code>{state.accountId}</code> · key {state.keyHint}
              {state.linkedAt ? ` · connected ${new Date(state.linkedAt).toLocaleDateString()}` : ""}
            </p>

            <div className="field" style={{ marginTop: 16 }}>
              <span>From address</span>
              <input
                type="email"
                value={fromEmail}
                disabled={!canEdit}
                placeholder="hello@theirdomain.com"
                onChange={(e) => setFromEmail(e.target.value)}
              />
              <p className="hint">
                Must be an address Klaviyo has verified for this account, or the campaign will not
                send.
              </p>
            </div>

            <div className="field">
              <span>From name</span>
              <input
                type="text"
                value={fromLabel}
                disabled={!canEdit}
                placeholder="Their Brand"
                onChange={(e) => setFromLabel(e.target.value)}
              />
            </div>

            <div className="field">
              <span>Reply-to (optional)</span>
              <input
                type="email"
                value={replyTo}
                disabled={!canEdit}
                onChange={(e) => setReplyTo(e.target.value)}
              />
            </div>

            <div className="field">
              <span>Send times are in</span>
              <select value={timezone} disabled={!canEdit} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace("_", " ")}
                  </option>
                ))}
              </select>
              <p className="hint">
                The sheet says <code>10:00</code>; this is the clock it means. Daylight saving is
                worked out per date, so a send in January and one in July both go at ten.
              </p>
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void saveSettings()}>
                  Save
                </button>
                {confirmOff ? (
                  <>
                    <span className="hint" style={{ margin: 0 }}>Remove the stored key?</span>
                    <button type="button" className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => void disconnect()}>
                      Remove
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setConfirmOff(false)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmOff(true)}>
                    Disconnect
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              Paste a private API key to push approved emails into this client&rsquo;s Klaviyo as
              campaigns. The key is encrypted before it is stored and is never shown again.
            </p>
            <div className="field">
              <span>Private API key</span>
              <input
                type="password"
                value={apiKey}
                disabled={!canEdit || !state.canStoreSecrets}
                placeholder="pk_…"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!busy || !apiKey.trim() || !state.canStoreSecrets}
                onClick={() => void connect()}
              >
                Connect
              </button>
            )}
          </>
        )}

        {busy && <p className="hint">{busy}</p>}
        {note && <p className="hint" style={{ color: "var(--ok)" }}>{note}</p>}
        {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}
