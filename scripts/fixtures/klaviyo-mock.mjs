// Stands in for Klaviyo so the whole push can be exercised without touching a
// client's account. Keeps state in memory and dumps it on /__state.
import { createServer } from "node:http";

const GOOD = "pk_live_testkey0000000000000000000000ab";
const MARKER = "EMAILPREVIEWS:CONTENT";

const htmlBlock = (content) => ({ content_type: "block", type: "html", data: { content } });

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
        htmlBlock('<p>Legal small print, {% unsubscribe %}</p>'),
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

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/vnd.api+json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/__state") {
    return send(200, {
      templates: [...templates.values()],
      campaigns: [...campaigns.values()],
      sendJobs,
    });
  }
  if (url.pathname === "/__reset") {
    campaigns.clear();
    sendJobs.length = 0;
    for (const id of [...templates.keys()]) if (id !== "BASE01" && id !== "CODEONLY") templates.delete(id);
    templates.set("BASE01", { id: "BASE01", name: "Burju base", editor_type: "SYSTEM_DRAGGABLE", definition: baseDefinition() });
    return send(200, { ok: true });
  }

  if ((req.headers.revision ?? "") !== "2024-10-15") {
    return send(400, { errors: [{ detail: "missing or wrong revision header" }] });
  }
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
    if (p === "/lists") {
      return send(200, { data: [{ id: "L1", attributes: { name: "Newsletter" } },
        { id: "L3", attributes: { name: "Ambiguous" } }], links: { next: null } });
    }
    if (p === "/segments") {
      return send(200, { data: [{ id: "S1", attributes: { name: "Engaged 90 days" } },
        { id: "S2", attributes: { name: "VIP" } },
        { id: "S3", attributes: { name: "Ambiguous" } }], links: { next: null } });
    }

    const templateMatch = /^\/templates\/([^/]+)$/.exec(p);
    if (templateMatch && req.method === "GET") {
      const t = templates.get(templateMatch[1]);
      if (!t) return send(404, { errors: [{ detail: "No template with that id." }] });
      return send(200, { data: { id: t.id, attributes: t } });
    }
    if (templateMatch && req.method === "PATCH") {
      const t = templates.get(templateMatch[1]);
      if (!t) return send(404, { errors: [{ detail: "No template with that id." }] });
      Object.assign(t, json.data.attributes);
      return send(200, { data: { id: t.id, attributes: t } });
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
      c.templateId = json.data.relationships.template.data.id;
      return send(200, { data: { id: json.data.id } });
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
