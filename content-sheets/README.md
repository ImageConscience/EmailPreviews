# Content sheets

| Sheet | Company | Rows |
| --- | --- | --- |
| `campaign-content.{csv,xlsx}` | Safety Facility Services | 54 |
| `museum-of-graffiti-content.{csv,xlsx}` | Museum of Graffiti | 14 |

Each is a single sheet covering every template for that company, with a
`template` column naming which layout each row belongs to.

## Safety Facility Services

`campaign-content.csv` (and the identical `campaign-content.xlsx`) holds every
campaign for every template in one sheet. Upload it once under **Content**.

**54 rows × 30 columns** — three series, six months each, three copy options per
month, generated from `SFS_Email_Content_Planner_2026_V2_2.xlsx`.

| Series | Template | Months | Rows |
| --- | --- | --- | --- |
| Core service focus | `Core Service` | Sep 2026 – Feb 2027 | 18 |
| Seasonal rotating | `Seasonal` | Sep 2026 – Feb 2027 | 18 |
| Pest control (P1) | `Pest Control` | Oct 2026 – Mar 2027 | 18 |

Every option is loaded as its own row rather than picked in the spreadsheet
first, so you can see all three side by side in the real layout and approve the
one you want. Columns that do not apply to a row are simply empty.

## Regenerating from the planner

```bash
node scripts/planner-to-content.mjs path/to/planner.xlsx
```

The planner is transposed relative to what the app wants — its rows are fields
and its columns are month × option, so one email is a *column* there and a *row*
here. The script also drops what the templates already own (logo, nav bar, view
-as-webpage) and strips the planner's own annotations, so `SAFETY TIP  (fixed
label for the cream box)` arrives as `SAFETY TIP`.

## The `template` column

The first column names the template each row is previewed in. Select a row and
that template is chosen automatically; you can still switch to see the same copy
in a different layout, and the app shows which template the row asked for.

Matching ignores case and punctuation. If a row names a template that does not
exist yet, the preview falls back to the first template and says so.

## Planning columns

`send_month` and `option` describe the campaign rather than filling
the template. The app knows these are planning columns and does not report them
as ignored, and they appear under each row in the rail so a 54-row sheet reads
as a schedule: *Sep 2026 · Janitorial · Option A · Core Service*.

## Subject, preview text and the send slot

`subject`, `preheader`, `send_date` and `send_time` are shown above the render,
styled like the inbox line and the schedule they become, and are editable there.
None of them is a placeholder: the sending platform sets all four, so nothing
about them belongs in the email body. Carrying them here means they are written,
reviewed and approved with the copy they belong to, and editing any of them
marks existing approvals stale like any other change.

Recognised header names: `subject` / `subject_line`; `preheader` /
`preview_text` / `preview`; `send_date` / `date` / `scheduled_date`; and
`send_time` / `time` / `scheduled_time`. A sheet without any of them simply
shows no bar.

Date and time get native pickers when the cell is already in the format those
emit — `yyyy-mm-dd` and `hh:mm`. Anything else (`8/27/26`, `9am ET`) stays a
plain text box, because a date input would hand back an empty string and quietly
lose the value.

## Images

`hero_image` points at the placeholder photos in `public/brand/` for every row.
`hero_alt` carries the planner's art direction for that campaign (for example
*"P1 tech sealing a gap along a warehouse dock door"*), so it doubles as the
brief for the photo still to be sourced and as real alt text once it is.

## Before a real send

The Constant Contact links live in the templates, not here — the four it injects
(view-as-webpage, unsubscribe, update profile, data notice) are `href="#"` with a
comment beside them. Set them once per template.

The site URLs are inferred from the address in the footer. Check they exist.


## Museum of Graffiti

`museum-of-graffiti-content.csv` (and the identical `.xlsx`) holds every send in
the three series from 17 July onwards, read back out of Klaviyo.

**14 rows × 74 columns**, newest first, 18 July to 31 August 2026.

| Series | Template | Rows |
| --- | --- | --- |
| Category spotlight | `Category Spotlight` | 6 |
| Artist spotlight | `Artist Spotlight` | 5 |
| Monthly tee drop | `Tee of the Month` | 3 |

These are not invented examples: every headline, paragraph, product title,
price, image URL and link is what actually went out. Klaviyo renders its
`{% catalog %}` blocks against live Shopify data, so the sheet was built from
the rendered output rather than the stored template.

`templates/museum-of-graffiti/README.md` covers what became a placeholder and
what stayed fixed.

### The first row has not gone out yet

*Collectibles & Toys* is scheduled for 31 August, not sent. It is in here
because it is the next campaign anyone would want to look at, and it is the one
row where approving in this app happens before the send rather than after.

### One row is copy-only

Klaviyo's render endpoint returns a server error for *Pins, Patches & Stickers*
(10 August) — on the original and on its clone, so a product in that send is
almost certainly gone from the catalog, which is what breaks the render. Its
headline, intro, section labels and accent colour came from the stored template
and are correct; its eight product tiles are empty. Klaviyo's catalog API is no
help either: this account's catalog is a Shopify integration, and that endpoint
only serves `$custom` items.

### The evergreen tee was standardised

The 7 August membership email used a different hero from the two monthly drops —
no member/retail price block and a headline where the announcement strip goes.
It is mapped onto the monthly-drop layout: the strip carries its own
*Artist Tee Membership · Presented by AS Colour* line plus the subject as the
second line, and the price block uses the same shirt's pricing from the August
drop that sent a week later.

### Planning columns

`campaign` and `theme` describe the campaign rather than filling a template, and
the app knows not to report them as ignored. `theme` names the series, so the
row rail reads as a schedule. `send_date` and `send_time` carry the real send
slot from Klaviyo, converted to the account's US/Eastern; they appear in the bar
above the render rather than among the fields.

### Product descriptions are truncated

Klaviyo's catalog blocks print descriptions through `truncate:300`, so the
longer ones in `product_1_description` end in an ellipsis mid-sentence. That is
faithful to what was sent; rewrite them if you want the full copy.

### Preview text

Every one of these sends went out with an empty preview text in Klaviyo, so the
`preheader` column is blank throughout. Worth filling in — it is
the second line every recipient reads in the inbox.
