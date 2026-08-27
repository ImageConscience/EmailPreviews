# Content sheets

`campaign-content.csv` (and the identical `campaign-content.xlsx`) holds **every
campaign for every template in one sheet**. Upload it once under **Content**.

42 columns × 3 rows: the three mockups, one per template. Columns that do not
apply to a row are simply empty — a seasonal row leaves the pest columns blank
and vice versa.

## The `template` column

The first column names the template each row is meant to be previewed in:

| template | headline | … |
| --- | --- | --- |
| Seasonal | August is when small HVAC problems get expensive. | |
| Core Service | Nobody notices clean. Everybody notices the day it slips. | |
| Pest Control | Roaches don't walk in. They arrive on the freight. | |

Select a row in the preview and that template is chosen automatically. You can
still switch templates to see the same copy in a different layout; the app shows
which template the row asked for and offers a one-click way back. Moving to
another row applies that row's own template again.

Matching ignores case and punctuation, so `pest control`, `Pest Control` and a
template named `03 Pest Control` all find each other. If a row names a template
that does not exist yet, the preview falls back to the first template and says
so rather than failing.

`template`, `template_name`, `email_template`, `default_template` and `layout`
are all recognised as this column, so name it whichever suits you.

## Column layout

`template` first, then the 11 fields every template shares (headline, hero
image, body copy, CTA, footer links), then the 30 that belong to one template
each. That keeps the sheet readable left to right as it grows.

## Two things to change before a real send

**The four platform links are `#`**, matching the mockup: `webview_url`,
`unsubscribe_url`, `update_profile_url` and `data_notice_url`. Constant Contact
injects these at send time — replace them with whatever tokens it gives you.

**The site URLs are inferred** from the address in the footer —
`safetyfacilityservices.com/services`, `/contact`, `/customer-portal`,
`/request-a-quote`, and `p1pestsolutions.com/site-inspection`. Check they exist.

## Adding campaigns

Add a row, set `template`, and fill the columns that template uses. The preview
reports anything left blank, so you do not have to remember which columns belong
to which template.

`hero_image` points at the mockup photos in `public/brand/`; swap in a real URL
per campaign. Anything constant across sends — the credentials line, the postal
address, the Our Services block — lives in the template, not here.
