import { EspError } from "@/lib/esp/types";

/**
 * The HTTP layer for Attentive.
 *
 * Everything this app needs from Attentive is small, because Attentive takes
 * the email as HTML: there is no template to clone, no block to find, no
 * shared-block problem and nothing to tidy up afterwards. A campaign is
 * created, its one message is given the subject and the body, its group is
 * given the audience and the send time, and the campaign is scheduled.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNVERIFIED: the campaign paths in `ENDPOINTS` below. Read this before
 * pointing any of it at a real account.
 *
 * What is settled. The shape of the calls -- what a campaign is made of, that
 * a message takes `htmlContent`, that a message group carries the audience and
 * the send time, that scheduling is one call on the campaign -- comes from
 * Attentive's own tool definitions and is reliable. The host and version
 * prefix below are corroborated by Attentive's own documented webhook endpoint
 * and by several integrators: the API is served from
 * api.attentivemobile.com/v1, and `GET /me` under it is the documented way to
 * test a credential.
 *
 * What is not. Attentive's *public* REST API documents subscribers, custom
 * attributes, custom events, ecommerce, product catalog, privacy requests and
 * webhooks -- and, by some accounts, a read-only campaign list. Creating a
 * campaign, filling its message, setting its audience and scheduling it are
 * not clearly part of it. Attentive also publishes a GraphQL API, in beta, at
 * POST /graphql under the same base, whose fields are said to mirror the REST
 * surface for now. The operations this file needs may well live there instead,
 * in which case this is the wrong shape of client, not merely the wrong paths.
 *
 * So the paths stay gathered here, in one object: correcting them against
 * docs.attentive.com is a single edit, and
 * `scripts/fixtures/attentive-mock.mjs` serves exactly these, with
 * `scripts/check-attentive.mts` asserting the two agree -- so a correction
 * here fails the check until the mock follows, rather than the two drifting
 * quietly apart. Until somebody has read the reference, treat a push to
 * Attentive as unproven against the real service: it is proven only against a
 * mock built from these same assumptions.
 * ────────────────────────────────────────────────────────────────────────────
 */
const ENDPOINTS = {
  me: () => `/me`,
  segments: () => `/segments`,
  campaigns: () => `/campaigns`,
  campaign: (id: string) => `/campaigns/${id}`,
  message: (id: string) => `/messages/${id}`,
  messageGroup: (id: string) => `/message-groups/${id}`,
  schedule: (id: string) => `/campaigns/${id}/send`,
  pause: (id: string) => `/campaigns/${id}/pause`,
};

/** Overridable so the checks can point the client at the mock. */
function baseUrl(): string {
  // api.attentivemobile.com, not api.attentive.com: the second is the marketing
  // site's domain and serves no API. The /v1 prefix is part of the base, so the
  // paths above are written without it.
  return process.env.ATTENTIVE_API_BASE ?? "https://api.attentivemobile.com/v1";
}

interface CallOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function call<T>(apiKey: string, path: string, options: CallOptions = {}): Promise<T> {
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        // A private app key is a bearer token. It can mail a client's whole
        // list, so it is never logged and never put in a query string.
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new EspError("Could not reach Attentive. Check the connection and try again.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new EspError(
      "Attentive refused that key. Check the private app key under Integrations.",
      undefined,
      response.status,
    );
  }

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new EspError(
      attentiveMessage(parsed) ?? `Attentive answered ${response.status}.`,
      text.slice(0, 500),
      response.status,
    );
  }
  return (parsed ?? {}) as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Attentive's own words for what went wrong, where it gives them.
 *
 * Several shapes are tried because an API that is read through one of them
 * today is not promising to use it forever, and a message that says only
 * "Attentive answered 400" is the kind that costs a round trip to diagnose.
 */
function attentiveMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const shape = body as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "title"]) {
    const value = shape[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const errors = shape.errors;
  if (Array.isArray(errors)) {
    const messages = errors
      .map((e) => (typeof e === "string" ? e : attentiveMessage(e)))
      .filter((m): m is string => Boolean(m));
    if (messages.length > 0) return messages.join(" ");
  }
  return null;
}

/* ------------------------------------------------------------------ calls */

export interface AttentiveAccount {
  id: string;
  name: string;
}

export async function fetchAccount(apiKey: string): Promise<AttentiveAccount> {
  const body = await call<Record<string, unknown>>(apiKey, ENDPOINTS.me());
  const company = (body.company ?? body) as Record<string, unknown>;
  const id = String(company.id ?? company.companyId ?? "");
  const name = String(company.name ?? company.companyName ?? "").trim();
  if (!id && !name) {
    throw new EspError("Attentive accepted the key but did not say which account it is for.");
  }
  return { id, name: name || id };
}

export interface AttentiveSegment {
  id: string;
  name: string;
  kind: string;
}

export async function fetchSegments(apiKey: string): Promise<AttentiveSegment[]> {
  const out: AttentiveSegment[] = [];
  let cursor: string | undefined;

  // Paged rather than assumed to fit: a client with hundreds of segments must
  // not silently get the first page and a confusing "no such audience".
  for (let page = 0; page < 20; page++) {
    const body = await call<Record<string, unknown>>(apiKey, ENDPOINTS.segments(), {
      query: { limit: "100", cursor },
    });
    const items = (body.segments ?? body.data ?? body.items ?? []) as Record<string, unknown>[];
    for (const item of items) {
      const id = String(item.id ?? item.segmentId ?? "");
      if (!id) continue;
      out.push({
        id,
        name: String(item.name ?? "").trim() || id,
        kind: String(item.type ?? item.segmentType ?? "segment").toLowerCase(),
      });
    }
    cursor = typeof body.nextCursor === "string" ? body.nextCursor : undefined;
    if (!cursor || items.length === 0) break;
  }
  return out;
}

export interface AttentiveCampaignRefs {
  campaignId: string;
  messageGroupId: string;
  messageId: string;
}

/** A new email campaign, with its one message group and one message. */
export async function createCampaign(
  apiKey: string,
  name: string,
): Promise<AttentiveCampaignRefs> {
  const body = await call<Record<string, unknown>>(apiKey, ENDPOINTS.campaigns(), {
    method: "POST",
    body: { name, channel: "email" },
  });
  const refs = {
    campaignId: String(body.campaignId ?? body.id ?? ""),
    messageGroupId: String(body.messageGroupId ?? ""),
    messageId: String(body.messageId ?? ""),
  };
  if (!refs.campaignId || !refs.messageId) {
    throw new EspError("Attentive created a campaign but did not say which message to fill in.");
  }
  return refs;
}

export interface AttentiveMessageContent {
  name: string;
  subject: string;
  preheaderText: string;
  fromEmail: string;
  fromName: string;
  replyToEmail?: string;
  html: string;
}

/** Subject, sender and body, on the campaign's one email message. */
export async function updateMessage(
  apiKey: string,
  messageId: string,
  content: AttentiveMessageContent,
): Promise<void> {
  await call(apiKey, ENDPOINTS.message(messageId), {
    method: "PATCH",
    body: {
      name: content.name,
      subject: content.subject,
      preheaderText: content.preheaderText,
      fromEmail: content.fromEmail,
      fromName: content.fromName,
      ...(content.replyToEmail ? { replyToEmail: content.replyToEmail } : {}),
      // The whole document. Attentive takes the body as HTML, which is why
      // this provider needs no template and leaves nothing behind.
      htmlContent: content.html,
    },
  });
}

/** Who it goes to, and when. Both live on the group rather than the message. */
export async function updateMessageGroup(
  apiKey: string,
  messageGroupId: string,
  audience: { include: string[]; exclude: string[] },
  sendAt: Date | null,
): Promise<void> {
  await call(apiKey, ENDPOINTS.messageGroup(messageGroupId), {
    method: "PATCH",
    body: {
      audience: {
        includedSegmentIds: audience.include,
        excludedSegmentIds: audience.exclude,
      },
      // Absent leaves it for a person to set, which is what an undated row means.
      ...(sendAt ? { sendAt: sendAt.toISOString() } : {}),
    },
  });
}

export interface AttentiveCampaignState {
  status: string;
  sent: boolean;
  queued: boolean;
  archived: boolean;
}

export async function fetchCampaign(
  apiKey: string,
  campaignId: string,
): Promise<AttentiveCampaignState | null> {
  try {
    const body = await call<Record<string, unknown>>(apiKey, ENDPOINTS.campaign(campaignId));
    const raw = String(body.status ?? body.state ?? "").toUpperCase();
    return {
      status: raw || "UNKNOWN",
      // Matched loosely on purpose: the exact vocabulary is Attentive's to
      // change, and the question being asked -- has this gone out, is it in
      // the queue -- is coarser than the status string.
      sent: /SENT|SENDING|COMPLETE/.test(raw),
      queued: /SCHEDULED|QUEUED/.test(raw),
      archived: /ARCHIVED|DELETED/.test(raw),
    };
  } catch (error) {
    // A campaign somebody deleted in Attentive is not an error here; it means
    // the next push starts a new one. Decided on the status, not on the words:
    // a well-written 404 message says "no campaign with that id", which no
    // search for "404" would ever match.
    if (error instanceof EspError && error.status === 404) return null;
    throw error;
  }
}

export async function scheduleCampaign(apiKey: string, campaignId: string): Promise<void> {
  await call(apiKey, ENDPOINTS.schedule(campaignId), { method: "POST", body: {} });
}

export async function pauseCampaign(apiKey: string, campaignId: string): Promise<void> {
  await call(apiKey, ENDPOINTS.pause(campaignId), { method: "POST", body: {} });
}

/** Exposed so the checks can assert the mock and the client agree on paths. */
export const ATTENTIVE_ENDPOINTS = ENDPOINTS;
