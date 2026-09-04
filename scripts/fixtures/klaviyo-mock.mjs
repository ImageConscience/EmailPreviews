// Stands in for Klaviyo so the whole push can be exercised without touching a
// client's account. Keeps state in memory and dumps it on /__state.
import { createServer } from "node:http";

const GOOD = "pk_live_testkey0000000000000000000000ab";
const MARKER = "EMAILPREVIEWS:CONTENT";

const htmlBlock = (content, universalId) => ({
  content_type: "block", type: "html", data: { content },
  ...(universalId ? { universal_id: universalId } : {}),
});

// A base template shaped like the one a person would build: chrome, an HTML
// block for the content carrying the marker, and a second HTML block that is
// not ours.
const baseDefinition = () => ({
  body: {
    sections: [
      { content_type: "section", data: { rows: [{ columns: [{ blocks: [
        { content_type: "block", type: "image", data: {} },
        htmlBlock(`<!-- ${MARKER} -->`),
      ] }] }] } },
      { content_type: "section", data: { rows: [{ columns: [{ blocks: [
        // Reusable content shared with other templates, the way a real footer
        // often is. Klaviyo refuses to update a template that contains one.
        htmlBlock('<p>Legal small print, {% unsubscribe %}</p>', "36798d44a3e34090"),
      ] }] }] } },
    ],
  },
  styles: [],
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
  "2026-01-15", "2026-04-15"];
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

  if (url.pathname === "/__state") {
    return send(200, {
      calls,
      templates: [...templates.values()],
      campaigns: [...campaigns.values()],
      sendJobs,
    });
  }
  if (url.pathname === "/__reset") {
    campaigns.clear();
    sendJobs.length = 0;
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
