// Stands in for Klaviyo so the whole push can be exercised without touching a
// client's account. Keeps state in memory and dumps it on /__state.
import { createServer } from "node:http";

const GOOD = "pk_live_testkey0000000000000000000000ab";
const MARKER = "EMAILPREVIEWS:CONTENT";

/**
 * Identifiers this pretend Klaviyo will not be told on a create.
 *
 * Settable at runtime, because the client is not supposed to know the list --
 * it strips what it knows and takes the rest from the error. Adding one here is
 * how that recovery gets exercised.
 */
let REFUSED_ON_CREATE = ["id", "template_id", "data_id"];

let idSeq = 0;
const nextIdent = () => `01M1M12YEY${(idSeq += 1).toString().padStart(4, "0")}`;

const htmlBlock = (content, universalId) => ({
  content_type: "block", type: "html", data: { content },
  // Real definitions carry an identifier on every element, and Klaviyo refuses
  // a create that asserts any of them.
  id: nextIdent(), data_id: nextIdent(),
  ...(universalId ? { universal_id: universalId } : {}),
});

// A base template shaped like the one a person would build: chrome, an HTML
// block for the content carrying the marker, and a second HTML block that is
// not ours.
const baseDefinition = () => ({
  id: "82878156433742b4",
  template_id: "BASE01",
  body: {
    id: nextIdent(),
    properties: { id: "bodyTable", css_class: "root-container" },
    sections: [
      { content_type: "section", id: nextIdent(), data_id: nextIdent(),
        data: { rows: [{ id: nextIdent(), columns: [{ id: nextIdent(), blocks: [
          { content_type: "block", type: "image", id: nextIdent(), data: {} },
          htmlBlock(`<!-- ${MARKER} -->`),
        ] }] }] } },
      { content_type: "section", id: nextIdent(), data_id: nextIdent(),
        data: { rows: [{ id: nextIdent(), columns: [{ id: nextIdent(), blocks: [
          // Reusable content shared with other templates, the way a real footer
          // often is. Klaviyo refuses to update a template that contains one.
          htmlBlock('<p>Legal small print, {% unsubscribe %}</p>', "36798d44a3e34090"),
        ] }] }] } },
    ],
  },
  styles: [{ style_type: "base-styles", id: nextIdent(), styles: { margin_top: 50 } }],
});

const templates = new Map([
  ["BASE01", { id: "BASE01", name: "Burju base", editor_type: "SYSTEM_DRAGGABLE", definition: baseDefinition() }],
  ["CODEONLY", { id: "CODEONLY", name: "An HTML-only template", editor_type: "CODE", definition: null }],
]);
const campaigns = new Map();
const sendJobs = [];
let nextId = 1;

/**
 * The revisions this pretend Klaviyo publishes, and the one from which a
 * template hands over its definition at all.
 *
 * Anything else is not refused: it is answered as the oldest published one, the
 * way the real API does. That silent fallback is what made a mistyped revision
 * indistinguishable from a missing field, so the mock has to do it too.
 */
const PUBLISHED = ["2024-10-15", "2025-01-15", "2025-04-15", "2025-07-15", "2025-10-15",
  "2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"];

/**
 * Texts, in the shape Klaviyo gave campaigns at 2026-10-15: a campaign holds
 * audiences and messages, a message holds variations, and a variation's SMS
 * details are where the body and any MMS image live. Only that revision gets
 * these answers, so a client that forgot to ask for it fails here as it would
 * against the real thing (where it would get the old, image-less shape).
 */
const SMS_REVISION = "2026-10-15";
const smsCampaigns = new Map();
const smsMessages = new Map();
const smsAudiences = new Map();
const smsVariations = new Map();
const smsSchedules = new Map();
const images = new Map();
const DEFINITION_REVISION = "2026-01-15";

/**
 * How this Klaviyo hands over a template definition.
 *
 * "additional-fields" is the documented way and the one the client tries first.
 * "plain" is the world the live account appears to be in: the parameter is
 * understood but the allowed list is empty, because the definition has become
 * an ordinary field returned by default. Switchable at runtime so one mock can
 * play both, and the client can be shown to cope with either.
 */
let templateMode = "additional-fields";

/**
 * What assigning a template to a campaign message leaves behind.
 *
 * "copy" -- Klaviyo takes its own non-reusable copy and the message points at
 * that, so the template that was assigned is now litter. "reference" -- the
 * message points at the assigned template itself, and deleting it would empty
 * the campaign. Which of these the real API does decides whether tidying up is
 * housekeeping or destruction, so the mock plays both and the client is
 * required to get it right without being told which.
 */
let assignMode = "copy";

/** Every request, so a check can assert what the client no longer does. */
const calls = [];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__refuse-on-create") {
    REFUSED_ON_CREATE = (url.searchParams.get("keys") ?? "id,template_id,data_id").split(",");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ REFUSED_ON_CREATE }));
  }
  if (url.pathname === "/__assign-mode") {
    assignMode = url.searchParams.get("mode") ?? "copy";
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ assignMode }));
  }
  if (url.pathname === "/__template-mode") {
    templateMode = url.searchParams.get("mode") ?? "additional-fields";
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ templateMode }));
  }
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/vnd.api+json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/__sms-status") {
    // Lets a check play Klaviyo sending a text, which nothing in the app does.
    const m = smsMessages.get(url.searchParams.get("message") ?? "");
    if (m) m.status = url.searchParams.get("status") ?? m.status;
    res.writeHead(m ? 200 : 404, { "content-type": "application/json" });
    return res.end(JSON.stringify(m ?? { error: "no such message" }));
  }
  if (url.pathname === "/__state") {
    return send(200, {
      calls,
      templates: [...templates.values()],
      campaigns: [...campaigns.values()],
      sendJobs,
      sms: {
        campaigns: [...smsCampaigns.values()],
        messages: [...smsMessages.values()],
        audiences: [...smsAudiences.values()],
        variations: [...smsVariations.values()],
        schedules: [...smsSchedules.values()],
        images: [...images.values()],
      },
    });
  }
  if (url.pathname === "/__reset") {
    campaigns.clear();
    sendJobs.length = 0;
    for (const m of [smsCampaigns, smsMessages, smsAudiences, smsVariations, smsSchedules, images]) m.clear();
    calls.length = 0;
    for (const id of [...templates.keys()]) if (id !== "BASE01" && id !== "CODEONLY") templates.delete(id);
    templates.set("BASE01", { id: "BASE01", name: "Burju base", editor_type: "SYSTEM_DRAGGABLE", definition: baseDefinition() });
    return send(200, { ok: true });
  }

  // Any dated revision, the way Klaviyo takes any it still supports. Pinning
  // one here made the mock a test of the constant rather than of the calls.
  const wanted = req.headers.revision ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
    return send(400, { errors: [{ detail: "missing or malformed revision header" }] });
  }
  // Unpublished dates fall back to the oldest, and the response says so.
  const honoured = PUBLISHED.includes(wanted) ? wanted : PUBLISHED[0];
  res.setHeader("revision", honoured);
  calls.push(`${req.method} ${url.pathname.replace(/^\/api/, "")}`);
  if ((req.headers.authorization ?? "") !== `Klaviyo-API-Key ${GOOD}`) {
    return send(401, { errors: [{ detail: "The API key you supplied is invalid." }] });
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : null;
    const p = url.pathname.replace(/^\/api/, "");

    if (p === "/accounts") {
      return send(200, { data: [{ id: "ACCT01", attributes: {
        contact_information: { organization_name: "Pretend Client Co" },
        public_api_key: "AbC123", timezone: "America/New_York" } }] });
    }
    // Klaviyo rejects a sparse fieldset naming a type the endpoint cannot
    // return. Mirroring that here is the point: a mock that shrugs it off lets
    // the request pass in testing and fail against the real account, which is
    // exactly how the audience picker shipped empty.
    const fieldFamilies = (allowed) => {
      for (const key of url.searchParams.keys()) {
        const family = /^fields\[([^\]]+)\]$/.exec(key)?.[1];
        if (family && !allowed.includes(family)) {
          return send(400, { errors: [{ detail:
            `'${family}' is not an allowed field family for this resource. ` +
            `Allowed field families are ${allowed.join(", ")}.` }] });
        }
      }
      return null;
    };

    if (p === "/lists") {
      const bad = fieldFamilies(["list", "profile", "tag", "flow"]);
      if (bad) return bad;
      return send(200, { data: [{ id: "L1", attributes: { name: "Newsletter" } },
        { id: "L3", attributes: { name: "Ambiguous" } }], links: { next: null } });
    }
    if (p === "/segments") {
      const bad = fieldFamilies(["segment", "profile", "tag", "flow"]);
      if (bad) return bad;
      return send(200, { data: [{ id: "S1", attributes: { name: "Engaged 90 days" } },
        { id: "S2", attributes: { name: "VIP" } },
        { id: "S3", attributes: { name: "Ambiguous" } }], links: { next: null } });
    }

    const templateMatch = /^\/templates\/([^/]+)$/.exec(p);
    if (templateMatch && req.method === "GET") {
      const t = templates.get(templateMatch[1]);
      if (!t) return send(404, { errors: [{ detail: "No template with that id." }] });
      // The definition is an additional field, and Klaviyo only accepts the
      // parameter from the revision that introduced it. Older revisions reject
      // it outright with an empty allowed-list -- which is what a first real
      // push hit, so the mock reproduces it.
      const asked = url.searchParams.get("additional-fields[template]");
      const picked = url.searchParams.get("fields[template]");
      const hasDefinition = honoured >= DEFINITION_REVISION;

      // Below the revision that introduced it, the definition is not a field
      // this endpoint has at all -- so neither way of asking for it is allowed,
      // and the error lists what is.
      if (asked && (!hasDefinition || templateMode !== "additional-fields")) {
        return send(400, { errors: [{ detail: `additional-fields must be in []: (got ${asked})` }] });
      }
      const FIELDS = ["amp", "created", "editor_type", "html", "id", "name", "text", "updated"];
      const allowed = hasDefinition ? [...FIELDS, "definition"] : FIELDS;
      if (picked) {
        const got = picked.split(",").map((f) => f.trim());
        const bad = got.filter((f) => !allowed.includes(f));
        if (bad.length) {
          return send(400, { errors: [{ detail:
            `fields must be in ${JSON.stringify(allowed).replace(/"/g, "'")}: ` +
            `(got ${JSON.stringify(got).replace(/"/g, "'")})` }] });
        }
      }

      const attributes = { ...t };
      if (!hasDefinition) delete attributes.definition;
      else if (templateMode === "additional-fields" && !asked && !picked?.includes("definition")) {
        delete attributes.definition;
      }
      return send(200, { data: { id: t.id, attributes } });
    }
    if (templateMatch && req.method === "DELETE") {
      if (!templates.has(templateMatch[1])) {
        return send(404, { errors: [{ detail: "No template with that id." }] });
      }
      templates.delete(templateMatch[1]);
      res.writeHead(204);
      return res.end();
    }
    if (templateMatch && req.method === "PATCH") {
      const t = templates.get(templateMatch[1]);
      if (!t) return send(404, { errors: [{ detail: "No template with that id." }] });
      // A template holding reusable blocks cannot be written back: the blocks
      // belong to every template that shares them, so Klaviyo will not take an
      // update that could redefine them from one campaign's copy.
      if (JSON.stringify(json.data.attributes?.definition ?? {}).includes('"universal_id"')) {
        return send(400, { errors: [{ detail:
          `Template ${t.id} contains universal blocks and cannot be updated. ` +
          "Universal blocks are reusable components shared across multiple templates." }] });
      }
      Object.assign(t, json.data.attributes);
      return send(200, { data: { id: t.id, attributes: t } });
    }
    if (p === "/templates" && req.method === "POST") {
      const attributes = json.data?.attributes ?? {};
      if (attributes.editor_type !== "SYSTEM_DRAGGABLE") {
        return send(400, { errors: [{ detail: "editor_type must be SYSTEM_DRAGGABLE." }] });
      }
      // The whole point of building it here rather than cloning: a template
      // created with shared blocks in it would be unwritable from birth, and
      // Klaviyo would rather it did not exist.
      if (JSON.stringify(attributes.definition ?? {}).includes('"universal_id"')) {
        return send(400, { errors: [{ detail:
          "A template cannot be created containing universal blocks." }] });
      }
      // Klaviyo assigns its own identifiers, and refuses a create that asserts
      // any -- once per offending element, which is how the real one answered.
      const asserted = [];
      const findIds = (node) => {
        if (Array.isArray(node)) return node.forEach(findIds);
        if (!node || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node)) {
          if (REFUSED_ON_CREATE.includes(k)) asserted.push(k);
          else findIds(v);
        }
      };
      // A refusal with nothing to learn from: the client cannot parse a key out
      // of it, so it must give up rather than retry blindly.
      if (REFUSED_ON_CREATE.includes("__opaque")) {
        return send(400, { errors: [{ detail: "That definition is not acceptable." }] });
      }
      findIds(attributes.definition ?? {});
      if (asserted.length) {
        return send(400, { errors: asserted.map((k) => ({
          detail: `${k} is not allowed to be specified on create.` })) });
      }
      const id = `TPL${nextId++}`;
      templates.set(id, {
        id, name: attributes.name, editor_type: "SYSTEM_DRAGGABLE",
        definition: attributes.definition ?? null,
      });
      return send(201, { data: { id, attributes: templates.get(id) } });
    }
    if (p === "/template-clone" && req.method === "POST") {
      const source = templates.get(json.data.id);
      if (!source) return send(404, { errors: [{ detail: "No template to clone." }] });
      const id = `TPL${nextId++}`;
      templates.set(id, {
        id, name: json.data.attributes.name ?? `Clone of ${source.name}`,
        editor_type: source.editor_type,
        definition: JSON.parse(JSON.stringify(source.definition)),
      });
      return send(201, { data: { id, attributes: templates.get(id) } });
    }

    // ---- texts (2026-10-15) ------------------------------------------------
    const smsShape = honoured === SMS_REVISION;
    const smsStatus = (messageId) => smsMessages.get(messageId)?.status;

    if (p === "/images" && req.method === "POST") {
      const from = json?.data?.attributes?.import_from_url ?? "";
      if (!/^(https:\/\/|data:)/.test(from)) {
        return send(400, { errors: [{ detail: "import_from_url must be a URL or data URI." }] });
      }
      const id = String(nextId++);
      images.set(id, { id, name: json.data.attributes.name, url: from, hidden: json.data.attributes.hidden });
      return send(201, { data: { type: "image", id, attributes: { name: json.data.attributes.name,
        image_url: `https://cdn.mock/${id}.jpg`, format: "jpeg", size: 1, hidden: Boolean(json.data.attributes.hidden),
        updated_at: new Date().toISOString() }, links: {} } });
    }

    if (p === "/campaigns" && req.method === "POST" && json?.data?.attributes?.definition) {
      if (!smsShape) {
        return send(400, { errors: [{ detail: "definition is not a valid campaign attribute at this revision." }] });
      }
      const a = json.data.attributes;
      if (!a.audiences?.length) return send(400, { errors: [{ detail: "At least one audience is required." }] });
      if (a.definition.send_settings?.send_strategy === "simple" && !a.definition.send_settings.send_timezone) {
        return send(400, { errors: [{ detail: "'simple' requires send_timezone." }] });
      }
      const id = `SCMP${nextId++}`;
      const byTemp = new Map();
      const audienceIds = a.audiences.map((aud) => {
        const aid = `SAUD${nextId++}`;
        byTemp.set(aud.temporary_id, aid);
        smsAudiences.set(aid, { id: aid, campaignId: id, included: aud.included ?? [], excluded: aud.excluded ?? [] });
        return aid;
      });
      const messageIds = [];
      for (const m of a.messages ?? []) {
        const audienceId = byTemp.get(m.audience_temporary_id);
        if (!audienceId) return send(400, { errors: [{ detail: "audience_temporary_id matches no audience." }] });
        const mid = `SMSG${nextId++}`;
        smsMessages.set(mid, { id: mid, campaignId: id, audienceId, status: "draft", name: m.name });
        for (const v of m.variations ?? []) {
          const d = v.definition?.details ?? {};
          if (d.text_message_type === "MMS" && !images.has(String(d.mms_static_image_asset_id))) {
            return send(400, { errors: [{ detail: "mms_static_image_asset_id is not an image in this account." }] });
          }
          const vid = `SVAR${nextId++}`;
          smsVariations.set(vid, { id: vid, messageId: mid, details: d });
        }
        messageIds.push(mid);
      }
      smsCampaigns.set(id, { id, definition: a.definition });
      return send(201, { data: { type: "campaign", id, attributes: { definition: a.definition },
        relationships: {
          "campaign-messages": { data: messageIds.map((mid) => ({ type: "campaign-message", id: mid })) },
          "campaign-audiences": { data: audienceIds.map((aid) => ({ type: "campaign-audience", id: aid })) },
        } } });
    }
    const smsVariationsOf = /^\/campaign-messages\/([^/]+)\/campaign-variations$/.exec(p);
    if (smsVariationsOf && req.method === "GET") {
      if (!smsShape) return send(404, { errors: [{ detail: "Not found at this revision." }] });
      if (!smsMessages.has(smsVariationsOf[1])) return send(404, { errors: [{ detail: "No message with that id." }] });
      return send(200, { data: [...smsVariations.values()].filter((v) => v.messageId === smsVariationsOf[1])
        .map((v) => ({ type: "campaign-variation", id: v.id, attributes: { definition: { details: v.details } } })) });
    }
    const smsMessageGet = /^\/campaign-messages\/([^/]+)$/.exec(p);
    if (smsMessageGet && req.method === "GET" && smsMessages.has(smsMessageGet[1])) {
      if (!smsShape) return send(400, { errors: [{ detail: "Use revision 2026-10-15 for this message." }] });
      const m = smsMessages.get(smsMessageGet[1]);
      return send(200, { data: { type: "campaign-message", id: m.id, attributes: { definition: { name: m.name, status: m.status } } } });
    }
    const variationMatch = /^\/campaign-variations\/([^/]+)$/.exec(p);
    if (variationMatch && req.method === "PATCH") {
      if (!smsShape) return send(404, { errors: [{ detail: "Not found at this revision." }] });
      const v = smsVariations.get(variationMatch[1]);
      if (!v) return send(404, { errors: [{ detail: "No variation with that id." }] });
      if (smsStatus(v.messageId) !== "draft") {
        return send(409, { errors: [{ detail: "Only a draft message's variations can be edited." }] });
      }
      const d = json.data.attributes.definition.details;
      if (d.text_message_type === "MMS" && !images.has(String(d.mms_static_image_asset_id))) {
        return send(400, { errors: [{ detail: "mms_static_image_asset_id is not an image in this account." }] });
      }
      v.details = d;
      return send(200, { data: { type: "campaign-variation", id: v.id } });
    }
    const audienceMatch = /^\/campaign-audiences\/([^/]+)$/.exec(p);
    if (audienceMatch && req.method === "PATCH") {
      if (!smsShape) return send(404, { errors: [{ detail: "Not found at this revision." }] });
      const aud = smsAudiences.get(audienceMatch[1]);
      if (!aud) return send(404, { errors: [{ detail: "No audience with that id." }] });
      const m = [...smsMessages.values()].find((x) => x.audienceId === aud.id);
      if (m && m.status !== "draft") return send(409, { errors: [{ detail: "Only a draft's audience can change." }] });
      const def = json.data.attributes.definition ?? {};
      if (def.included) aud.included = def.included;
      if (def.excluded) aud.excluded = def.excluded;
      return send(200, { data: { type: "campaign-audience", id: aud.id } });
    }
    if (p === "/campaign-message-schedule" && req.method === "POST") {
      if (!smsShape) return send(404, { errors: [{ detail: "Not found at this revision." }] });
      const attrs = json.data.attributes;
      const mid = json.data.relationships?.["campaign-message"]?.data?.id;
      const m = smsMessages.get(mid);
      if (!m) return send(404, { errors: [{ detail: "No message with that id." }] });
      if (m.status !== "draft") return send(409, { errors: [{ detail: "That message is already scheduled." }] });
      if (attrs.strategy === "static" && !(new Date(attrs.send_time).getTime() > Date.now())) {
        return send(400, { errors: [{ detail: "send_time must be in the future." }] });
      }
      const sid = `SSCH${nextId++}`;
      smsSchedules.set(sid, { id: sid, messageId: mid, strategy: attrs.strategy, sendTime: attrs.send_time });
      m.status = "scheduled";
      return send(201, { data: { type: "campaign-message-schedule", id: sid,
        attributes: { strategy: attrs.strategy, send_time: attrs.send_time } } });
    }
    const scheduleMatch = /^\/campaign-message-schedule\/([^/]+)$/.exec(p);
    if (scheduleMatch && req.method === "PATCH") {
      if (!smsShape) return send(404, { errors: [{ detail: "Not found at this revision." }] });
      const sch = smsSchedules.get(scheduleMatch[1]);
      if (!sch) return send(404, { errors: [{ detail: "No schedule with that id." }] });
      const action = json.data.attributes?.action;
      const m = smsMessages.get(sch.messageId);
      // The reference does not say what each does. Played here as the client
      // reads them: revert puts it back to draft, cancel ends it for good.
      if (action === "revert") m.status = "draft";
      else if (action === "cancel") m.status = "cancelled";
      else return send(400, { errors: [{ detail: "action must be cancel or revert." }] });
      smsSchedules.delete(sch.id);
      return send(200, { data: { type: "campaign-message-schedule", id: sch.id } });
    }

    if (p === "/campaigns" && req.method === "POST") {
      const id = `CMP${nextId++}`;
      const messageId = `MSG${nextId++}`;
      campaigns.set(id, {
        id, messageId, status: "Draft", archived: false,
        attributes: json.data.attributes, templateId: null,
      });
      return send(201, { data: { id, relationships: { "campaign-messages": { data: [{ id: messageId }] } } } });
    }
    const campaignMatch = /^\/campaigns\/([^/]+)$/.exec(p);
    if (campaignMatch && req.method === "GET") {
      const c = campaigns.get(campaignMatch[1]);
      if (!c) return send(404, { errors: [{ detail: "No campaign with that id." }] });
      return send(200, { data: { id: c.id, attributes: {
        name: c.attributes.name, status: c.status, scheduled_at: null,
        send_time: c.attributes.send_strategy?.datetime ?? null, archived: c.archived } } });
    }
    if (campaignMatch && req.method === "PATCH") {
      const c = campaigns.get(campaignMatch[1]);
      if (!c) return send(404, { errors: [{ detail: "No campaign with that id." }] });
      // Klaviyo will not let you edit a campaign that is already in the send
      // queue. Mirroring that here is the point: a mock that accepts it would
      // let a push-again path pass in testing and fail against the real API.
      if (c.status === "Scheduled") {
        return send(409, { errors: [{ detail: "Cannot update a scheduled campaign." }] });
      }
      Object.assign(c.attributes, json.data.attributes);
      return send(200, { data: { id: c.id } });
    }
    if (/^\/campaign-messages\/[^/]+$/.test(p) && req.method === "PATCH") {
      return send(200, { data: { id: p.split("/").pop() } });
    }
    if (p === "/campaign-message-assign-template" && req.method === "POST") {
      const c = [...campaigns.values()].find((x) => x.messageId === json.data.id);
      if (!c) return send(404, { errors: [{ detail: "No message with that id." }] });
      if (c.status === "Scheduled") {
        return send(409, { errors: [{ detail: "Cannot change the content of a scheduled campaign." }] });
      }
      const assigned = json.data.relationships.template.data.id;
      if (assignMode === "copy") {
        // Klaviyo's own non-reusable version, which is what the message ends up
        // holding; the template that was handed over is then unreferenced.
        const source = templates.get(assigned);
        const copyId = `MSGTPL${nextId++}`;
        templates.set(copyId, { ...source, id: copyId, name: `${source?.name ?? ""} (message copy)` });
        c.templateId = copyId;
      } else {
        c.templateId = assigned;
      }
      return send(200, { data: { id: json.data.id } });
    }
    const messageMatch = /^\/campaign-messages\/([^/]+)$/.exec(p);
    if (messageMatch && req.method === "GET") {
      const c = [...campaigns.values()].find((x) => x.messageId === messageMatch[1]);
      if (!c) return send(404, { errors: [{ detail: "No message with that id." }] });
      return send(200, { data: { id: c.messageId, type: "campaign-message",
        relationships: { template: { data: c.templateId ? { type: "template", id: c.templateId } : null } } } });
    }
    const cancelMatch = /^\/campaign-send-jobs\/([^/]+)$/.exec(p);
    if (cancelMatch && req.method === "PATCH") {
      const c = campaigns.get(cancelMatch[1]);
      if (!c) return send(404, { errors: [{ detail: "No campaign with that id." }] });
      if (json.data.attributes?.action !== "cancel") {
        return send(400, { errors: [{ detail: "Only cancel is mocked." }] });
      }
      c.status = "Draft";
      for (let i = sendJobs.length - 1; i >= 0; i--) {
        if (sendJobs[i].campaignId === c.id) sendJobs.splice(i, 1);
      }
      return send(200, { data: { id: c.id, attributes: { status: "cancelled" } } });
    }
    if (p === "/campaign-send-jobs" && req.method === "POST") {
      const c = campaigns.get(json.data.id);
      if (!c) return send(404, { errors: [{ detail: "No campaign with that id." }] });
      if (c.status === "Scheduled") {
        return send(409, { errors: [{ detail: "That campaign is already scheduled." }] });
      }
      c.status = "Scheduled";
      sendJobs.push({ campaignId: c.id, at: new Date().toISOString() });
      return send(202, { data: { id: `JOB${nextId++}`, attributes: { status: "queued" } } });
    }

    send(404, { errors: [{ detail: `no mock for ${req.method} ${p}` }] });
  });
}).listen(4599, () => console.log("mock klaviyo on 4599"));
