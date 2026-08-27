# Content sheets

One sheet per template, each carrying a single row that reproduces the original
mockup exactly. Upload them in the app under **Content**.

| File | Template | Columns |
| --- | --- | --- |
| `01-seasonal.csv` | `templates/01-seasonal.html` | 23 |
| `02-core-service.csv` | `templates/02-core-service.html` | 33 |
| `03-pest-control.csv` | `templates/03-pest-control.html` | 21 |
| `safety-campaign-content.xlsx` | all three, one worksheet each | — |

The workbook holds the same data on three tabs — **Seasonal**, **Core Service**
and **Pest Control**. Upload it once per tab, naming the worksheet in the
optional *Worksheet* field.

Every column matches a placeholder exactly: 23/23, 33/33 and 21/21 resolve, with
no unmatched placeholders and no unused columns.

## Two things to change before a real send

**The four platform links are `#`**, matching the mockup: `webview_url`,
`unsubscribe_url`, `update_profile_url` and `data_notice_url`. Constant Contact
injects these at send time, so replace them with whatever tokens it gives you.
Leaving them as `#` is harmless in preview and wrong in a real send.

**The site URLs are inferred** from the address in the footer —
`safetyfacilityservices.com/services`, `/contact`, `/customer-portal`,
`/request-a-quote`, and `p1pestsolutions.com/site-inspection` for the pest
template. Check they exist and correct any that do not.

## Adding campaigns

Add a row per send. `hero_image` currently points at the mockup photos in
`public/brand/`; swap in a real URL per campaign. Anything that should stay the
same on every send — the credentials line, the address, the Our Services block —
is hardcoded in the template rather than carried here.
