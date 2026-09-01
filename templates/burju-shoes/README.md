# Burju Shoes email templates

Six templates covering every September send, built from the Burju design system.

| File | Name to paste | Placeholders | Use for |
| --- | --- | --- | --- |
| `01-hero-editorial.html` | `Hero Editorial` | 31 | single-style spotlights, hero launches |
| `02-split-story.html` | `Split Story` | 41 | guides, Truly Nude™, fit and inclusivity |
| `03-ranked-list.html` | `Ranked List` | 38 | top fives, best sellers, month-end roundups |
| `04-palette-block.html` | `Palette Block` | 43 | any multi-colour drop |
| `05-campaign-chapter.html` | `Campaign Chapter` | 27 | Back To…, themed weekly editorial |
| `06-category-lookbook.html` | `Category Lookbook` | 44 | boots, thigh highs, two-or-three-style categories |

## They are generated, not hand-written

`build.py` emits all six. The chrome is the reason: promo bar, logo, nav,
footer and the two button styles are identical in every send, and only the
middle stack changes. Six hand-maintained copies of that frame would have
drifted within a month. Edit `build.py` and re-run it; do not edit the HTML.

`build.py` exits non-zero if any file loses a chrome element or unbalances a
tag, so a drifting frame fails the build rather than shipping.

## The chrome, exactly

- **Announcement bar** — burgundy `#590529`, white 10px caps at 0.22em, on
  every one of the six. Template D differs only in what the bar *says*, which
  is `promo_line` in the sheet, not a variant in the template.
- **Masthead** — white, the logo at 26px, then the five nav items, then one
  hairline under the pair.
- **Footer** — light burgundy `#e9d5de` under a 2px burgundy rule: the logo at
  22px and four links. Nothing else. No address block, no repeated shipping
  line, no unsubscribe sentence — Klaviyo appends its own compliance block
  below, and the design leaves it that room.
- **Buttons** — solid burgundy on paper, outlined white on the ink band. No
  third variant.

The logo is Burju's own black wordmark, served from the Klaviyo library. The
design bundles it as WebP, which Outlook cannot render, so the template points
at the hosted PNG instead. Height is set and width left automatic, so the
wordmark keeps its proportions whatever file sits behind the URL.

Ink `#111111` on paper `#faf9f6`, burgundy `#590529` as the accent, blush
`#e9d5de` as its light counterpart. Red `#c8102e` is deliberately absent — it
is reserved for sale sends and September has none. Playfair Display 700 caps
for headlines, DM Sans for everything else.

## Eight product slots cover all six

`product_1` through `product_8`, each with image, title, price, url and note.
`product_1_badge` and `product_2_badge` exist for F's two flag labels and
nothing else uses them.

Each template renders a **fixed** number of them, not a maximum:

| Template | Products |
| --- | --- |
| A Hero Editorial | 3 |
| B Split Story | 4 |
| C Ranked List | 5 |
| D Palette Block | 6, two per colour band |
| E Campaign Chapter | 5, plus the burgundy count tile |
| F Category Lookbook | 2 tiles + the break + 6 rail |

A row that supplies more does not get a longer list — the extra products are
dropped in silence. `content-sheets/build-burju-september.py` refuses to build
such a row, because that silence is how a six-item ranking reached a template
headlined "The Five That Never Leave", and how three chapter sends each carried
a sixth product that never rendered.

A row that supplies fewer is worse: an empty slot still draws its numeral and
an empty crop. Nothing collapses a product row, so the counts above are the
counts to fill.

`product_N_note` does different work per template — a colourway in A, the
one-line reason in C, a descriptor in F — which is what lets one column serve
six layouts instead of three.

F's full-bleed break is `break_image` / `break_title` / `break_note` /
`break_url` rather than a ninth product: nine tiles do not fit in eight, and a
campaign frame is not a catalogue tile anyway — it wants its own crop and its
own line of copy.

## Two cells that unpack

The sheet would carry twenty headings for two ideas otherwise:

- **`swatches`** — `#f4dcc8, #e3bfa1, …` becomes `swatch_1` … `swatch_8`
- **`band_1` / `band_2` / `band_3`** — `Name | Count | Note | #hex | #tint`
  becomes `band_N_name`, `band_N_count`, `band_N_note`, `band_N_color`,
  `band_N_tint`

The tint is the pale wash the band's products sit on; left off, they sit on
paper. The app expands both cells before rendering, so the templates stay flat.
Writing a field out in full still overrides the packed cell.

## The optional swatch row

Template B's swatch row omits itself when the send has no colour range. The
hex sits inside the cell as its own invisible content (`font-size:0`), which
is what makes `:empty` able to see it — an unset `background` is not something
a selector can match, but a cell with no text is.

The design letters each shade, but those labels are its own placeholder art and
the shades come from the sheet: white lettering vanishes on a pale nude and
black vanishes on the darkest, and no one label colour survives both. The band
carries the range on its own.

## Heroes fill the width; tiles sit in fixed bands

Two different jobs, two different rules.

A **hero** — the full-bleed image in A, D, E and F, and the half-width one in
A's detail split and B's story split — is the width of its column at whatever
ratio the photograph is. No band, no letterbox, no ground colour behind it.
Constraining a hero either crops the frame or floats it in a grey box, and
these are meant to be cinematic.

A **product tile** keeps its fixed band, because four of them have to line up:
without one, a shorter shot pulls its title out of line with the tile beside
it. The mobile rule releases the band, since stacked tiles have nothing left to
line up against. Inside the band the picture still keeps its own ratio — the
band crops the space, never the photograph.
