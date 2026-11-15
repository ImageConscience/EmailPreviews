import {
  assignTemplate,
  cancelCampaign,
  createCampaign,
  createDndTemplate,
  deleteTemplate,
  fetchAccount,
  fetchAudiences,
  fetchCampaign,
  fetchMessageTemplate,
  fetchTemplate,
  scheduleCampaign,
  updateCampaign,
  type CampaignContent,
} from "@/lib/klaviyo";
import {
  detachUniversalBlocks,
  findContentBlock,
  stripIdentifiers,
  toBlockContent,
} from "@/lib/block-content";
import {
  EspError,
  type EmailProvider,
  type EspAccount,
  type EspAudience,
  type EspCampaignContent,
  type EspCampaignState,
  type EspRefs,
  type UpsertResult,
} from "@/lib/esp/types";

/**
 * Klaviyo, behind the common interface.
 *
 * All the awkwardness lives here, which is the point. Klaviyo will not put raw
 * HTML in a campaign: the content has to be a block inside a drag-and-drop
 * template, so every push builds one from the client's base template and the
 * campaign points at that. Everything that follows -- hoisting the document's
 * styles into the block, detaching shared blocks, stripping identifiers
 * Klaviyo refuses on create, deleting the leftover afterwards -- is the price
 * of that one fact, and none of it means anything to another platform.
 */
export class KlaviyoProvider implements EmailProvider {
  readonly id = "klaviyo" as const;
  readonly label = "Klaviyo";

  constructor(
    private readonly apiKey: string,
    private readonly baseTemplateId: string | null,
  ) {}

  async account(): Promise<EspAccount> {
    const found = await fetchAccount(this.apiKey);
    // The public API key, not the resource id: it is the "site ID" a person
    // recognises when checking they connected the client they meant to.
    return { id: found.publicId, name: found.name, timezone: found.timezone };
  }

  async audiences(): Promise<EspAudience[]> {
    return fetchAudiences(this.apiKey);
  }

  async blockers(): Promise<string[]> {
    // The base template is Klaviyo's alone: it is where the client's header,
    // footer and unsubscribe come from, and there is nowhere to put the
    // content without one.
    if (!this.baseTemplateId) {
      return ["No base template is chosen for this company, so there is nothing to put the content into."];
    }
    return [];
  }

  async upsertCampaign(
    existing: EspRefs | null,
    content: EspCampaignContent,
  ): Promise<UpsertResult> {
    if (!this.baseTemplateId) {
      throw new EspError("No base template is chosen for this company.");
    }
    const notes: string[] = [];

    // The document becomes block content: styles out of the head, hidden
    // preheader dropped in favour of Klaviyo's own preview text.
    const block = toBlockContent(content.html);
    notes.push(...block.notes);

    const base = await fetchTemplate(this.apiKey, this.baseTemplateId);
    if (!base.definition) {
      throw new EspError(
        `“${base.name}” is a ${base.editorType} template, which has no blocks to fill. ` +
          "The base template has to be a drag-and-drop one.",
      );
    }

    /*
     * Build the send's template from the base's structure, filled in, in one
     * create -- rather than cloning it and then editing the clone.
     *
     * Klaviyo will not update a template that holds blocks shared with other
     * templates, and it judges that by the template as stored: a clone of a
     * base with a shared footer can never be written to, however the update is
     * phrased. Assembling the finished definition here and posting it once
     * avoids the question, and leaves nothing half-made behind if it fails.
     */
    const definition = JSON.parse(JSON.stringify(base.definition)) as Record<string, unknown>;
    const target = findContentBlock(definition);
    if ("error" in target) throw new EspError(target.error);

    target.block.data = { ...(target.block.data ?? {}), content: block.html };

    // The shared blocks come across as ordinary ones. The content is kept; only
    // the link to the original is given up, which is what makes this template
    // writable and what keeps a later edit in Klaviyo from changing a send that
    // has already been approved.
    const detached = detachUniversalBlocks(definition);
    if (detached > 0) {
      const one = detached === 1;
      notes.push(
        `${detached} reusable ${one ? "block was" : "blocks were"} copied into this campaign ` +
          `rather than linked, so later edits to ${one ? "it" : "them"} in Klaviyo will not ` +
          "change this send.",
      );
    }

    // The definition names itself at every level, and Klaviyo assigns its own
    // identifiers to anything created; asserting the old ones is refused once
    // per element. Nothing in a definition refers to another part of it by id,
    // so there is nothing to repoint.
    stripIdentifiers(definition);

    const created = await createDndTemplate(this.apiKey, content.designName, definition);
    const cloneId = created.id;
    if (created.alsoRemoved.length > 0) {
      // Worth saying out loud: it means this app's idea of what Klaviyo will
      // not accept is out of date, and somebody should widen the list rather
      // than rely on the retry every send.
      notes.push(
        `Klaviyo also refused ${created.alsoRemoved.join(", ")} on the new template; it was ` +
          `created without ${created.alsoRemoved.length === 1 ? "it" : "them"}.`,
      );
    }

    let refs = existing ? { campaignId: existing.campaignId, messageId: existing.messageId } : null;
    let unqueued = false;
    if (refs) {
      // Only reuse a campaign Klaviyo still has and has not sent.
      const live = await fetchCampaign(this.apiKey, refs.campaignId);
      if (!live || live.status === "Sent" || live.archived) refs = null;
      else if (live.status === "Scheduled") {
        // Klaviyo refuses to edit a campaign that is already in the send queue,
        // so pushing over one means taking it out of the queue first. Doing it
        // here rather than surfacing Klaviyo's 409 keeps the row and the
        // campaign in step; the caller is told, and a scheduled push puts it
        // back at the end.
        await cancelCampaign(this.apiKey, refs.campaignId);
        unqueued = true;
      }
    }

    const payload = toKlaviyoContent(content);
    if (refs) await updateCampaign(this.apiKey, refs, payload);
    else refs = await createCampaign(this.apiKey, payload);

    await assignTemplate(this.apiKey, refs.messageId, cloneId);

    /*
     * Tidy up the clone, but only once it is provably not the thing the
     * campaign is made of.
     *
     * Assignment is a relationship, and if Klaviyo took its own copy then the
     * message points at that and this clone is litter -- a template per send,
     * piling up in the client's library forever. If instead the message points
     * straight at this clone, deleting it would empty a campaign that may
     * already be scheduled. So read back which it is rather than believing
     * either story, and delete only in the first case.
     */
    const held = await fetchMessageTemplate(this.apiKey, refs.messageId).catch(() => cloneId);
    const orphans = [cloneId, existing?.extra.templateId]
      .filter((id): id is string => Boolean(id) && id !== held);
    let tidied = 0;
    for (const id of [...new Set(orphans)]) {
      try {
        await deleteTemplate(this.apiKey, id);
        tidied += 1;
      } catch {
        // Cleanup is not worth failing a push that has otherwise worked; the
        // stray template is untidy, not broken.
      }
    }
    if (tidied > 0) {
      notes.push(
        `Tidied up ${tidied} one-off ${tidied === 1 ? "template" : "templates"} Klaviyo no ` +
          "longer needs.",
      );
    }

    return {
      refs: {
        campaignId: refs.campaignId,
        messageId: refs.messageId,
        extra: { templateId: held ?? cloneId },
      },
      notes,
      unqueued,
    };
  }

  async state(refs: EspRefs): Promise<EspCampaignState | null> {
    const live = await fetchCampaign(this.apiKey, refs.campaignId);
    if (!live) return null;
    return {
      status: live.status,
      sent: live.status === "Sent",
      queued: live.status === "Scheduled",
      archived: live.archived,
    };
  }

  async schedule(refs: EspRefs): Promise<void> {
    await scheduleCampaign(this.apiKey, refs.campaignId);
  }

  async unschedule(refs: EspRefs): Promise<void> {
    await cancelCampaign(this.apiKey, refs.campaignId);
  }
}

/** The common content, in the shape Klaviyo's client already takes. */
function toKlaviyoContent(content: EspCampaignContent): CampaignContent {
  return {
    name: content.name,
    subject: content.subject,
    previewText: content.previewText,
    fromEmail: content.fromEmail,
    fromLabel: content.fromLabel,
    replyTo: content.replyTo,
    includedAudiences: content.includedAudiences,
    excludedAudiences: content.excludedAudiences,
    sendAt: content.sendAt,
  };
}
