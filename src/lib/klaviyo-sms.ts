import { call, KlaviyoError } from "@/lib/klaviyo";

/**
 * Text-message campaigns in a client's Klaviyo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Verified against developers.klaviyo.com, revision 2026-10-15 (read November
 * 2026). The pages this file follows, under /en/reference/:
 *   create_campaign, get_messages_for_campaign, get_campaign_message,
 *   get_variations_for_campaign_message, update_campaign_variation,
 *   update_campaign_audience, schedule_campaign_message,
 *   update_campaign_message_schedule, upload_image_from_url
 * and /en/docs/campaigns_api_overview for the SMS walk-through.
 *
 * Why a different revision from email. At the revision the email push is
 * pinned to (2026-04-15) an SMS message can be created and given a body, but
 * not an image: `media_url` appears only in responses, and the message's image
 * relationship is documented as being for push notifications. 2026-10-15
 * reorganised campaigns into audiences, messages and *variations*, and it is on
 * a variation's SMS details that `text_message_type: "MMS"` and
 * `mms_static_image_asset_id` live. So every call in this file sends 2026-10-15
 * explicitly, and the email push is left on the revision it is proven on --
 * Klaviyo takes the revision per request, so the two do not have to move
 * together.
 *
 * Scopes a key needs for this: campaigns:read, campaigns:write, images:write.
 *
 * Not yet stated by the reference, and so handled conservatively below:
 * - What "cancel" and "revert" on a message schedule each do. The page says
 *   only "Cancel or revert a scheduled campaign message". `revert` is used to
 *   take a send back out of the queue, on the reading that it returns the
 *   message to draft; the push then reads the message status back rather than
 *   assuming, and a message that came back anything but "draft" is treated as
 *   gone and replaced.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Like the email client, nothing here sends on its own: scheduling is one
 * named function and the push calls it in one place.
 */

export const SMS_REVISION = "2026-10-15";

const at = { revision: SMS_REVISION };

export interface SmsCampaignContent {
  name: string;
  body: string;
  /** Klaviyo's own image id, from `importImage`. Present makes it an MMS. */
  imageAssetId: string | null;
  includedAudiences: string[];
  excludedAudiences: string[];
  /**
   * The account's own opt-out wording, appended at send time.
   *
   * On by default here, unlike Klaviyo's default: a marketing text with no way
   * to stop it is a compliance failure, and the copy check in `sms.ts` only
   * lets a body without "STOP" through when this is on.
   */
  addOptOutLanguage: boolean;
  /** The IANA zone the campaign is scheduled in. */
  timezone: string;
}

export interface SmsCampaignRefs {
  campaignId: string;
  messageId: string;
  audienceId: string;
  variationId: string;
}

export type SmsMessageStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

function details(content: SmsCampaignContent) {
  return {
    channel: "sms",
    body: content.body,
    text_message_type: content.imageAssetId ? "MMS" : "SMS",
    // An integer in the schema, though images come back with string ids ("7").
    ...(content.imageAssetId ? { mms_static_image_asset_id: Number(content.imageAssetId) } : {}),
    add_opt_out_language: content.addOptOutLanguage,
  };
}

/**
 * A new SMS campaign: one audience, one message, one variation, all inline.
 *
 * The create response names the audience and the message but not the
 * variation, so it is read back once -- the variation is where the body lives,
 * and the next push has to be able to find it.
 */
export async function createSmsCampaign(
  apiKey: string,
  content: SmsCampaignContent,
): Promise<SmsCampaignRefs> {
  const created = await call<{
    data: {
      id: string;
      relationships?: {
        "campaign-messages"?: { data?: { id: string }[] };
        "campaign-audiences"?: { data?: { id: string }[] };
      };
    };
  }>(apiKey, "/campaigns", {
    ...at,
    method: "POST",
    body: {
      data: {
        type: "campaign",
        attributes: {
          definition: {
            name: content.name,
            send_settings: { send_strategy: "simple", send_timezone: content.timezone },
          },
          audiences: [
            {
              temporary_id: "a",
              name: content.name,
              included: content.includedAudiences,
              excluded: content.excludedAudiences,
            },
          ],
          messages: [
            {
              audience_temporary_id: "a",
              name: content.name,
              variations: [{ definition: { name: content.name, details: details(content) } }],
            },
          ],
        },
      },
    },
  });

  const campaignId = created.data.id;
  const messageId = created.data.relationships?.["campaign-messages"]?.data?.[0]?.id;
  const audienceId = created.data.relationships?.["campaign-audiences"]?.data?.[0]?.id;
  if (!messageId || !audienceId) {
    throw new KlaviyoError(
      502,
      "Klaviyo created the SMS campaign but did not say which message and audience it made.",
    );
  }
  const variationId = await fetchVariationId(apiKey, messageId);
  return { campaignId, messageId, audienceId, variationId };
}

async function fetchVariationId(apiKey: string, messageId: string): Promise<string> {
  const body = await call<{ data: { id: string }[] }>(
    apiKey,
    `/campaign-messages/${messageId}/campaign-variations`,
    at,
  );
  const id = body.data?.[0]?.id;
  if (!id) throw new KlaviyoError(502, "Klaviyo's SMS message has no variation to put the text in.");
  return id;
}

/** New copy, image and audience on a campaign that is still a draft. */
export async function updateSmsCampaign(
  apiKey: string,
  refs: SmsCampaignRefs,
  content: SmsCampaignContent,
): Promise<void> {
  await call(apiKey, `/campaign-variations/${refs.variationId}`, {
    ...at,
    method: "PATCH",
    body: {
      data: {
        type: "campaign-variation",
        id: refs.variationId,
        attributes: { definition: { name: content.name, details: details(content) } },
      },
    },
  });
  await call(apiKey, `/campaign-audiences/${refs.audienceId}`, {
    ...at,
    method: "PATCH",
    body: {
      data: {
        type: "campaign-audience",
        id: refs.audienceId,
        attributes: {
          definition: {
            name: content.name,
            included: content.includedAudiences,
            excluded: content.excludedAudiences,
          },
        },
      },
    },
  });
}

/** The message's status, or null when Klaviyo no longer has it. */
export async function fetchSmsMessageStatus(
  apiKey: string,
  messageId: string,
): Promise<SmsMessageStatus | null> {
  try {
    const body = await call<{ data: { attributes: { definition?: { status?: string } } } }>(
      apiKey,
      `/campaign-messages/${messageId}`,
      at,
    );
    const status = body.data.attributes.definition?.status;
    return (status as SmsMessageStatus) ?? "draft";
  } catch (error) {
    if (error instanceof KlaviyoError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Bring an image into the client's Klaviyo so an MMS can carry it.
 *
 * Klaviyo fetches the URL itself, so it has to be public. Hidden from the
 * asset library: these are per-send copies, and a library filling up with them
 * is the template-litter problem the email push goes to lengths to avoid.
 */
export async function importImage(apiKey: string, url: string, name: string): Promise<string> {
  const body = await call<{ data: { id: string } }>(apiKey, "/images", {
    ...at,
    method: "POST",
    body: { data: { type: "image", attributes: { name, import_from_url: url, hidden: true } } },
  });
  return body.data.id;
}

/**
 * The only function in this file that causes texts to be sent.
 *
 * Static: at this instant, in the campaign's zone. Returns the schedule's own
 * id, which is what taking it back again needs.
 */
export async function scheduleSmsMessage(
  apiKey: string,
  messageId: string,
  sendAt: Date,
): Promise<string> {
  const body = await call<{ data: { id: string } }>(apiKey, "/campaign-message-schedule", {
    ...at,
    method: "POST",
    body: {
      data: {
        type: "campaign-message-schedule",
        attributes: { strategy: "static", send_time: sendAt.toISOString() },
        relationships: { "campaign-message": { data: { type: "campaign-message", id: messageId } } },
      },
    },
  });
  return body.data.id;
}

/** Take a scheduled text back out of the queue. See the header on "revert". */
export async function unscheduleSmsMessage(apiKey: string, scheduleId: string): Promise<void> {
  await call(apiKey, `/campaign-message-schedule/${scheduleId}`, {
    ...at,
    method: "PATCH",
    body: { data: { type: "campaign-message-schedule", id: scheduleId, attributes: { action: "revert" } } },
  });
}
