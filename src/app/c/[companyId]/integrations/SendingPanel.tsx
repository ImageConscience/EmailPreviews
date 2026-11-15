"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  checkBaseTemplateAction,
  connectProviderAction,
  disconnectProviderAction,
  saveSendingSettingsAction,
  setEmailProviderAction,
  type BaseTemplateReport,
} from "@/actions/esp";
import { AudienceChooser, useAudiences } from "@/components/AudienceChooser";
import {
  EMAIL_PROVIDERS,
  PROVIDER_ACCOUNT_LABELS,
  PROVIDER_KEY_HELP,
  PROVIDER_LABELS,
  type EmailProviderId,
} from "@/lib/esp/types";
import { TIMEZONES } from "@/lib/zone";

export interface SendingState {
  /** Which platform this company sends through. */
  provider: EmailProviderId;
  connected: boolean;
  keyHint: string | null;
  accountName: string | null;
  accountId: string | null;
  linkedAt: string | null;
  fromEmail: string;
  fromLabel: string;
  replyTo: string;
  timezone: string;
  baseTemplateId: string;
  audience: string;
  audienceExclude: string;
  /** False when the deployment has no ENCRYPTION_KEY, so nothing can be stored. */
  canStoreSecrets: boolean;
}

/**
 * Connecting a client's sending platform.
 *
 * The screen is built around one question the person has to be able to answer
 * before they push anything: *whose account is this*. So the account name the
 * platform reports is the largest thing here once connected, and the key itself
 * is never shown again -- only its last four characters, which is enough to
 * tell two keys apart and useless to anyone who reads it over a shoulder.
 *
 * The platform choice sits above all of it, because it decides what the rest of
 * the form means: a base template is Klaviyo's whole content model and nothing
 * at all to Attentive, so that field appears and disappears with the choice
 * rather than sitting there inert.
 */
export function SendingPanel({
  companyId,
  canEdit,
  state,
}: {
  companyId: string;
  canEdit: boolean;
  state: SendingState;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // Which platform the key field is for. Starts at the company's choice, and
  // while disconnected it is just a local pick -- nothing is written until a
  // key is accepted, so changing your mind costs nothing.
  const [picked, setPicked] = useState<EmailProviderId>(state.provider);
  const [switchTo, setSwitchTo] = useState<EmailProviderId | null>(null);

  const [fromEmail, setFromEmail] = useState(state.fromEmail);
  const [fromLabel, setFromLabel] = useState(state.fromLabel);
  const [replyTo, setReplyTo] = useState(state.replyTo);
  const [timezone, setTimezone] = useState(state.timezone);
  const [baseTemplateId, setBaseTemplateId] = useState(state.baseTemplateId);
  const [audience, setAudience] = useState(state.audience);
  const [audienceExclude, setAudienceExclude] = useState(state.audienceExclude);
  // Only worth a round trip once there is a key to make it with.
  const audiences = useAudiences(companyId, state.connected);
  const [report, setReport] = useState<BaseTemplateReport | null>(null);

  const label = PROVIDER_LABELS[state.provider];
  const needsBaseTemplate = state.provider === "klaviyo";

  const connect = async () => {
    setBusy(`Asking ${PROVIDER_LABELS[picked]} whose key this is…`);
    setError(null);
    setNote(null);
    const result = await connectProviderAction(companyId, picked, apiKey);
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
    const result = await disconnectProviderAction(companyId);
    setBusy(null);
    setConfirmOff(false);
    if (!result.ok) {
      setError(result.error ?? "Could not disconnect.");
      return;
    }
    setNote(`Key removed. Campaigns already in ${label} are untouched.`);
    router.refresh();
  };

  /**
   * Move the company to another platform.
   *
   * This drops the stored key, so it asks first. A key for one platform is
   * meaningless to the other, and leaving it in place would make the company
   * look connected while every call went to the wrong place.
   */
  const switchProvider = async (next: EmailProviderId) => {
    setBusy(`Switching to ${PROVIDER_LABELS[next]}…`);
    setError(null);
    setNote(null);
    const result = await setEmailProviderAction(companyId, next);
    setBusy(null);
    setSwitchTo(null);
    if (!result.ok) {
      setError(result.error ?? "Could not switch platform.");
      return;
    }
    setPicked(next);
    setNote(
      next === "attentive"
        ? "Now set to Attentive. No key is needed: approved emails are handed off through Claude."
        : `Now set to ${PROVIDER_LABELS[next]}. Paste a key for it to connect.`,
    );
    router.refresh();
  };

  const saveSettings = async () => {
    setBusy("Saving…");
    setError(null);
    setNote(null);
    const result = await saveSendingSettingsAction(companyId, {
      fromEmail,
      fromLabel,
      replyTo,
      timezone,
      baseTemplateId,
      audience,
      audienceExclude,
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
        <h2>Sending</h2>
        <div className="spacer" />
        {state.connected && <span className="pill pill-ok">{label} connected</span>}
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
            {state.provider === "attentive" ? (
              <p className="hint" style={{ marginTop: 0 }}>
                Attentive · no key held. Its published API cannot create campaigns, so approved
                emails are handed off to Claude, which builds them in Attentive through
                Attentive&rsquo;s own connector and records each one here. Audiences come from the
                segment list Claude last saved.
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 600 }}>
                  {state.accountName}
                </p>
                <p className="hint" style={{ marginTop: 0 }}>
                  {label} · {PROVIDER_ACCOUNT_LABELS[state.provider]}{" "}
                  <code>{state.accountId}</code> · key {state.keyHint}
                  {state.linkedAt ? ` · connected ${new Date(state.linkedAt).toLocaleDateString()}` : ""}
                </p>
              </>
            )}

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
                Must be an address {label} has verified for this account, or the campaign will not
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

            {/* Klaviyo will not take raw HTML in a campaign, so the content has
                to go into a block inside one of the client's own templates.
                Attentive takes the document, so there is nothing to choose. */}
            {needsBaseTemplate ? (
              <div className="field">
                <span>Base template ID</span>
                <input
                  type="text"
                  value={baseTemplateId}
                  disabled={!canEdit}
                  placeholder="XyZ123"
                  onChange={(e) => setBaseTemplateId(e.target.value)}
                />
                <p className="hint">
                  The drag-and-drop template in Klaviyo holding your header, footer and unsubscribe.
                  Each send clones it and fills the HTML block marked{" "}
                  <code>&lt;!-- EMAILPREVIEWS:CONTENT --&gt;</code>. With only one HTML block in the
                  template the marker is optional. The ID is in the editor URL:{" "}
                  <code>klaviyo.com/email-editor/<strong>ID</strong>/edit</code>.
                </p>
                {/* The same read a push makes, on its own, so a setup question
                    costs a second rather than a real campaign. */}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!!busy || !baseTemplateId.trim()}
                  onClick={() => {
                    setBusy("Reading the template from Klaviyo…");
                    setReport(null);
                    void checkBaseTemplateAction(companyId).then((result) => {
                      setBusy(null);
                      setReport(result);
                    });
                  }}
                >
                  Check this template
                </button>
                {/* Green only when a push would actually work. A template that
                    reads fine at some other revision is not a pass: the push
                    uses the configured one and will keep failing. */}
                {report && (
                  <div
                    className={
                      "tpl-report" +
                      (!report.ok ? " is-bad" : report.worksAt ? " is-warn" : " is-ok")
                    }
                  >
                    {report.ok ? (
                      <>
                        <strong>{report.name}</strong> — {report.editorType}, {report.htmlBlocks} HTML{" "}
                        {report.htmlBlocks === 1 ? "block" : "blocks"}
                        {report.marked ? ", one of them marked" : ""}. {report.note}
                      </>
                    ) : (
                      <>{report.error}</>
                    )}
                    <div className="hint" style={{ marginTop: 4 }}>
                      {/* Name the revision that actually produced this, which is
                          not the configured one when the search had to rescue it. */}
                      Read using Klaviyo API revision{" "}
                      <code>{report.worksAt ?? report.revision}</code>
                      {report.readBy ? <> (asked via <code>{report.readBy}</code>)</> : null}.
                      {report.worksAt && (
                        <>
                          {" "}This deployment is set to <code>{report.revision}</code>, which cannot
                          read the definition. Set <code>KLAVIYO_API_REVISION</code> to{" "}
                          <code>{report.worksAt}</code>, or pushes will keep failing.
                        </>
                      )}
                    </div>
                    {report.tried && report.tried.length > 0 && (
                      <ul className="tpl-tried">
                        {report.tried.map((attempt, i) => (
                          <li key={`${attempt.revision}-${i}`}>
                            <code>{attempt.revision}</code>
                            {attempt.answeredAs && attempt.answeredAs !== attempt.revision && (
                              <> (answered as <code>{attempt.answeredAs}</code>)</>
                            )}
                            {" — "}
                            {attempt.result}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Spaced away from the reply-to field above it, which it would
              // otherwise read as a note about.
              <p className="hint" style={{ marginTop: 16 }}>
                {label} takes each email as HTML, so there is no base template to set. The rendered
                email goes straight into the campaign.
              </p>
            )}

            {/*
              Most of a client's campaigns go to the same place, so this is set
              once here and a row only names an audience when it differs. It is
              also the difference between a working queue and a broken one: an
              audience filled into every row after the fact would make every
              sign-off on those rows stale, since an approval is fingerprinted
              against the row it was given on.
            */}
            <div className="field aud-setting">
              <span>Default audience</span>
              <AudienceChooser
                state={audiences}
                value={audience}
                onChange={setAudience}
                empty="Nobody — every row will have to name its own"
              />
              <p className="hint">
                Where a campaign goes when its row does not say otherwise. A row that names one
                overrides this.
              </p>
            </div>

            <div className="field aud-setting">
              <span>Always exclude</span>
              <AudienceChooser
                state={audiences}
                value={audienceExclude}
                onChange={setAudienceExclude}
                empty="No exclusions"
              />
              <p className="hint">
                Suppressed on every send that does not name its own exclusions — a recent-buyers
                segment, say.
              </p>
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
              <>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void saveSettings()}>
                    Save
                  </button>
                  {state.provider === "attentive" ? null : confirmOff ? (
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

                {/* Switching platforms is a bigger thing than it looks, so it
                    sits at the bottom and says what it costs before it does it. */}
                <div style={{ marginTop: 16 }}>
                  {switchTo ? (
                    <p className="hint" style={{ margin: 0 }}>
                      Switch this company to <strong>{PROVIDER_LABELS[switchTo]}</strong>? The stored{" "}
                      {label} key is removed and you will need a {PROVIDER_LABELS[switchTo]} key to
                      push again. Campaigns already pushed to {label} are left alone.{" "}
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={!!busy}
                        onClick={() => void switchProvider(switchTo)}
                      >
                        Switch
                      </button>{" "}
                      <button type="button" className="btn btn-sm" onClick={() => setSwitchTo(null)}>
                        Cancel
                      </button>
                    </p>
                  ) : (
                    <p className="hint" style={{ margin: 0 }}>
                      Sending through {label}.
                      {EMAIL_PROVIDERS.filter((id) => id !== state.provider).map((id) => (
                        <span key={id}>
                          {" "}
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={!!busy}
                            onClick={() => setSwitchTo(id)}
                          >
                            Use {PROVIDER_LABELS[id]} instead
                          </button>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              Pick where this client&rsquo;s approved emails should go, then paste a private key for
              it. The key is encrypted before it is stored and is never shown again.
            </p>

            <div className="field">
              <span>Sending platform</span>
              <select
                value={picked}
                disabled={!canEdit}
                onChange={(e) => setPicked(e.target.value as EmailProviderId)}
              >
                {EMAIL_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </option>
                ))}
              </select>
              <p className="hint">
                Everything this app does for this company — looking up audiences, creating
                campaigns, scheduling them — goes through the one you pick.
              </p>
            </div>

            {picked === "attentive" ? (
              <>
                <p className="hint">{PROVIDER_KEY_HELP.attentive}</p>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busy}
                    onClick={() => void switchProvider("attentive")}
                  >
                    Use Attentive
                  </button>
                )}
              </>
            ) : (
            <>
            <div className="field">
              <span>Private key</span>
              <input
                type="password"
                value={apiKey}
                disabled={!canEdit || !state.canStoreSecrets}
                placeholder={picked === "klaviyo" ? "pk_…" : "Private app key"}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="hint">{PROVIDER_KEY_HELP[picked]}</p>
            </div>
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!!busy || !apiKey.trim() || !state.canStoreSecrets}
                onClick={() => void connect()}
              >
                Connect {PROVIDER_LABELS[picked]}
              </button>
            )}
            </>
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
