# Burju Shoes email templates

Six templates covering every September send, built from the Burju design system.

| File | Name to paste | Placeholders | Use for |
| --- | --- | --- | --- |
| `01-hero-editorial.html` | `Hero Editorial` | 32 | single-style spotlights, hero launches |
| `02-split-story.html` | `Split Story` | 41 | guides, Truly Nude™, fit and inclusivity |
| `03-ranked-list.html` | `Ranked List` | 38 | top fives, best sellers, month-end roundups |
| `04-palette-block.html` | `Palette Block` | 53 | any multi-colour drop |
| `05-campaign-chapter.html` | `Campaign Chapter` | 38 | Back To…, themed weekly editorial |
| `06-category-lookbook.html` | `Category Lookbook` | 50 | boots, thigh highs, two-or-three-style categories |

## They are generated, not hand-written

`build.py` emits all six. The chrome is the reason: promo bar, wordmark, nav,
footer and the two button styles are identical in every send, and only the
middle stack changes. Six hand-maintained copies of that frame would have
drifted within a month. Edit `build.py` and re-run it; do not edit the HTML.

Ink `#111111` on paper `#faf9f6`, burgundy `#590529` as the accent. Red
`#c8102e` is deliberately absent — it is reserved for sale sends and September
has none. Playfair Display for headlines, DM Sans for everything else.

## Nine product slots cover all six

`product_1` through `product_9`, each with image, title, price, url and note.
F's colourway rail is the widest at nine; D needs six across three colour
bands; A only needs three. `product_1_badge` and `product_2_badge` exist for
F's two flag labels and nothing else uses them.

`product_N_note` does different work per template — a colourway in A, the
one-line reason in C, a descriptor in F — which is what lets one column serve
six layouts instead of three.

## Two cells that unpack

The sheet would carry twenty headings for two ideas otherwise:

- **`swatches`** — `#f4dcc8, #e3bfa1, …` becomes `swatch_1` … `swatch_8`
- **`band_1` / `band_2` / `band_3`** — `Name | Count | Note | #hex` becomes
  `band_N_name`, `band_N_count`, `band_N_note`, `band_N_color`

The app expands them before rendering, so the templates stay flat. Writing a
field out in full still overrides the packed cell.

## The optional swatch row

Template B's swatch row omits itself when the send has no colour range. The
hex sits inside the cell as its own invisible content (`font-size:0`), which
is what makes `:empty` able to see it — an unset `background` is not something
a selector can match, but a cell with no text is. Measured: 46px with a range,
0px without.

## Tile images sit in fixed bands

Same reasoning as the Museum templates. Without a band, a shorter product shot
pulls its title up out of line with the tile beside it. The mobile rule
releases the band, since stacked tiles have nothing left to line up against.
