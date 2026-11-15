"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  addTextAction,
  listSmsAudiencesAction,
  pushTextAction,
  saveTextAction,
  toggleTextApprovalAction,
  unscheduleTextAction,
} from "@/actions/sms";
import type { TextState } from "@/lib/sms-core";
import { analyseSms, checkSms, MMS_MAX_CHARACTERS } from "@/lib/sms";
import { SMS_FIELD_LABELS, smsLabel, type SmsField, type SmsRow } from "@/lib/sms-row";

interface Props {
  companyId: string;
  texts: TextState[];
  isAdmin: boolean;
  userId: string;
  provider: string | null;
  connected: boolean;
  addOptOut: boolean;
  defaultAudience: string;
  defaultExclude: string;
  timezone: string;
  attentiveSyncedAt: string | null;
}

const FIELDS: SmsField[] = ["name", "sendDate", "sendTime", "body", "image", "audience", "exclude"];

/** The draft is held as SmsRow fields; this maps them back to the reader's names. */
const DRAFT_KEY: Record<SmsField, keyof SmsRow> = {
  name: "name",
  body: "body",
  image: "imageUrl",
  sendDate: "sendDate",
  sendTime: "sendTime",
  audience: "audience",
  exclude: "exclude",
};

export function TextsBoard(props: Props) {
  const { companyId, texts, userId, provider, connected } = props;
  const visible = texts.filter((t) => !t.hidden);
  // ?row= from the overview, so clicking a text in the calendar opens that
  // text. Read once, as the opening selection: following it afterwards would
  // yank the screen away from whatever someone had since clicked on.
  const asked = useSearchParams().get("row");
  const [selectedId, setSelectedId] = useState<string | null>(
    (asked && texts.some((t) => t.rowId === asked) ? asked : null) ?? visible[0]?.rowId ?? null,
  );
  const selected = texts.find((t) => t.rowId === selectedId) ?? visible[0] ?? null;

  const [draft, setDraft] = useState<SmsRow | null>(selected?.sms ?? null);
  useEffect(() => setDraft(selected?.sms ?? null), [selected?.rowId, selected?.sms]);

  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string; list?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [audiences, setAudiences] = useState<{ id: string; name: string; kind: string }[]>([]);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    listSmsAudiencesAction(companyId).then((r) => {
      if (live && r.ok) setAudiences(r.audiences ?? []);
    });
    return () => {
      live = false;
    };
  }, [companyId, connected]);

  const dirty = useMemo(
    () => Boolean(selected && draft && JSON.stringify(draft) !== JSON.stringify(selected.sms)),
    [selected, draft],
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string; blockers?: string[]; notes?: string[] }>, done: string) =>
    start(async () => {
      setMessage(null);
      const result = await fn();
      if (result.ok) {
        setMessage({ kind: result.notes?.length ? "warn" : "ok", text: done, list: result.notes });
      } else {
        setMessage({ kind: "error", text: result.error ?? "That could not be done.", list: result.blockers });
      }
    });

  if (texts.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No texts yet</h3>
          <p>
            Upload a sheet under Settings → Content and choose “Texts”, or start one here. A text
            sheet needs only a name, message, optional image, send date and time, and audience.
          </p>
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => run(() => addTextAction(companyId), "Started a new text.")}
          >
            New text
          </button>
        </div>
      </div>
    );
  }

  const save = () => {
    if (!selected || !draft) return;
    const values: Record<string, string> = {};
    for (const field of FIELDS) values[selected.slots[field]] = draft[DRAFT_KEY[field]];
    run(() => saveTextAction(companyId, selected.rowId, values), "Saved.");
  };

  return (
    <div className="texts">
      <aside className="card texts-rail">
        <div className="card-head">
          <h2>Texts</h2>
          <span className="spacer" />
          <button
            className="btn btn-sm"
            disabled={pending}
            onClick={() => run(() => addTextAction(companyId), "Started a new text.")}
          >
            New
          </button>
        </div>
        <ul>
          {visible.map((t) => (
            <li key={t.rowId}>
              <button
                className={t.rowId === selected?.rowId ? "active" : ""}
                onClick={() => {
                  setSelectedId(t.rowId);
                  setMessage(null);
                }}
              >
                <span className="texts-label">{t.label}</span>
                <span className="hint">
                  {t.sms.sendDate || "No date"}
                  {t.sms.sendTime ? ` · ${t.sms.sendTime}` : ""}
                  {t.sms.imageUrl ? " · MMS" : ""}
                </span>
                <StatusBadges text={t} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {selected && draft && (
        <section className="texts-main">
          <div className="card card-pad">
            <div className="texts-edit">
              <div className="texts-fields">
                {FIELDS.map((field) => (
                  <label key={field} className="field">
                    <span>{SMS_FIELD_LABELS[field]}</span>
                    {field === "body" ? (
                      <textarea
                        rows={6}
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      />
                    ) : (
                      <input
                        type={field === "sendDate" ? "date" : field === "sendTime" ? "time" : "text"}
                        value={draft[DRAFT_KEY[field]]}
                        list={field === "audience" || field === "exclude" ? "sms-audiences" : undefined}
                        placeholder={
                          field === "audience"
                            ? props.defaultAudience
                              ? `Default: ${props.defaultAudience}`
                              : "List or segment name"
                            : field === "exclude"
                              ? props.defaultExclude
                                ? `Default: ${props.defaultExclude}`
                                : "Optional"
                              : field === "image"
                                ? "https://… .jpg / .png / .gif"
                                : undefined
                        }
                        onChange={(e) => setDraft({ ...draft, [DRAFT_KEY[field]]: e.target.value })}
                      />
                    )}
                    {field === "sendTime" && <span className="hint">In {props.timezone}.</span>}
                  </label>
                ))}
                <datalist id="sms-audiences">
                  {audiences.map((a) => (
                    <option key={`${a.kind}:${a.id}`} value={a.name}>
                      {a.kind}
                    </option>
                  ))}
                </datalist>
                {provider === "attentive" && (
                  <p className="hint">
                    Attentive segments{" "}
                    {props.attentiveSyncedAt
                      ? `as last saved by Claude on ${props.attentiveSyncedAt.slice(0, 10)}`
                      : "have not been saved yet — ask Claude to sync them"}
                    .
                  </p>
                )}
                <div className="row">
                  <button className="btn btn-primary" disabled={!dirty || pending} onClick={save}>
                    Save
                  </button>
                  {dirty && (
                    <button className="btn" disabled={pending} onClick={() => setDraft(selected.sms)}>
                      Discard
                    </button>
                  )}
                </div>
              </div>

              <PhonePreview draft={draft} addOptOut={props.addOptOut} />
            </div>
          </div>

          {message && (
            <div className={`alert alert-${message.kind}`} style={{ marginTop: 12 }}>
              {message.text}
              {message.list && message.list.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {message.list.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <SendPanel
            {...props}
            text={selected}
            dirty={dirty}
            pending={pending}
            mine={selected.approvals.find((a) => a.userId === userId) ?? null}
            onApprove={() =>
              run(() => toggleTextApprovalAction(companyId, selected.rowId), "Approval updated.")
            }
            onPush={(mode) =>
              run(
                () => pushTextAction(companyId, selected.rowId, mode),
                mode === "scheduled" ? "Scheduled in Klaviyo." : "Saved as a draft in Klaviyo.",
              )
            }
            onUnschedule={() =>
              run(() => unscheduleTextAction(companyId, selected.rowId), "Taken out of the send queue.")
            }
          />
        </section>
      )}
    </div>
  );
}

function StatusBadges({ text }: { text: TextState }) {
  const approved = text.approvals.some((a) => a.current && a.admin);
  const stale = text.approvals.some((a) => !a.current);
  return (
    <span className="row" style={{ gap: 4, marginTop: 4 }}>
      {approved && <span className="badge badge-ok">Approved</span>}
      {!approved && stale && <span className="badge badge-warn">Approval stale</span>}
      {text.push && (
        <span className={`badge ${text.push.stale ? "badge-warn" : "badge-accent"}`}>
          {text.push.status === "scheduled" ? "Scheduled" : "Draft"}
          {text.push.stale ? " (edited since)" : ""}
        </span>
      )}
    </span>
  );
}

/** The message as a phone shows it, with the count beneath. */
function PhonePreview({ draft, addOptOut }: { draft: SmsRow; addOptOut: boolean }) {
  const mms = Boolean(draft.imageUrl);
  const a = analyseSms(draft.body);
  const check = checkSms({ body: draft.body, imageUrl: draft.imageUrl, platformAddsOptOut: addOptOut });
  const chars = Array.from(draft.body).length;

  return (
    <div className="texts-phone-col">
      <div className="texts-phone">
        <div className="texts-bubble">
          {mms && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.imageUrl} alt="" />
          )}
          <div>{draft.body || <span className="hint">The message will appear here.</span>}</div>
          {addOptOut && <div className="texts-optout">+ the account’s opt-out wording</div>}
        </div>
      </div>
      <div className="texts-count">
        {mms ? (
          <span>
            MMS · {chars.toLocaleString("en-US")} / {MMS_MAX_CHARACTERS.toLocaleString("en-US")} characters
          </span>
        ) : (
          <span>
            {a.segments} {a.segments === 1 ? "text" : "texts"} · {a.characters} characters · {a.encoding} ·{" "}
            {a.remaining} left before the next
          </span>
        )}
      </div>
      {(check.problems.length > 0 || check.warnings.length > 0) && (
        <ul className="texts-checks">
          {check.problems.map((p) => (
            <li key={p} className="bad">{p}</li>
          ))}
          {check.warnings.map((w) => (
            <li key={w} className="warn">{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SendPanel(
  props: Props & {
    text: TextState;
    dirty: boolean;
    pending: boolean;
    mine: TextState["approvals"][number] | null;
    onApprove: () => void;
    onPush: (mode: "draft" | "scheduled") => void;
    onUnschedule: () => void;
  },
) {
  const { text, dirty, pending, mine, isAdmin, provider, connected } = props;
  const push = text.push;

  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <h2 style={{ marginBottom: 8 }}>Approval and sending</h2>

      <div className="row">
        <button className="btn" disabled={pending || dirty} onClick={props.onApprove}>
          {mine?.current ? "Withdraw my approval" : mine ? "Approve again" : "Approve"}
        </button>
        {dirty && <span className="hint">Save before approving: an approval is of what is saved.</span>}
        {text.approvals.map((a) => (
          <span key={a.userId} className={`badge ${a.current ? "badge-ok" : "badge-warn"}`}>
            {a.name}
            {a.admin ? " (admin)" : ""} {a.current ? "approved" : "approved an earlier version"}
          </span>
        ))}
      </div>

      {push && (
        <p className="hint" style={{ marginTop: 10 }}>
          In {push.provider === "attentive" ? "Attentive" : "Klaviyo"} as “{push.campaignName}”,{" "}
          {push.status === "scheduled" && push.scheduledFor
            ? `scheduled for ${new Date(push.scheduledFor).toLocaleString()}`
            : "a draft"}
          {push.audienceNames ? `, to ${push.audienceNames}` : ""}.{" "}
          {push.stale ? "The text has been edited since, so that campaign is out of date." : ""}
        </p>
      )}

      {provider === "attentive" && (
        <p className="hint" style={{ marginTop: 10 }}>
          This company texts through Attentive, which this app does not reach directly. Once it is
          approved, ask Claude to “hand off the approved Attentive texts”: it builds each one in
          Attentive through Attentive’s own connector and records it here.
        </p>
      )}

      {provider === "klaviyo" && isAdmin && (
        <div className="row" style={{ marginTop: 10 }}>
          {!connected ? (
            <span className="hint">Connect Klaviyo under Integrations to push texts.</span>
          ) : (
            <>
              <button className="btn" disabled={pending || dirty} onClick={() => props.onPush("draft")}>
                {push ? "Update draft in Klaviyo" : "Push as draft"}
              </button>
              <button
                className="btn btn-primary"
                disabled={pending || dirty}
                onClick={() => {
                  if (window.confirm(`Schedule “${smsLabel(text.sms)}” to send? Texts are billed per message.`)) {
                    props.onPush("scheduled");
                  }
                }}
              >
                Schedule
              </button>
              {push?.status === "scheduled" && push.provider === "klaviyo" && (
                <button className="btn btn-danger" disabled={pending} onClick={props.onUnschedule}>
                  Unschedule
                </button>
              )}
            </>
          )}
        </div>
      )}

      {!provider && (
        <p className="hint" style={{ marginTop: 10 }}>
          No platform is chosen for this company’s texts yet. An admin can choose Klaviyo or
          Attentive under Settings → Integrations.
        </p>
      )}
    </div>
  );
}
