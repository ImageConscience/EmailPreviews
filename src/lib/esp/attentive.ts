import {
  createCampaign,
  fetchAccount,
  fetchCampaign,
  fetchSegments,
  pauseCampaign,
  scheduleCampaign,
  updateMessage,
  updateMessageGroup,
} from "@/lib/esp/attentive-api";
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
 * Attentive, behind the common interface.
 *
 * Shorter than the Klaviyo adapter by a long way, and the difference is one
 * fact: Attentive takes the email as HTML. There is no base template to choose,
 * nothing cloned per send, no shared blocks to detach, no identifiers to strip
 * and nothing left behind to tidy up. A campaign, its message, its audience and
 * its send time.
 */
export class AttentiveProvider implements EmailProvider {
  readonly id = "attentive" as const;
  readonly label = "Attentive";

  constructor(private readonly apiKey: string) {}

  async account(): Promise<EspAccount> {
    return fetchAccount(this.apiKey);
  }

  async audiences(): Promise<EspAudience[]> {
    return fetchSegments(this.apiKey);
  }

  async blockers(): Promise<string[]> {
    // Nothing beyond a key. Worth stating rather than leaving the reader to
    // notice the empty array: it is the whole reason this provider is simpler.
    return [];
  }

  async upsertCampaign(
    existing: EspRefs | null,
    content: EspCampaignContent,
  ): Promise<UpsertResult> {
    const notes: string[] = [];
    let unqueued = false;

    let refs = existing;
    if (refs) {
      const live = await fetchCampaign(this.apiKey, refs.campaignId);
      // Gone, or already out the door: either way this push starts fresh
      // rather than writing to something that is not there or cannot change.
      if (!live || live.sent || live.archived) refs = null;
      else if (live.queued) {
        // Attentive, like Klaviyo, will not take edits to a campaign that is
        // waiting to send. Pausing it first keeps the row and the campaign in
        // step; the caller decides whether to put it back in the queue.
        await pauseCampaign(this.apiKey, refs.campaignId);
        unqueued = true;
      }
    }

    if (!refs) {
      const made = await createCampaign(this.apiKey, content.name);
      refs = {
        campaignId: made.campaignId,
        messageId: made.messageId,
        extra: { messageGroupId: made.messageGroupId },
      };
    }

    await updateMessage(this.apiKey, refs.messageId, {
      name: content.name,
      subject: content.subject,
      preheaderText: content.previewText,
      fromEmail: content.fromEmail,
      fromName: content.fromLabel,
      replyToEmail: content.replyTo,
      html: content.html,
    });

    const groupId = refs.extra.messageGroupId;
    if (!groupId) {
      throw new EspError(
        "This campaign has no message group recorded, so its audience and send time cannot be " +
          "set. Push it again to start a fresh campaign.",
      );
    }
    await updateMessageGroup(
      this.apiKey,
      groupId,
      { include: content.includedAudiences, exclude: content.excludedAudiences },
      content.sendAt,
    );

    return { refs, notes, unqueued };
  }

  async state(refs: EspRefs): Promise<EspCampaignState | null> {
    return fetchCampaign(this.apiKey, refs.campaignId);
  }

  async schedule(refs: EspRefs): Promise<void> {
    await scheduleCampaign(this.apiKey, refs.campaignId);
  }

  async unschedule(refs: EspRefs): Promise<void> {
    await pauseCampaign(this.apiKey, refs.campaignId);
  }
}
