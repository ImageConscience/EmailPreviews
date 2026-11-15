// Stands in for Attentive so the whole push can be exercised without touching a
// client's account. Keeps state in memory and dumps it on /__state.
//
// The paths here are the ones `src/lib/esp/attentive-api.ts` calls, and the
// check asserts that -- so if those paths turn out to be wrong against the real
// API, correcting them there makes this mock wrong in the same way and the
// check says so, rather than both drifting quietly apart.
import { createServer } from "node:http";

const GOOD = "attn_live_testkey000000000000000000cd";

/**
 * Every segment this pretend account has, served two at a time.
 *
 * Paged on purpose: a client with more segments than one page is the case where
 * "no such audience" is a lie, and a mock that returns everything at once would
 * never catch a client that reads only the first page.
 */
const SEGMENTS = [
  { id: "SEG1", name: "Newsletter", type: "LIST" },
  { id: "SEG2", name: "Engaged 90 days", type: "SEGMENT" },
  { id: "SEG3", name: "VIP", type: "SEGMENT" },
  { id: "SEG4", name: "Ambiguous", type: "LIST" },
  { id: "SEG5", name: "Ambiguous", type: "SEGMENT" },
];
const PAGE = 2;

/**
 * Which shape /me answers in.
 *
 * The client reads either a wrapped company or a flat object, because an API
 * read through one shape today is not promising to keep it. Switchable so that
 * tolerance is exercised rather than merely asserted in a comment.
 */
let meShape = "company";

const campaigns = new Map();
let nextId = 1;

/** Every request, so a check can assert which paths the client actually uses. */
const calls = [];

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/__state") {
    return json(res, 200, { calls, campaigns: [...campaigns.values()] });
  }
  if (p === "/__reset") {
    campaigns.clear();
    calls.length = 0;
    return json(res, 200, { ok: true });
  }
  if (p === "/__me-shape") {
    meShape = url.searchParams.get("shape") ?? "company";
    return json(res, 200, { meShape });
  }

  calls.push(`${req.method} ${p}`);
  if ((req.headers.authorization ?? "") !== `Bearer ${GOOD}`) {
    return json(res, 401, { message: "Unauthorized: that key is not valid for any account." });
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sent = body ? JSON.parse(body) : null;

    if (p === "/me" && req.method === "GET") {
      const company = { id: "CO123", name: "Pretend Client Co" };
      return json(res, 200, meShape === "company" ? { company } : company);
    }

    if (p === "/segments" && req.method === "GET") {
      // Cursor is the index of the next item, which is enough to page with and
      // opaque enough that the client cannot do arithmetic on it.
      const from = Number(url.searchParams.get("cursor") ?? "0") || 0;
      const slice = SEGMENTS.slice(from, from + PAGE);
      const next = from + PAGE < SEGMENTS.length ? String(from + PAGE) : null;
      return json(res, 200, { segments: slice, nextCursor: next });
    }

    if (p === "/campaigns" && req.method === "POST") {
      if (sent?.channel !== "email") {
        return json(res, 400, { message: "channel must be email for an email campaign." });
      }
      const id = `CMP${nextId++}`;
      const campaign = {
        campaignId: id,
        messageGroupId: `MG${nextId++}`,
        messageId: `MSG${nextId++}`,
        name: sent?.name ?? "",
        status: "DRAFT",
        message: null,
        group: null,
      };
      campaigns.set(id, campaign);
      return json(res, 201, {
        campaignId: campaign.campaignId,
        messageGroupId: campaign.messageGroupId,
        messageId: campaign.messageId,
      });
    }

    const byCampaign = (id) => campaigns.get(id);
    const byMessage = (id) => [...campaigns.values()].find((c) => c.messageId === id);
    const byGroup = (id) => [...campaigns.values()].find((c) => c.messageGroupId === id);

    const campaignMatch = /^\/campaigns\/([^/]+)$/.exec(p);
    if (campaignMatch && req.method === "GET") {
      const c = byCampaign(campaignMatch[1]);
      if (!c) return json(res, 404, { message: "No campaign with that id." });
      return json(res, 200, { id: c.campaignId, name: c.name, status: c.status });
    }

    const messageMatch = /^\/messages\/([^/]+)$/.exec(p);
    if (messageMatch && req.method === "PATCH") {
      const c = byMessage(messageMatch[1]);
      if (!c) return json(res, 404, { message: "No message with that id." });
      // Attentive, like every platform worth mirroring, will not take edits to
      // something already waiting to send. A mock that accepted it would let a
      // push-again path pass here and fail against the real account.
      if (c.status === "SCHEDULED") {
        return json(res, 409, { message: "Cannot edit a campaign that is scheduled to send." });
      }
      if (!sent?.htmlContent) {
        return json(res, 400, { message: "htmlContent is required for an email message." });
      }
      c.message = sent;
      return json(res, 200, { id: c.messageId });
    }

    const groupMatch = /^\/message-groups\/([^/]+)$/.exec(p);
    if (groupMatch && req.method === "PATCH") {
      const c = byGroup(groupMatch[1]);
      if (!c) return json(res, 404, { message: "No message group with that id." });
      if (c.status === "SCHEDULED") {
        return json(res, 409, { message: "Cannot edit a campaign that is scheduled to send." });
      }
      // Segments are named by id, so an unknown one is a mistake worth
      // refusing rather than sending to nobody.
      const named = [
        ...(sent?.audience?.includedSegmentIds ?? []),
        ...(sent?.audience?.excludedSegmentIds ?? []),
      ];
      const unknown = named.filter((id) => !SEGMENTS.some((s) => s.id === id));
      if (unknown.length) {
        return json(res, 400, { message: `No segment with id ${unknown.join(", ")}.` });
      }
      c.group = sent;
      return json(res, 200, { id: c.messageGroupId });
    }

    const sendMatch = /^\/campaigns\/([^/]+)\/send$/.exec(p);
    if (sendMatch && req.method === "POST") {
      const c = byCampaign(sendMatch[1]);
      if (!c) return json(res, 404, { message: "No campaign with that id." });
      if (c.status === "SCHEDULED") {
        return json(res, 409, { message: "That campaign is already scheduled." });
      }
      if (!c.message || !c.group) {
        return json(res, 400, { message: "A campaign needs content and an audience before it can send." });
      }
      c.status = "SCHEDULED";
      return json(res, 200, { id: c.campaignId, status: c.status });
    }

    const pauseMatch = /^\/campaigns\/([^/]+)\/pause$/.exec(p);
    if (pauseMatch && req.method === "POST") {
      const c = byCampaign(pauseMatch[1]);
      if (!c) return json(res, 404, { message: "No campaign with that id." });
      c.status = "DRAFT";
      return json(res, 200, { id: c.campaignId, status: c.status });
    }

    json(res, 404, { message: `no mock for ${req.method} ${p}` });
  });
}).listen(4600, () => console.log("mock attentive on 4600"));
