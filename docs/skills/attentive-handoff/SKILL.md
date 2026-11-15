---
name: attentive-handoff
description: Build approved Attentive emails and texts from Message Baker (Email Previews) in Attentive, then record what was built back in Message Baker. Also syncs a company's Attentive segments into Message Baker so its audience pickers work. Use when asked to "hand off the approved Attentive emails/texts", "push this client's Attentive campaigns", "send Message Baker's approved work to Attentive", or "sync Attentive segments into Message Baker". Needs both the Message Baker connector and the Attentive connector (write-enabled).
---

# Attentive handoff

Message Baker cannot reach Attentive itself: Attentive's published API has no
campaign endpoints, so the app holds no Attentive key. This skill is the bridge.
Message Baker says what is **already approved** in it; you build exactly that
in Attentive with Attentive's own tools, with the person approving each write
there; then you tell Message Baker what you made.

You never decide what is approved, change copy, or pick audiences. Those come
from Message Baker as they are. If something is not ready, report it; do not
fix it here.

## 0. Confirm the account (always first)

1. Message Baker: `list_companies`, and name the company you will work on.
2. Attentive: `get_user`, which shows the selected company. If it is not the same
   brand, use `list_user_companies` and `switch_company`, then `get_user` again.
3. Say both names back to the person and wait for a yes before any write. A
   working login on the wrong brand is the mistake this step exists to stop.

## 1. Sync segments (when asked, or when a handoff reports missing segments)

1. Attentive `list_segments`, paging until there are no more.
2. Message Baker `save_attentive_segments` with every `{id, name}` pair. This
   replaces the app's copy, so send the whole list, not just the new ones.

## 2. See what is ready

Message Baker `list_attentive_handoffs` for the company. It returns:

- `email[]`: `rowId`, `templateId`, `campaignName`, `subject`, `previewText`,
  `fromEmail`, `fromName`, `replyTo`, the complete rendered `html`, `sendAt`
  (an ISO instant, or null for undated), and `audience` (`includeIds`,
  `excludeIds`, `description`, and `error` if a name did not match).
- `sms[]`: `rowId`, `campaignName`, `body`, `imageUrl` (present means MMS),
  `relyOnPlatformOptOut`, `sendAt`, and `audience`.
- `notReady[]`: approved rows that cannot go yet, with reasons.

Show the person a short table (name, channel, send time, audience description)
and the `notReady` reasons, and ask which to build. Skip any item whose
`audience.error` is set. Tell them to fix the audience in Message Baker, or sync
segments if the list is stale.

If an item has `existing`, it was built before. When `existing.stale` is true,
the row changed after it was built. Ask whether to update the existing Attentive
campaign (`existing.campaignId`) or build a new one. Never build a second
campaign silently.

## 3. Build each one in Attentive

Read each Attentive tool's own input schema before calling it. Use these tools
for these purposes; the parameters are the tool's, not guesses.

**Email**
1. `create_campaign`: an email campaign shell named `campaignName`.
2. `get_campaign` to find its message group and message ids.
3. `update_email_message`: subject = `subject`, preheader = `previewText`,
   sender = `fromName` / `fromEmail` (and `replyTo` if set), body = `html` **as
   HTML**, unchanged. Do not reformat, trim or "improve" it; it is the approved
   document.
4. `update_campaign_message_group`: audience includes `audience.includeIds` and
   excludes `audience.excludeIds`. Set the schedule to `sendAt` only if the
   person asked for it to be scheduled.

**Text (SMS/MMS)**
1. `create_campaign`: an SMS campaign shell named `campaignName`.
2. `get_campaign` for the message group and message ids.
3. `update_sms_message`: body = `body`, unchanged. If `imageUrl` is set, attach
   it as the MMS media. If `relyOnPlatformOptOut` is true, the copy relies on
   Attentive's opt-out wording; if Attentive's tool does not add it, stop and say
   so rather than sending a text with no way out.
4. `update_campaign_message_group`: audience and, if scheduling, `sendAt`.

**Scheduling** is the point of no return. Call `schedule_campaign_send` only
when the person has said to schedule *this* campaign, after showing them the
name, audience description and send time. Otherwise leave it a draft.

If any call fails part-way, run `get_campaign` before retrying. Attentive warns
that an interrupted write may already have been applied.

## 4. Record it in Message Baker

For each campaign you built, call Message Baker `record_attentive_campaign`:

- `channel`: `"email"` or `"sms"`
- `rowId` (and `templateId` for email), exactly as listed
- `campaignId`: Attentive's id for the campaign
- `status`: `"scheduled"` if you called `schedule_campaign_send`, else `"draft"`
- `scheduledFor`: the `sendAt` you scheduled, when scheduled

If it refuses because the row is no longer approved, say so: someone edited it
after the list was read. The Attentive campaign now differs from what the app
holds, so ask the person what they want done with it.

## 5. Report

End with what was built (name, channel, draft or scheduled, Attentive campaign
id), what was skipped and why, and anything left for the person to do in
Attentive or Message Baker.
