"use client";

import { useState, useTransition } from "react";
import { saveSmsSettingsAction, setSmsKeyAction } from "@/actions/sms";
import { AudienceChooser, useSmsAudiences } from "@/components/AudienceChooser";

export interface TextingState {
  provider: string | null;
  audience: string;
  exclude: string;
  addOptOut: boolean;
  /** A Klaviyo key just for texts is stored. */
  ownKey: boolean;
  ownKeyHint: string | null;
  ownAccountName: string | null;
  /** The email goes to Klaviyo with a key, so texts can use that one. */
  emailKlaviyoKey: boolean;
  emailAccountName: string | null;
  canStoreSecrets: boolean;
}

/**
 * Where this company's texts go, separate from where its email goes.
 *
 * Klaviyo can reuse the email key when the email is also on Klaviyo, which is
 * the usual case; a key of its own is only needed otherwise. Attentive takes no
 * key here at all: texts and audiences go through a person's Claude session and
 * Attentive's own connector, and this panel says so rather than asking for one.
 *
 * The default audiences are picked from the real ones, the same way email's
 * are. Where that list comes from differs by platform -- Klaviyo answers live,
 * Attentive's is the copy Claude last saved -- and the picker says which, since
 * a typed name that no longer exists is only discovered at the moment somebody
 * was trying to send.
 */
export function TextingPanel({
  companyId,
  canEdit,
  state,
}: {
  companyId: string;
  canEdit: boolean;
  state: TextingState;
}) {
  const [provider, setProvider] = useState(state.provider ?? "");
  // Read against the saved platform, not the one in the dropdown: until a
  // switch is saved, the list on screen still belongs to the old platform.
  const audiences = useSmsAudiences(companyId, Boolean(state.provider));
  const [audience, setAudience] = useState(state.audience);
  const [exclude, setExclude] = useState(state.exclude);
  const [addOptOut, setAddOptOut] = useState(state.addOptOut);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const switching = (state.provider ?? "") !== provider;
  const klaviyoKeyNote = state.ownKey
    ? `Using a texting key ending ${state.ownKeyHint}${state.ownAccountName ? ` for ${state.ownAccountName}` : ""}.`
    : state.emailKlaviyoKey
      ? `Using the email key${state.emailAccountName ? ` for ${state.emailAccountName}` : ""}. Make sure it has the images:write scope, which MMS needs.`
      : "The email does not go to Klaviyo, so texts need a Klaviyo key of their own.";

  const save = () =>
    start(async () => {
      setMessage(null);
      const result = await saveSmsSettingsAction(companyId, {
        provider: provider || null,
        audience,
        exclude,
        addOptOut,
      });
      setMessage(result.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: result.error ?? "Not saved." });
    });

  const saveKey = (value: string) =>
    start(async () => {
      setMessage(null);
      const result = await setSmsKeyAction(companyId, value);
      if (result.ok) {
        setKey("");
        setMessage({
          kind: "ok",
          text: value ? `Key saved${result.accountName ? ` for ${result.accountName}` : ""}.` : "Texts now use the email key.",
        });
      } else {
        setMessage({ kind: "error", text: result.error ?? "Not saved." });
      }
    });

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <h2 style={{ marginBottom: 6 }}>Texts (SMS / MMS)</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Chosen separately from email: a client can mail through one platform and text through another.
      </p>
      {message && <div className={`alert alert-${message.kind}`}>{message.text}</div>}

      <div className="row" style={{ alignItems: "flex-start", gap: 14, marginTop: 8 }}>
        <label className="field" style={{ flex: "0 1 220px" }}>
          <span>Texts go to</span>
          <select value={provider} disabled={!canEdit || pending} onChange={(e) => setProvider(e.target.value)}>
            <option value="">Not texting</option>
            <option value="klaviyo">Klaviyo</option>
            <option value="attentive">Attentive</option>
          </select>
          {switching && state.provider && (
            <span className="hint">Switching clears the default audiences: names from one platform mean nothing to the other.</span>
          )}
        </label>
        <div className="field aud-setting" style={{ flex: "1 1 220px" }}>
          <span>Default audience</span>
          <AudienceChooser
            state={audiences}
            value={audience}
            onChange={setAudience}
            empty="Nobody — every text will have to name its own"
            disabled={!canEdit || pending || switching || !state.provider}
          />
          <span className="hint">Used when a text does not name one. Several are allowed.</span>
        </div>
        <div className="field aud-setting" style={{ flex: "1 1 220px" }}>
          <span>Default exclusion</span>
          <AudienceChooser
            state={audiences}
            value={exclude}
            onChange={setExclude}
            empty="No exclusions"
            disabled={!canEdit || pending || switching || !state.provider}
          />
          <span className="hint">Suppressed on every text that does not name its own.</span>
        </div>
      </div>

      <label className="row" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={addOptOut}
          disabled={!canEdit || pending}
          onChange={(e) => setAddOptOut(e.target.checked)}
        />
        <span>
          Have the platform add the account’s opt-out wording (“Reply STOP…”). When off, every text
          must carry it in its own copy.
        </span>
      </label>

      {canEdit && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={pending} onClick={save}>
            Save texting settings
          </button>
        </div>
      )}

      {state.provider === "klaviyo" && (
        <div style={{ marginTop: 14 }}>
          <p className="hint">{klaviyoKeyNote}</p>
          {canEdit && (
            <div className="row">
              <input
                type="password"
                value={key}
                placeholder="pk_… (only if texts need their own key)"
                autoComplete="off"
                disabled={pending || !state.canStoreSecrets}
                onChange={(e) => setKey(e.target.value)}
                style={{ flex: "1 1 260px" }}
              />
              <button className="btn" disabled={pending || !key.trim()} onClick={() => saveKey(key)}>
                Check and save key
              </button>
              {state.ownKey && state.emailKlaviyoKey && (
                <button className="btn" disabled={pending} onClick={() => saveKey("")}>
                  Use the email key instead
                </button>
              )}
            </div>
          )}
          <p className="hint">Scopes texts need: accounts:read, campaigns:read, campaigns:write, images:write, lists:read, segments:read.</p>
        </div>
      )}

      {state.provider === "attentive" && (
        <div style={{ marginTop: 14 }}>
          {/* The audience pickers above now say how many segments are held and
              how old they are, so this says only what they cannot: why there is
              no key, and the words to say to refresh the list. */}
          <p className="hint">
            No key is needed or stored. Attentive’s published API cannot create campaigns, so texts
            (and Attentive emails) are built by Claude through Attentive’s own connector, and
            recorded here. To refresh the audiences above, ask Claude to “sync this company’s
            Attentive segments into Message Baker”.
          </p>
        </div>
      )}
    </div>
  );
}
