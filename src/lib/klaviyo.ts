/**
 * Talking to a client's Klaviyo account.
 *
 * Every call here is made with a private key belonging to somebody else's
 * business, against an account that can mail their customers. That shapes two
 * things throughout: errors are surfaced with whatever Klaviyo actually said
 * rather than flattened into "something went wrong", because the person reading
 * it has to decide whether it is safe to try again; and nothing in this file
 * sends anything on its own. Scheduling is one named function, called from one
 * place, and it is the only door.
 */

/**
 * Klaviyo dates its API and requires the header on every request.
 *
 * Pinned rather than tracking latest, so their next revision cannot change what
 * this app sends to a client's account without anyone choosing it. It has to be
 * a revision Klaviyo actually publishes: a date they do not recognise does not
 * come back as an error, it is treated as the oldest revision they still
 * support, which is a confusing way to find out you mistyped -- an endpoint
 * simply behaves as it did years ago.
 *
 * A template's `definition` is not offered at every revision -- at 2025-07-15 it
 * is not in the field list at all -- and the push cannot fill a block it cannot
 * see. So this wants to be recent. The override exists so a deployment can move
 * it without waiting on a code change, which is the difference between testing
 * a revision in a minute and in a day; and a revision Klaviyo does not publish
 * now announces itself rather than quietly behaving like 2024.
 */
const DEFAULT_REVISION = "2026-04-15";

export function revision(): string {
  return process.env.KLAVIYO_API_REVISION?.trim() || DEFAULT_REVISION;
}

/**
 * Where the revision in use came from.
 *
 * An error naming a revision that is not the one the code ships with leaves two
 * very different situations looking identical: an override set in the
 * environment, or a deployment still running the old build. Saying which turns
 * that into a five-second answer.
 */
export function revisionSource(): string {
  return process.env.KLAVIYO_API_REVISION?.trim()
    ? "the KLAVIYO_API_REVISION setting on this deployment"
    : `this build's default (${DEFAULT_REVISION})`;
}
/**
 * Klaviyo, unless a test says otherwise.
 *
 * The override exists so the connection and push flows can be exercised end to
 * end against a stand-in rather than a client's live account. Unset in any real
 * deployment, which is the only configuration that reaches Klaviyo at all.
 */
function base(): string {
  return process.env.KLAVIYO_API_BASE?.trim() || "https://a.klaviyo.com/api";
}

import { stripIdentifiers } from "@/lib/block-content";

export class KlaviyoError extends Error {
  readonly status: number;
  /** Klaviyo's own error objects, when it returned any. */
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `Klaviyo returned ${status}.`);
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Query string parameters, already in Klaviyo's `filter`/`fields[x]` shapes. */
  query?: Record<string, string | undefined>;
  /** Override the pinned revision. Only the setup check has cause to. */
  revision?: string;
  /**
   * Filled in with the revision Klaviyo says it answered as.
   *
   * A revision Klaviyo does not publish is not refused -- it is answered as the
   * oldest one still supported, which looks exactly like the endpoint simply
   * not having the field you asked for. This is how to tell those apart.
   */
  answered?: { revision: string | null };
}

async function call<T>(apiKey: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${base()}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: options.revision ?? revision(),
      accept: "application/vnd.api+json",
      ...(options.body ? { "content-type": "application/vnd.api+json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // A client's account should not be kept waiting on us, nor us on it.
    signal: AbortSignal.timeout(30_000),
  });

  if (options.answered) options.answered.revision = response.headers.get("revision");

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Klaviyo returning something that is not JSON is itself the useful fact.
  }

  if (!response.ok) {
    throw new KlaviyoError(response.status, explain(response.status, parsed, text));
  }
  return parsed as T;
}

/**
 * What went wrong, in terms of what to do about it.
 *
 * Klaviyo's error bodies are a list of objects with `detail`, which is usually
 * the most useful sentence available; the status codes that mean something
 * specific get said plainly instead, because "401" is not an instruction.
 */
function explain(status: number, parsed: unknown, raw: string): string {
  const errors = (parsed as { errors?: { detail?: string; title?: string }[] } | null)?.errors;
  const detail = errors?.map((e) => e.detail || e.title).filter(Boolean).join("; ");

  if (status === 401 || status === 403) {
    return detail
      ? `Klaviyo rejected the API key: ${detail}`
      : "Klaviyo rejected the API key. Check it is a private key with the scopes this needs.";
  }
  if (status === 429) {
    return "Klaviyo is rate limiting this account. Wait a moment and try again.";
  }
  return detail || raw.slice(0, 400) || `Klaviyo returned ${status}.`;
}

// --- what the app reads --------------------------------------------------

export interface KlaviyoAccount {
  id: string;
  name: string;
  /** The public site id, which is what identifies an account to a person. */
  publicId: string;
  timezone: string | null;
}

/**
 * Who this key belongs to.
 *
 * Doubles as the key test, and is the reason the connection screen can name the
 * account: the failure worth designing against is not a bad key, which announces
 * itself, but a good key for the wrong client.
 */
export async function fetchAccount(apiKey: string): Promise<KlaviyoAccount> {
  const body = await call<{
    data: { id: string; attributes: { contact_information?: { organization_name?: string }; public_api_key?: string; timezone?: string } }[];
  }>(apiKey, "/accounts", { query: { "fields[account]": "contact_information,public_api_key,timezone" } });

  const account = body.data?.[0];
  if (!account) throw new KlaviyoError(404, "That key works, but it is not attached to an account.");

  return {
    id: account.id,
    name: account.attributes.contact_information?.organization_name?.trim() || account.id,
    publicId: account.attributes.public_api_key ?? account.id,
    timezone: account.attributes.timezone ?? null,
  };
}

export interface Audience {
  id: string;
  name: string;
  kind: "list" | "segment";
}

/** Every list and segment, so a sheet can name one and the app can resolve it. */
export async function fetchAudiences(apiKey: string): Promise<Audience[]> {
  const out: Audience[] = [];

  for (const [path, kind] of [
    ["/lists", "list"],
    ["/segments", "segment"],
  ] as const) {
    let cursor: string | undefined;
    // Bounded: an account with more audiences than this has a naming problem
    // that a longer loop would not fix, and an unbounded one is a way to hang.
    for (let page = 0; page < 20; page += 1) {
      const body = await call<{
        data: { id: string; attributes: { name: string } }[];
        links?: { next?: string | null };
      }>(apiKey, path, {
        // Only the fieldset for what this endpoint returns. Klaviyo rejects a
        // `fields[segment]` on /lists outright rather than ignoring it, which
        // failed the whole call and left the audience picker empty.
        query: { [`fields[${kind}]`]: "name", "page[cursor]": cursor },
      });

      for (const item of body.data ?? []) {
        out.push({ id: item.id, name: item.attributes.name, kind });
      }

      const next = body.links?.next;
      if (!next) break;
      cursor = new URL(next).searchParams.get("page[cursor]") ?? undefined;
      if (!cursor) break;
    }
  }

  return out;
}

// --- what the app writes -------------------------------------------------

/**
 * Revisions worth trying when the configured one will not read a definition.
 *
 * Only the setup check uses these. The push stays on one revision, because a
 * send that silently negotiates its own API version is a send nobody can reason
 * about. Newest first, so the answer is the most current one that works.
 */
export const CANDIDATE_REVISIONS = [
  "2026-04-15",
  "2026-01-15",
  "2025-10-15",
  "2025-07-15",
  "2025-04-15",
  "2025-01-15",
  "2024-10-15",
];

/**
 * The ways of asking for a template's structure.
 *
 * There is more than one because Klaviyo has changed its mind about which it
 * is. "additional-fields must be in []" is what you get when the parameter is
 * understood but the allowed list for this resource is empty -- which is how an
 * endpoint reads once the field it used to gate has become an ordinary one. So
 * rather than pick a side and be wrong again, ask each way and keep the answer
 * that comes back with a definition.
 *
 * All three are reads of the same template, so trying them costs latency and
 * nothing else.
 */
export const TEMPLATE_READS: { id: string; query: Record<string, string | undefined> }[] = [
  { id: "additional-fields", query: { "additional-fields[template]": "definition" } },
  { id: "fields", query: { "fields[template]": "name,editor_type,definition" } },
  { id: "plain", query: {} },
];

export interface TemplateDetail {
  id: string;
  name: string;
  editorType: string;
  /** The drag-and-drop structure, present only for templates that have one. */
  definition: unknown;
  /** Which of TEMPLATE_READS produced it, for the setup check to report. */
  readBy?: string;
  /** The revision Klaviyo said it answered as, which is not always the one asked. */
  answeredRevision?: string | null;
}

/** A drag-and-drop template is the only kind that has a definition to miss. */
function draggable(editorType: string): boolean {
  return /DRAG/i.test(editorType);
}

/**
 * One template, with its block structure.
 *
 * Tries each way of asking until one comes back with a definition. A template
 * that has none to give -- a code template -- stops the search at the first
 * successful read rather than pointlessly asking twice more.
 */
export async function fetchTemplate(
  apiKey: string,
  templateId: string,
  as?: string,
): Promise<TemplateDetail> {
  type Body = { data: { id: string; attributes: { name: string; editor_type: string; definition?: unknown } } };

  let lastError: unknown = null;
  let lastBody: { body: Body; readBy: string } | null = null;
  const answered: { revision: string | null } = { revision: null };

  for (const attempt of TEMPLATE_READS) {
    let body: Body;
    try {
      body = await call<Body>(apiKey, `/templates/${templateId}`, {
        query: attempt.query,
        revision: as,
        answered,
      });
    } catch (error) {
      // A refusal of one way of asking is not a refusal of the template.
      if (error instanceof KlaviyoError && error.status === 400) {
        lastError = error;
        continue;
      }
      throw error;
    }

    const attributes = body.data.attributes;
    if (attributes.definition != null || !draggable(attributes.editor_type)) {
      return {
        id: body.data.id,
        name: attributes.name,
        editorType: attributes.editor_type,
        definition: attributes.definition ?? null,
        readBy: attempt.id,
        answeredRevision: answered.revision,
      };
    }
    lastBody = { body, readBy: attempt.id };
  }

  /*
   * Nothing worked. A drag-and-drop template always has a definition, so
   * reaching here means it could not be read, not that there is none -- and
   * handing back a null would have the caller announce "no blocks to fill"
   * about a template full of blocks. Say what actually happened instead, and
   * name the revision, since that is the thing that has been wrong.
   */
  const refused =
    lastError instanceof KlaviyoError
      ? lastError.detail
      : "Klaviyo returned the template without its definition.";
  const status = lastError instanceof KlaviyoError ? lastError.status : 400;
  const name = lastBody ? `“${lastBody.body.data.attributes.name}” ` : "";
  const sent = as ?? revision();
  // A revision Klaviyo does not publish comes back answered as the oldest one
  // it still supports, which otherwise looks identical to the field not
  // existing. Saying which it was turns a guess into a fact.
  const mismatch =
    answered.revision && answered.revision !== sent
      ? ` Klaviyo answered as revision ${answered.revision}, not the ${sent} it was asked for, ` +
        "which means it does not publish that one."
      : "";

  /*
   * The remedy is a few more reads away, so find it rather than describing the
   * errand. Only on a failure that has already stopped the push -- and not when
   * the caller named the revision itself, since it is then already searching
   * and would have this recurse through the whole list per candidate.
   */
  let advice = "";
  if (!as) {
    const working = await workingRevision(apiKey, templateId, sent);
    advice = working
      ? ` Revision ${working} can read it: set KLAVIYO_API_REVISION to ${working}.`
      : " No revision this app knows of could read it — check the base template on the " +
        "integrations screen, which lists what each one said.";
  }

  throw new KlaviyoError(
    status,
    `${refused} This app asked for ${name}template's structure three ways using API revision ` +
      `${sent}, from ${revisionSource()}, and got it from none of them.${mismatch}${advice}`,
  );
}

/**
 * Build the per-send template outright, from a definition already filled in.
 *
 * Replaces cloning and then editing the clone. Klaviyo refuses to update a
 * template that contains universal blocks -- and it checks the template as
 * stored, not the payload, so a clone of a base that has one can never be
 * written to however the update is phrased. Creating the finished article in a
 * single call sidesteps that entirely, and costs one request instead of three.
 */
export async function createDndTemplate(
  apiKey: string,
  name: string,
  definition: unknown,
): Promise<{ id: string; alsoRemoved: string[] }> {
  const post = async () => {
    const body = await call<{ data: { id: string } }>(apiKey, "/templates", {
      method: "POST",
      body: {
        data: {
          type: "template",
          attributes: { name, editor_type: "SYSTEM_DRAGGABLE", definition },
        },
      },
    });
    return body.data.id;
  };

  try {
    return { id: await post(), alsoRemoved: [] };
  } catch (error) {
    /*
     * Klaviyo names the field it would not be told. Guessing that set from the
     * outside has now been wrong twice -- first `id`, then `data_id`, each
     * costing a round trip through a real account -- so take the answer from
     * the error rather than from another theory, and try once more.
     *
     * Bounded to one retry, and only for this refusal: a create that fails
     * leaves nothing behind, so retrying it is cheap, but a loop that keeps
     * deleting whatever Klaviyo complains about could strip a definition to
     * nothing.
     */
    if (!(error instanceof KlaviyoError) || error.status !== 400) throw error;
    const named = [...new Set(
      [...error.detail.matchAll(/`?(\w+)`? is not allowed to be specified on create/gi)]
        .map((match) => match[1]),
    )];
    if (named.length === 0) throw error;

    stripIdentifiers(definition, named);
    return { id: await post(), alsoRemoved: named };
  }
}



export interface CampaignContent {
  name: string;
  subject: string;
  previewText: string;
  fromEmail: string;
  fromLabel: string;
  replyTo?: string;
  includedAudiences: string[];
  excludedAudiences: string[];
  /** When to send. Absent leaves the campaign undated for a person to decide. */
  sendAt: Date | null;
}

export interface CampaignRefs {
  campaignId: string;
  messageId: string;
}

function messageDefinition(content: CampaignContent) {
  return {
    channel: "email" as const,
    label: content.name,
    content: {
      subject: content.subject,
      preview_text: content.previewText,
      from_email: content.fromEmail,
      from_label: content.fromLabel,
      ...(content.replyTo ? { reply_to_email: content.replyTo } : {}),
    },
  };
}

function sendStrategy(sendAt: Date | null) {
  // `is_local: false` means everyone receives it at the same instant, which is
  // what a wall-clock time in the sheet means. Local-time sending is a
  // different product decision and would need its own column to ask for.
  return sendAt
    ? { method: "static" as const, datetime: sendAt.toISOString(), options: { is_local: false as const } }
    : undefined;
}

/** A new draft campaign, with its one email message. */
export async function createCampaign(apiKey: string, content: CampaignContent): Promise<CampaignRefs> {
  const body = await call<{
    data: { id: string; relationships?: { "campaign-messages"?: { data?: { id: string }[] } } };
    included?: { type: string; id: string }[];
  }>(apiKey, "/campaigns", {
    method: "POST",
    query: { include: "campaign-messages" },
    body: {
      data: {
        type: "campaign",
        attributes: {
          name: content.name,
          audiences: { included: content.includedAudiences, excluded: content.excludedAudiences },
          "campaign-messages": { data: [{ type: "campaign-message", attributes: { definition: messageDefinition(content) } }] },
          ...(sendStrategy(content.sendAt) ? { send_strategy: sendStrategy(content.sendAt) } : {}),
        },
      },
    },
  });

  const messageId =
    body.data.relationships?.["campaign-messages"]?.data?.[0]?.id ??
    body.included?.find((i) => i.type === "campaign-message")?.id;

  if (!messageId) {
    throw new KlaviyoError(500, "Klaviyo made the campaign but did not say which message belongs to it.");
  }
  return { campaignId: body.data.id, messageId };
}

/** Bring an existing draft back in line with the row it came from. */
export async function updateCampaign(
  apiKey: string,
  refs: CampaignRefs,
  content: CampaignContent,
): Promise<void> {
  await call(apiKey, `/campaigns/${refs.campaignId}`, {
    method: "PATCH",
    body: {
      data: {
        type: "campaign",
        id: refs.campaignId,
        attributes: {
          name: content.name,
          audiences: { included: content.includedAudiences, excluded: content.excludedAudiences },
          ...(sendStrategy(content.sendAt) ? { send_strategy: sendStrategy(content.sendAt) } : {}),
        },
      },
    },
  });

  await call(apiKey, `/campaign-messages/${refs.messageId}`, {
    method: "PATCH",
    body: {
      data: {
        type: "campaign-message",
        id: refs.messageId,
        attributes: { definition: messageDefinition(content) },
      },
    },
  });
}

export async function assignTemplate(
  apiKey: string,
  messageId: string,
  klaviyoTemplateId: string,
): Promise<void> {
  await call(apiKey, `/campaign-message-assign-template`, {
    method: "POST",
    body: {
      data: {
        type: "campaign-message",
        id: messageId,
        relationships: { template: { data: { type: "template", id: klaviyoTemplateId } } },
      },
    },
  });
}

export interface CampaignState {
  id: string;
  name: string;
  status: string;
  /** When Klaviyo believes it will send, if it is scheduled. */
  scheduledAt: string | null;
  sendTime: string | null;
  archived: boolean;
}

export async function fetchCampaign(apiKey: string, campaignId: string): Promise<CampaignState | null> {
  try {
    const body = await call<{
      data: { id: string; attributes: { name: string; status: string; scheduled_at: string | null; send_time: string | null; archived: boolean } };
    }>(apiKey, `/campaigns/${campaignId}`, {
      query: { "fields[campaign]": "name,status,scheduled_at,send_time,archived" },
    });
    const a = body.data.attributes;
    return {
      id: body.data.id,
      name: a.name,
      status: a.status,
      scheduledAt: a.scheduled_at,
      sendTime: a.send_time,
      archived: a.archived,
    };
  } catch (error) {
    // A campaign deleted in Klaviyo is not an error here -- it means the record
    // this app holds is stale, and the caller decides what to do about that.
    if (error instanceof KlaviyoError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The only function in this file that causes mail to be sent.
 *
 * Klaviyo sends according to the campaign's own send strategy, so a campaign
 * dated in the future is scheduled rather than sent now -- but this is still
 * the point of no return, and it is deliberately not folded into any of the
 * functions above.
 */
export async function scheduleCampaign(apiKey: string, campaignId: string): Promise<void> {
  await call(apiKey, "/campaign-send-jobs", {
    method: "POST",
    body: { data: { type: "campaign-send-job", id: campaignId } },
  });
}

/** Stop a scheduled campaign that has not started going out. */
export async function cancelCampaign(apiKey: string, campaignId: string): Promise<void> {
  await call(apiKey, `/campaign-send-jobs/${campaignId}`, {
    method: "PATCH",
    body: { data: { type: "campaign-send-job", id: campaignId, attributes: { action: "cancel" } } },
  });
}

/**
 * The newest revision that can actually read this template's structure.
 *
 * A read, and only on the path where a push has already failed: an error that
 * says which setting to change is worth a handful of GETs, where an error that
 * says "find one that works" costs somebody an afternoon.
 */
async function workingRevision(
  apiKey: string,
  templateId: string,
  skip: string,
): Promise<string | null> {
  for (const candidate of CANDIDATE_REVISIONS) {
    if (candidate === skip) continue;
    try {
      if ((await fetchTemplate(apiKey, templateId, candidate)).definition) return candidate;
    } catch {
      // Not this one either.
    }
  }
  return null;
}

/**
 * Which template the campaign message actually points at.
 *
 * Assignment is a relationship, and Klaviyo may or may not put its own copy on
 * the other end of it. That difference decides whether the template this app
 * cloned is still load-bearing or is now litter, and it is not a thing to
 * assume: deleting a template a scheduled campaign depends on would empty an
 * email on its way to a client's customers. So it is read back and compared.
 */
export async function fetchMessageTemplate(
  apiKey: string,
  messageId: string,
): Promise<string | null> {
  const body = await call<{
    data: { relationships?: { template?: { data?: { id?: string } | null } } };
  }>(apiKey, `/campaign-messages/${messageId}`, { query: { include: "template" } });
  return body.data?.relationships?.template?.data?.id ?? null;
}

/** Remove a template. Used only on a clone nothing points at any more. */
export async function deleteTemplate(apiKey: string, templateId: string): Promise<void> {
  await call(apiKey, `/templates/${templateId}`, { method: "DELETE" });
}
