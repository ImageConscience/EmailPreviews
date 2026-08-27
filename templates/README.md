# Safety Facility Services email templates

Three campaign templates converted from the design canvas into email-safe HTML,
ready to paste into Email Previews as templates.

| File | Use | Placeholders |
| --- | --- | --- |
| `01-seasonal.html` | Seasonal / rotating topic (HVAC, snow, storm prep) | 23 |
| `02-core-service.html` | Core service focus (janitorial, repairs, security) | 33 |
| `03-pest-control.html` | P1 Pest Solutions, black-and-red pest branding | 21 |

## What changed from the design canvas

The canvas document was a **design mockup**, not sendable email. It used custom
elements (`<x-dc>`, `<image-slot>`, `<sc-if>`), React-style camelCase style props
that browsers ignore, CSS flex/grid layout, and inline SVG. All of that was
rebuilt as table-based HTML with inline styles.

- **QualityPro removed from templates 1 and 2.** Both the badge image and the
  "QualityPro accredited pest division" phrase in the footer credentials line —
  it is a pest-management accreditation and belongs only on the pest template,
  where it is kept.
- **Layout is tables, not flex.** Outlook on Windows ignores flex and grid
  entirely, which would have collapsed every multi-column row into a stack.
- **The 8 pest icons were inline SVG** — Gmail strips SVG and Outlook will not
  render it — so they are now hosted PNGs.
- **WebP images were re-encoded** to JPEG/PNG. Outlook on Windows cannot display
  WebP, so the hero photos and the P1 logo would have been blank.
- **The subject-line preview bar was dropped.** It was canvas annotation
  showing the subject, not part of the email. The subjects were:
  - Seasonal: *Your HVAC is working harder than it has all year*
  - Core service: *Nobody notices clean*
  - Pest: *The pallet came in. So did the cockroaches.*
- **The hero headline sits in a band beneath the photo**, rather than overlaid on
  it. Text over a background image needs VML to work in Outlook and is only ever
  as legible as the photo behind it. The band is identical everywhere and always
  readable. Say the word if you would rather have the overlay back.
- **The QualityPro badge sits on a white chip** in the pest footer — it is dark
  artwork on transparency and was invisible against the black background.
- **A mobile overflow bug was fixed**: cells that go full width also carry
  padding, which without `box-sizing:border-box` pushed them past the table edge
  and cut off headline text on phones.

## Images

Every image is referenced from:

```
https://emailpreviews-production.up.railway.app/brand/
```

Those files live in `public/brand/` in this repo, so they are served by the app
itself and are live as soon as it deploys. To move them to a CDN or to Constant
Contact's image library, find-and-replace that one base URL across the three
files.

`hero_image` is a placeholder — it changes per campaign. The three
`sample-hero-*.jpg` files are the mockup photos, useful as defaults while
testing.

## Choosing the template per row

The content sheet carries a `template` column naming which of these each row
uses — `Seasonal`, `Core Service` or `Pest Control`. Name the templates that way
when you paste them in and rows will select themselves in the preview. Matching
ignores case and punctuation, so `01 Seasonal` still matches a sheet that says
`Seasonal`.

## What is a placeholder, and what is not

Only the parts that genuinely change from send to send are placeholders. Two
regions are fixed in the template itself:

- **The header bars** — logo, navigation, and the "View as Webpage" strip.
- **Everything from the first dark band below the hero downward** — the Our
  Services block, the closing call to action, the credentials line, the address
  and the footer links.

The dark band itself splits by what it holds. The core template's is company
facts (CIMS-GB, 98%+ retention, 30+ years) and is fixed. The seasonal "Good to
know" and the pest "Field note" carry advice tied to that particular send, so
they stay as `note_label` / `note_body`.

That leaves the hero, the body copy and the section immediately under it as the
per-campaign content, which is what the sheet carries.

Site links are hardcoded to `safetyfacilityservices.com` and, for the pest
template, `p1pestsolutions.com`. The four links Constant Contact injects
(view-as-webpage, unsubscribe, update profile, data notice) are `href="#"` with
a comment beside them — set those once per template, not once per campaign.

### 01-seasonal (15)
`hero_image` `hero_alt` `eyebrow` `headline` `body_paragraph_1`
`body_paragraph_2` `cta_url` `cta_text` `tip_label` `tip_headline` `tip_body`
`tip_link_url` `tip_link_text` `note_label` `note_body`

### 02-core-service (15)
`eyebrow` `headline` `hero_image` `hero_alt` `body_paragraph_1`
`body_paragraph_2` `points_label` `point_1_title` `point_1_body`
`point_2_title` `point_2_body` `point_3_title` `point_3_body` `aside_label`
`aside_body`

### 03-pest-control (17)
`issue_date` `hero_image` `hero_alt` `headline` `body_paragraph_1`
`body_paragraph_2` `cta_url` `cta_text` `points_label` `point_1_title`
`point_1_body` `point_2_title` `point_2_body` `point_3_title` `point_3_body`
`note_label` `note_body`

Names are matched case- and punctuation-insensitively, so a spreadsheet column
called `Body Paragraph 1` fills `{{ body_paragraph_1 }}` without renaming.
Values are HTML-escaped; use `{{{ name }}}` for a cell containing markup you
want rendered.

## Fonts

The brand face is Barlow, linked from Google Fonts. Most email clients ignore
webfonts, so the fallback stack (Arial / Arial Narrow) is what the majority of
recipients see — the templates were checked against that fallback, not just
against Barlow.
