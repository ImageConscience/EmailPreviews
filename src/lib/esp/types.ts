/**
 * One shape for "put this email into a sending platform".
 *
 * Klaviyo and Attentive disagree about almost everything below the surface.
 * Klaviyo wants a drag-and-drop template whose marked block is replaced, which
 * is why pushing to it clones a base, strips identifiers and tidies up after
 * itself. Attentive takes the HTML. Neither of those facts belongs in the
 * orchestration, so the interface is phrased as what the app wants -- a
 * campaign carrying this content, going to these people, at this time -- and
 * each provider is left to get there its own way.
 *
 * Email only, deliberately. SMS has a different notion of content, audience and
 * approval, so when it arrives it gets its own selector and its own interface
 * rather than optional fields on this one.
 */

export const EMAIL_PROVIDERS = ["klaviyo", "attentive"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDERS)[number];

export function isEmailProvider(value: string): value is EmailProviderId {
  return (EMAIL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * How each platform is named and described wherever the choice is offered.
 *
 * Here rather than beside `providerFor` because the screens that offer the
 * choice run in the browser, and this file is the half of the seam that holds
 * no database or credentials.
 */
export const PROVIDER_LABELS: Record<EmailProviderId, string> = {
  klaviyo: "Klaviyo",
  attentive: "Attentive",
};

export const PROVIDER_KEY_HELP: Record<EmailProviderId, string> = {
  klaviyo:
    "A private API key from Settings → API keys in Klaviyo, with campaign and template scopes.",
  attentive:
    "A private app key from the Attentive app you created for this. It needs campaign and segment access.",
};

/** What each platform calls the identifier shown beside the account name. */
export const PROVIDER_ACCOUNT_LABELS: Record<EmailProviderId, string> = {
  klaviyo: "Site ID",
  attentive: "Account ID",
};

/** Whose account a key turns out to belong to. */
export interface EspAccount {
  id: string;
  name: string;
  /**
   * The account's own zone, where the platform reports one.
   *
   * Used as the first guess at what a sheet's send times mean, and still
   * editable afterwards. Optional because not every platform says.
   */
  timezone?: string | null;
}

/** Somewhere a campaign can be sent, or kept from. */
export interface EspAudience {
  id: string;
  name: string;
  /** "list" or "segment" -- shown so two things of the same name can be told apart. */
  kind: string;
}

/** Everything that decides what lands in somebody's inbox. */
export interface EspCampaignContent {
  /** What the campaign is called in the sending platform. */
  name: string;
  subject: string;
  previewText: string;
  fromEmail: string;
  fromLabel: string;
  replyTo?: string;
  /**
   * The rendered email, as a whole HTML document.
   *
   * What a provider does with it differs: Attentive takes it as the body,
   * Klaviyo has to lift the styles out of the head and drop the rest into a
   * block inside a template. Handing over the document rather than something
   * pre-chewed keeps that decision with the provider that has the opinion.
   */
  html: string;
  /**
   * A name for any per-send artifact a provider has to create on the way --
   * Klaviyo makes a template per campaign and this is what it calls it.
   * Providers that create nothing ignore it.
   */
  designName: string;
  includedAudiences: string[];
  excludedAudiences: string[];
  /** When to send. Absent leaves it undated for a person to decide. */
  sendAt: Date | null;
}

/**
 * The handles that identify one campaign in one platform.
 *
 * `campaignId` and `messageId` are the two every provider has. Anything else a
 * provider needs to find its own work again goes in `extra`, which is stored as
 * JSON and handed straight back on the next push -- Klaviyo keeps the template
 * it created there, Attentive the message group.
 */
export interface EspRefs {
  campaignId: string;
  messageId: string;
  extra: Record<string, string>;
}

export interface EspCampaignState {
  /** The provider's own word for it, for showing rather than deciding on. */
  status: string;
  /** Whether this campaign has already gone out. Nothing may touch it after. */
  sent: boolean;
  /** Whether it is in the send queue, which usually means it cannot be edited. */
  queued: boolean;
  archived: boolean;
}

export interface UpsertResult {
  refs: EspRefs;
  /** Things worth telling the person afterwards, in their words not the API's. */
  notes: string[];
  /**
   * True when an existing campaign had to be taken out of the send queue to be
   * edited. The caller decides whether to put it back.
   */
  unqueued: boolean;
}

/**
 * What a provider has to be able to do for this app.
 *
 * Every method speaks for one company, with that company's credentials already
 * bound in -- see `providerFor`. Failures are thrown as `EspError`, whose
 * message is written for the person reading it on screen.
 */
export interface EmailProvider {
  readonly id: EmailProviderId;
  /** The platform's name, as a person would write it. */
  readonly label: string;

  /** Which account these credentials reach. Used to verify a key on connect. */
  account(): Promise<EspAccount>;

  /** Lists and segments this account can send to. */
  audiences(): Promise<EspAudience[]>;

  /**
   * Anything that must be settled before a push can be attempted, phrased for
   * the person who has to fix it. Empty means ready.
   *
   * Klaviyo needs a base template chosen; Attentive needs nothing beyond a key,
   * because it takes the HTML directly.
   */
  blockers(): Promise<string[]>;

  /**
   * Put this content into a campaign, creating one or replacing the content of
   * the one these refs name.
   */
  upsertCampaign(existing: EspRefs | null, content: EspCampaignContent): Promise<UpsertResult>;

  /** What the platform currently thinks of this campaign, or null if it is gone. */
  state(refs: EspRefs): Promise<EspCampaignState | null>;

  /** Hand it to the scheduler. The point of no return. */
  schedule(refs: EspRefs): Promise<void>;

  /** Take it back out of the send queue, leaving it as a draft. */
  unschedule(refs: EspRefs): Promise<void>;
}

/** A failure worth showing to the person who asked for the push. */
export class EspError extends Error {
  /** The platform's own words, where they add something. */
  detail?: string;
  /**
   * The HTTP status, where one caused this.
   *
   * Carried rather than read back out of the message, because the one decision
   * that turns on it -- a campaign somebody deleted means start a new one, not
   * fail -- was being made by searching the platform's prose for "404", which
   * is true of no well-written error message.
   */
  status?: number;
  constructor(message: string, detail?: string, status?: number) {
    super(message);
    this.detail = detail;
    this.status = status;
  }
}
