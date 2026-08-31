# Museum of Graffiti email templates

Three templates rebuilt from the recent Klaviyo sends on the Museum of Graffiti
account, ready to paste into Email Previews as templates.

| File | Series it replaces | Placeholders |
| --- | --- | --- |
| `01-category-spotlight.html` | *Category: …* — Collectibles & Toys, Books & Magazines, Prints & Posters, Home & Decor, Pins/Patches/Stickers | 49 |
| `02-artist-spotlight.html` | *Artist Spotlight: …* — Doze Green, SKEME, Shirt King Phade, Abstrk, Coco 144 | 32 |
| `03-tee-of-the-month.html` | *Subscription Tees* — the monthly AS Colour drop | 32 |

Name them `Category Spotlight`, `Artist Spotlight` and `Tee of the Month` when
you paste them in. The content sheet's `template` column uses those names, so
each row selects its own template. Matching ignores case and punctuation.

## Where these came from

Fourteen sends between 18 July and 31 August 2026, pulled from Klaviyo. The
originals are Klaviyo's own HTML export: MJML scaffolding, `.kl-` and `.mj-`
classes, an `@import` of a Klaviyo-hosted font sheet, and — the important part —
Klaviyo `{% catalog "<shopify id>" %}` blocks that pull each product's title,
price, image and link live from Shopify at send time.

None of that survives outside Klaviyo, so the templates were rebuilt rather than
edited:

- **The catalog blocks became plain placeholders.** Email Previews has no
  Shopify connection, so each product tile is now five ordinary fields
  (`product_1_image`, `_title`, `_price`, `_url`, `_badge`). The content sheet
  ships with the real values, read back out of Klaviyo's own rendering — actual
  titles, actual prices, actual Shopify image URLs.
- **`{% if %}` wrappers are gone.** Klaviyo hid a product tile whose id was
  blank; the placeholder engine here has no conditionals. A row that only has
  three products to show will render the fourth tile empty — see *Blank cells*
  below.
- **The layout is tables with inline styles**, as before. Same reasoning as the
  Safety Facility Services set: Outlook on Windows ignores flex and grid.
- **Fonts are the brand's own** — Barlow for the display headline, Oswald for
  labels, product titles and buttons, Archivo for body copy, each with the same
  fallback the originals used (`Arial Black`, `Arial Narrow`, Arial). Klaviyo
  served these from its own font host, which only works inside Klaviyo, so they
  are linked from Google Fonts here.

## What is a placeholder, and what is not

Two regions are fixed in the template and never appear in the sheet:

- **The teal brand bar** at the top, logo and all.
- **The whole black footer** — the Wynwood address, opening hours, the
  Instagram / TikTok / Shop All row, and the subscription line. The unsubscribe
  link is `href="#"` with a comment beside it: Klaviyo injects that one, so set
  it once per template, not once per campaign.

The series labels are fixed too, because they are what makes the series a
series: `SPOTLIGHT ON:`, `FEATURED ARTIST:`, `MEET THE ARTIST`, `More To Like:`,
`Previous Drops:`.

Everything that actually moved between sends is a placeholder — including
`accent_color`, which is genuinely different almost every time (green `#3fbf6f`
for most category sends, orange `#ff8a1f` for Doze Green, yellow `#ffcf1f` for
the tee drops). It drives the eyebrow text, the rules under
the headings, the section markers and the badge chips, so one hex in the sheet
re-colours the whole email.

The mid-email section headings in the category template moved too, so they are
placeholders rather than fixtures: `Most Popular` / `THE ICONS` on most sends
became `New Titles` / `LATEST DROPS` on 24 July, and `ONE OF A KIND` became
`THE ESSENTIAL`.

### 01-category-spotlight (49)
`accent_color` `headline` `intro` `hero_cta_url` `hero_cta_text`
`section_1_label` `section_1_headline` `section_2_label` `section_2_headline`
`mid_cta_url` `mid_cta_text` `footer_cta_url` `footer_cta_text`, plus
`product_1…4_{image,title,price,url,badge}` and
`product_5…8_{image,title,price,url}`.

### 02-artist-spotlight (32)
`accent_color` `artist_name` `artist_image` `bio_paragraph_1…3` `feature_label`
`cta_url` `cta_text` `footer_cta_url` `footer_cta_text`, plus
`product_1_{image,title,description,price,url}` for the featured piece and
`product_5…8_{image,title,price,url}` for the grid.

### 03-tee-of-the-month (32)
`accent_color` `announcement_line_1` `announcement_line_2`
`product_1_{image,title,description,url}` `member_price` `retail_price`
`artist_name` `artist_image` `artist_bio` `cta_url` `cta_text`
`footer_cta_url` `footer_cta_text`, plus `product_5…8_{image,title,price,url}`.

Product numbering is shared across all three on purpose: 1–4 are the featured
items and 5–8 are always the four-up grid that closes the email. That is what
lets one sheet feed all three templates.

## Badges

The chip carries its own `line-height`, which is load-bearing rather than
decorative. The cell around it is `line-height:0` so an empty badge leaves no
gap at all; without a line-height of its own the chip's text inherited that
zero, sat in a line box with no height, and the padding had nothing to wrap —
the letters ran flush to the top and bottom of the colour. `mso-line-height-rule:exactly`
is there so Outlook honours it too.

Only the category template has badge chips (`Best-Seller`, `Top Pick`, `Local
Favorite`, `MoG Exclusive`), and only on the four featured tiles. The four-up
grid never carried one in two months of sends, and neither did the tee hero, so
those slots were dropped rather than carried as permanently empty fields.

## Section rules and dots

The little accent dash beside a section label, and the round dot beside MEET
THE ARTIST, are each a swatch inside a nested table rather than the row cell
itself. A table cell cannot be shorter than its row, so a 3px cell sitting
beside a 13px label stretched to the label's height and rendered as a block
instead of a rule -- and the dot came out an oval. Nesting gives the swatch a
row of its own to set the height of.

## Why the tiles line up

Two tiles side by side have to agree on where the price and Shop link sit, and
neither the badge nor the title is a fixed height. Two things hold that
together:

- **The badge band keeps its height whether or not there is a chip in it** —
  36px, with the chip bottom-aligned inside. Hiding an empty badge without
  reserving its space let the tile beside it ride up.
- **The title cell absorbs the slack.** Tiles in a row are equal height because
  they are cells of one row; the inner table fills its cell and the title row
  takes whatever is left, which pins the price row to the bottom of both. A
  reserved number of lines was tried first and only moved the breaking point:
  a title one line longer than the reserve broke it again, and the sheet has
  titles running to four lines.

The tile cell carries `height:1px` purely so those percentage heights have
something definite to resolve against; a table cell still grows to its content.
The mobile rule sets it back to `auto`, because once a tile is a stacked block
that 1px would be a real one.

Outlook's rendering engine treats percentage heights on tables loosely. The
badge band is an explicit pixel height and holds there; the title balancing is
best-effort, and where it does not apply the layout falls back to flowing
naturally rather than breaking.

## Blank cells

Several slots here are genuinely optional: a category send might badge two of
its four featured items, an artist bio might run to one paragraph rather than
three, and the Shirt King Phade send only had three products for a four-up grid.

With **Highlight gaps** on, an empty cell shows its `{{ placeholder }}` so the
hole is obvious. Switch it off and the empty slot simply is not there — the bio
runs two paragraphs, the badge chip does not appear. Either way the coverage
panel names every blank, so nothing is hidden from review.

## Images

Every image URL in the sheet is a live one — `cdn.shopify.com` for products,
Klaviyo's `d3k81ch9hvuctc.cloudfront.net` for artist portraits, and
`museumofgraffiti.com` for the two logos. They are already public and already
being served to real inboxes, so nothing needs re-hosting to preview.

Two things to watch before a real send:

- **One product image is a `.webp`** (`graffitialphai-01.webp`, Graffiti
  Alphabets). Outlook on Windows cannot display WebP and will show a gap. Swap
  it for the JPEG or PNG of the same shot.
- **Product links point at `museumofgraffiti.myshopify.com`**, because that is
  what Klaviyo's catalog resolves to. They redirect, but the customer-facing
  domain is better in a send — a find-and-replace on the sheet fixes all of
  them at once. Refilling a tile from the product picker (Settings →
  Integrations) also fixes it, since that writes `museumofgraffiti.com` URLs.
