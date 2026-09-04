#!/usr/bin/env python3
"""
Build the six Burju Shoes email templates.

They are generated rather than hand-written because the chrome is the point:
the promo bar, logo, nav, footer and the two button styles are identical in
every send, and the design is explicit that only the middle stack changes. Six
hand-maintained copies of that frame would drift within a month. Here the frame
exists once and each template is only its own middle.

Every value below is lifted from the Burju design document rather than chosen
here -- the colours, the tracking, the paddings, the two-line headline breaks.
Where email cannot do what the design does (flex, grid, overlays, `gap`), the
translation is a table with the same measurements, not a redesign.

One deliberate departure: the design is a canvas at 640px because that is a
comfortable width to look at side by side. Email sends at 600px, so the inner
paddings hold and the tile widths are recomputed for the narrower container.
"""

import re
from pathlib import Path

OUT = Path(__file__).parent

# --- palette ---------------------------------------------------------------
# Burgundy is the accent and appears in the promo bar, the solid button, the
# footer rule and the eyebrows. Red (#c8102e) is deliberately absent -- the
# design reserves it for sale sends, and September has none.
INK        = "#111111"
PAPER      = "#faf9f6"
WHITE      = "#ffffff"
BURGUNDY   = "#590529"
BLUSH      = "#e9d5de"   # light burgundy: footer ground, subheads, C numerals
WINE       = "#8a2a52"   # the lighter burgundy, for accents that sit on ink
MIST       = "#f2f1ee"   # image placeholder ground
CLOUD      = "#e6e6e6"   # hairline
HAIRLINE   = "#d8d5ce"   # the card's own border
SMOKE      = "#7a7a7a"
GRAPHITE   = "#4a4a4a"
SLATE      = "#2a2a2a"   # body copy in the wide centred paragraphs
MUTED      = "#b5b5b5"   # secondary text reversed out on ink

DISPLAY = "'Playfair Display',Didot,'Bodoni 72',Georgia,serif"
BODY    = "'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif"

# The logo, hosted rather than bundled: the design carries a WebP asset, which
# Outlook cannot render. This is Burju's own black wordmark, already in the
# Klaviyo library and therefore reachable from a sent email. Height is set and
# width left automatic, exactly as the design does, so the wordmark keeps its
# own proportions whatever file ends up behind the URL.
LOGO = "https://d3k81ch9hvuctc.cloudfront.net/company/HAJSMj/images/acd60ae3-534b-445a-8b06-beca7d64315f.png"

W       = 600          # container
PAD     = 40           # side padding
INNER   = W - PAD * 2  # 520 of usable width


def head(title: str) -> str:
    return f"""<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>Burju Shoes &mdash; {title}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body {{ margin:0; padding:0; background:#e9e7e2; -webkit-text-size-adjust:100%; }}
  table {{ border-collapse:collapse; }}
  img {{ border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }}
  a {{ text-decoration:none; }}
  /* An empty optional field should leave nothing behind, not a gap. */
  .badge:empty {{ display:none !important; }}
  p:empty {{ display:none !important; margin:0 !important; }}
  .swatch:empty {{ display:none !important; }}
  @media only screen and (max-width:620px) {{
    /* These cells go full width and also carry padding -- without border-box
       the padding is added on top and the cell overflows the table. */
    td {{ box-sizing:border-box !important; }}
    .wrap {{ width:100% !important; }}
    .pad  {{ padding-left:22px !important; padding-right:22px !important; }}
    .dsp  {{ font-size:34px !important; line-height:34px !important; }}
    .dsp-sm {{ font-size:24px !important; line-height:28px !important; }}
    .col  {{ display:block !important; width:100% !important; height:auto !important; }}
    .gut  {{ display:none !important; }}
    .colgap {{ padding-bottom:24px !important; }}
    /* Stacked, the tiles have nothing left to line up against, and holding a
       fixed band across a full-width column would letterbox every picture. */
    .imgband {{ height:auto !important; }}
    .imgband img {{ max-height:none !important; width:100% !important; }}
    .numcol {{ width:52px !important; }}
    /* The colour panel in D is a fixed 180px beside its products; stacked it
       becomes a full-width header for the row it introduces. */
    .bandcol {{ width:100% !important; display:block !important; }}
  }}
</style>
</head>
<body style="margin:0; padding:0; background:#e9e7e2;">
<div style="display:none; font-size:0; line-height:0; max-height:0; overflow:hidden;">{{{{ preheader }}}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9e7e2;">
<tr><td align="center" style="padding:0;">
<table role="presentation" class="wrap" width="{W}" cellpadding="0" cellspacing="0" border="0" style="width:{W}px; max-width:{W}px; background:{PAPER}; border:1px solid {HAIRLINE};">
"""


def promo() -> str:
    """The announcement bar: burgundy on every send, without exception.

    Template D differs only in what it says -- a campaign line rather than the
    shipping line -- which is a value in the sheet, not a variant here.
    """
    return f"""
  <!-- PERMANENT: burgundy announcement bar. Identical on every send. -->
  <tr><td align="center" style="background:{BURGUNDY}; padding:11px 16px;">
    <p style="margin:0; font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.2px; text-transform:uppercase; color:{WHITE};">{{{{ promo_line }}}}</p>
  </td></tr>
"""


NAV_ITEMS = [("New", "new-arrivals"), ("Heels", "heels"), ("Boots", "boots"),
             ("Truly Nude&trade;", "truly-nude"), ("Sale", "sale")]

FOOTER_ITEMS = [("New Arrivals", "new-arrivals"), ("Truly Nude&trade;", "truly-nude"),
                ("Wide Fit", "wide-fit"), ("Bridal", "bridal")]


def _links(items: list[tuple[str, str]], color: str, gap: int) -> str:
    """A centred row of tracked caps links, with a spacer cell between each."""
    cells = []
    for i, (label, handle) in enumerate(items):
        div = f'<td width="{gap}" style="width:{gap}px; font-size:0; line-height:0;">&nbsp;</td>' if i else ""
        cells.append(f"""{div}<td align="center" style="font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:1.6px; text-transform:uppercase;"><a href="https://burjushoes.com/collections/{handle}" style="color:{color}; text-decoration:none;">{label}</a></td>""")
    return "".join(cells)


def masthead() -> str:
    """White band: the logo, then the nav, then a hairline. One block, because
    the design draws one border under the pair rather than under each."""
    return f"""
  <!-- PERMANENT: logo and nav on white. Identical on every send. -->
  <tr><td align="center" style="background:{WHITE}; padding:22px 16px 16px; border-bottom:1px solid {CLOUD};">
    <a href="https://burjushoes.com" style="text-decoration:none;"><img src="{LOGO}" alt="Burju" height="26" style="height:26px; width:auto; display:block; margin:0 auto; border:0;"></a>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto 0;"><tr>{_links(NAV_ITEMS, INK, 22)}</tr></table>
  </td></tr>
"""


def footer() -> str:
    """Light burgundy, a burgundy rule above it, the logo and four links.

    Nothing else -- no address block, no repeated shipping line, no unsubscribe
    sentence. Klaviyo appends its own compliance footer beneath this one, and
    the design leaves that space for it.
    """
    return f"""
  <!-- PERMANENT: footer. Klaviyo appends the compliance block below this. -->
  <tr><td align="center" style="background:{BLUSH}; padding:34px 36px; border-top:2px solid {BURGUNDY};">
    <a href="https://burjushoes.com" style="text-decoration:none;"><img src="{LOGO}" alt="Burju" height="22" style="height:22px; width:auto; display:block; margin:0 auto; border:0;"></a>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 0;"><tr>{_links(FOOTER_ITEMS, BURGUNDY, 20)}</tr></table>
  </td></tr>
"""


def button_solid(url: str, text: str) -> str:
    """Solid burgundy. The only button that appears on paper."""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td align="center" style="background:{BURGUNDY};"><a href="{url}" style="color:{WHITE}; text-decoration:none; display:inline-block; padding:15px 38px; font-family:{BODY}; font-weight:600; font-size:11px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.4px; text-transform:uppercase;">{text}</a></td>
    </tr></table>"""


def button_outline(url: str, text: str) -> str:
    """Outlined white. The only button that appears on the ink band."""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td align="center" style="border:2px solid {WHITE};"><a href="{url}" style="color:{WHITE}; text-decoration:none; display:inline-block; padding:13px 33px; font-family:{BODY}; font-weight:600; font-size:11px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.4px; text-transform:uppercase;">{text}</a></td>
    </tr></table>"""


def eyebrow(color: str = BURGUNDY, gap: str = "0 0 16px") -> str:
    """Tracked caps above a headline. Burgundy on paper, wine on ink."""
    return f"""<p style="margin:{gap}; font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.4px; text-transform:uppercase; color:{color};">{{{{ eyebrow }}}}</p>"""


def headline(color: str, size: int) -> str:
    """Playfair caps, set tight. Two fields so the break is placed rather than
    left to wrapping -- every headline in the design breaks deliberately."""
    return f"""<h1 class="dsp" style="margin:0; font-family:{DISPLAY}; font-weight:700; font-size:{size}px; mso-line-height-rule:exactly; line-height:{round(size * 0.98)}px; letter-spacing:-{max(1, round(size * 0.02))}px; text-transform:uppercase; color:{color};">{{{{ headline_1 }}}}<br>{{{{ headline_2 }}}}</h1>"""


def subhead(color: str = BLUSH) -> str:
    """The dash-framed subhead: italic, tracked, uppercase. The dashes are
    fixtures of the design, not something a send supplies."""
    return f"""<p style="margin:18px 0 0; font-family:{BODY}; font-weight:500; font-style:italic; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:2px; text-transform:uppercase; color:{color};">&ndash;&nbsp;{{{{ subhead }}}}&nbsp;&ndash;</p>"""


def image_band(field_img: str, field_alt: str, field_url: str,
               border_bottom: bool = False) -> str:
    """Full-bleed hero: the width of the email, at whatever ratio the picture is.

    No band, no letterboxing and no ground colour behind it. A fixed height is
    the right call for a product tile, where four of them have to line up, but a
    hero has nothing to line up against -- constraining it either crops the
    frame or floats it in a grey box, and these are meant to be cinematic. The
    height simply follows the file.
    """
    edge = f" border-bottom:1px solid {CLOUD};" if border_bottom else ""
    return f"""
  <tr><td align="center" style="padding:0; font-size:0; line-height:0;{edge}">
    <a href="{{{{ {field_url} }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ {field_img} }}}}" alt="{{{{ {field_alt} }}}}" width="{W}" style="width:100%; max-width:100%; height:auto; display:block; border:0;"></a>
  </td></tr>
"""


def section_head(count_field: str = "section_count", pad: str = "34px 40px 18px") -> str:
    """Label left, count right. No rule beneath it -- the tiles below carry
    their own edges, and a second line here reads as a divider that isn't one."""
    return f"""
  <tr><td class="pad" style="background:{PAPER}; padding:{pad};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.2px; text-transform:uppercase; color:{INK};">{{{{ section_label }}}}</td>
      <td align="right" style="font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:15px; color:{SMOKE};">{{{{ {count_field} }}}}</td>
    </tr></table>
  </td></tr>
"""


def tile(n: int, width: int, band: int, show_price: bool = True,
         show_note: bool = True, fg: str = INK, sub: str = SMOKE,
         ground: str = MIST, edge: str = CLOUD) -> str:
    """One product cell: picture in a fixed band, name, optional note, price."""
    note = f"""
        <tr><td style="padding:2px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:16px; color:{sub};">{{{{ product_{n}_note }}}}</p></td></tr>""" if show_note else ""
    price = f"""
        <tr><td style="padding:2px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:500; font-size:12px; mso-line-height-rule:exactly; line-height:17px; color:{fg};">{{{{ product_{n}_price }}}}</p></td></tr>""" if show_price else ""
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;">
        <tr><td class="imgband" height="{band}" align="center" style="height:{band}px; background:{ground}; border:1px solid {edge}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
          <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="{width}" style="width:auto; max-width:100%; max-height:{band}px; display:inline-block; border:0;"></a>
        </td></tr>
        <tr><td style="height:100%; padding:9px 0 0; vertical-align:top;"><a href="{{{{ product_{n}_url }}}}" style="color:{fg}; text-decoration:none; display:block; font-family:{BODY}; font-weight:500; font-size:12px; mso-line-height-rule:exactly; line-height:17px;">{{{{ product_{n}_title }}}}</a></td></tr>{note}{price}
      </table>"""


def row(slots: list[int], width: int, gutter: int, pad: str = "0 40px 0", **kw) -> str:
    """A row of equal tiles. `height:1px` lets the inner percentage heights
    resolve; a table cell still grows to its content."""
    cells = []
    for i, n in enumerate(slots):
        gap = f'<td class="gut" width="{gutter}" style="width:{gutter}px; font-size:0; line-height:0;">&nbsp;</td>' if i else ""
        cls = "col colgap" if i < len(slots) - 1 else "col"
        cells.append(f"""{gap}<td class="{cls}" width="{width}" valign="top" style="width:{width}px; height:1px;">{tile(n, width, **kw)}</td>""")
    return f"""
  <tr><td class="pad" style="background:{PAPER}; padding:{pad};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table>
  </td></tr>
"""


def spacer(h: int, bg: str = PAPER) -> str:
    return f"""  <tr><td style="background:{bg}; height:{h}px; font-size:0; mso-line-height-rule:exactly; line-height:{h}px;">&nbsp;</td></tr>\n"""


TAIL = """
</table>
</td></tr>
</table>
</body>
</html>
"""


def ink_band(size: int, eyebrow_color: str | None = None, with_subhead: bool = True,
             with_cta: bool = True, pad: str = "46px 40px") -> str:
    """Headline reversed out on ink, centred, with the outlined button.

    The eyebrow is optional because only C opens with one -- A, D and E go
    straight to the headline.
    """
    parts = []
    if eyebrow_color:
        parts.append(eyebrow(eyebrow_color, "0 0 16px"))
    parts.append(headline(WHITE, size))
    if with_subhead:
        parts.append(subhead())
    if with_cta:
        parts.append(f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 0;"><tr><td align="center">{button_outline("{{ cta_url }}", "{{ cta_text }}")}</td></tr></table>""")
    return f"""
  <tr><td class="pad" align="center" style="background:{INK}; padding:{pad}; text-align:center;">
    {"".join(parts)}
  </td></tr>
"""


def paper_head(size: int, pad: str = "46px 40px 34px") -> str:
    """Headline on paper, centred -- templates B and F open this way. The intro
    is held narrower than the column, as the design does, so it reads as a
    stand-first rather than a full-width paragraph."""
    return f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:{pad}; text-align:center;">
    {eyebrow(BURGUNDY, "0 0 14px")}
    {headline(INK, size)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 0;"><tr><td align="center" style="max-width:430px;">
      <p style="margin:0; font-family:{BODY}; font-weight:400; font-size:14px; mso-line-height-rule:exactly; line-height:25px; color:{GRAPHITE};">{{{{ intro }}}}</p>
    </td></tr></table>
  </td></tr>
"""


def centred_copy(field: str, pad: str) -> str:
    """The one wide paragraph a template is allowed. 15px on 27, near-black."""
    return f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:{pad}; text-align:center;">
    <p style="margin:0; font-family:{BODY}; font-weight:400; font-size:15px; mso-line-height-rule:exactly; line-height:27px; color:{SLATE};">{{{{ {field} }}}}</p>
  </td></tr>
"""


# ---------------------------------------------------------------------------
# A -- Hero Editorial
# ---------------------------------------------------------------------------
def template_a() -> str:
    return (
        head("Hero Editorial") + promo() + masthead() +
        ink_band(52) +
        image_band("hero_image", "headline_1", "cta_url") +
        centred_copy("intro", "40px 56px 32px") +
        section_head(pad="0 40px 18px") +
        row([1, 2, 3], 160, 16, band=200, pad="0 40px 40px") +
        f"""
  <!-- The detail split: a crop of the construction beside the note that
       explains it. This is what makes A editorial rather than a product grid. -->
  <tr><td style="background:{PAPER}; padding:0; border-top:1px solid {CLOUD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col" width="300" valign="middle" style="width:300px; padding:0; font-size:0; line-height:0; border-right:1px solid {CLOUD};">
        <img src="{{{{ detail_image }}}}" alt="{{{{ detail_title }}}}" width="300" style="width:100%; max-width:100%; height:auto; display:block; border:0;">
      </td>
      <td class="col" width="238" valign="middle" style="width:238px; padding:30px;">
        <p style="margin:0 0 12px; font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:2.4px; text-transform:uppercase; color:{BURGUNDY};">{{{{ detail_title }}}}</p>
        <p style="margin:0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:22px; color:{GRAPHITE};">{{{{ detail_body }}}}</p>
        <p style="margin:16px 0 0; font-family:{BODY}; font-weight:600; font-size:11px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:1.6px; text-transform:uppercase;"><a href="{{{{ secondary_url }}}}" style="color:{INK}; text-decoration:none; border-bottom:1px solid {INK}; padding-bottom:3px;">{{{{ secondary_text }}}}</a></p>
      </td>
    </tr></table>
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# B -- Split Story
# ---------------------------------------------------------------------------
def template_b() -> str:
    # The hex is the cell's own text, and nothing wraps it. That is the whole
    # trick: `:empty` cannot see an unset `background`, but it can see a cell
    # with no content -- and "no content" means no child nodes at all, so a
    # <span> around the value defeats it as surely as visible text would.
    # font-size:0 and a transparent colour keep the hex from printing.
    # The hairline rides on the swatch cells rather than the row that holds
    # them, so it collapses with them instead of leaving a rule behind.
    # The design letters each shade, but those labels are its own placeholder
    # art, and the shades themselves come from the sheet -- white lettering
    # vanishes on a pale nude and black vanishes on the darkest. The band of
    # colour carries the range on its own.
    swatches = "".join(
        f"""<td width="74" style="width:74px; padding:0; font-size:0; line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="swatch" height="84" style="height:84px; background:{{{{ swatch_{i} }}}}; border-top:1px solid {CLOUD}; font-size:0; mso-line-height-rule:exactly; line-height:0; color:transparent;">{{{{ swatch_{i} }}}}</td></tr></table></td>"""
        for i in range(1, 9))
    points = "".join(f"""
          <tr><td style="padding:{'0' if i == 1 else '24px'} 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td class="numcol" width="36" valign="top" style="width:36px; font-family:{DISPLAY}; font-weight:700; font-size:22px; mso-line-height-rule:exactly; line-height:22px; color:{WINE};">0{i}</td>
              <td valign="top">
                <p style="margin:0 0 5px; font-family:{BODY}; font-weight:600; font-size:12px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.2px; text-transform:uppercase; color:{WHITE};">{{{{ point_{i}_title }}}}</p>
                <p style="margin:0; font-family:{BODY}; font-weight:400; font-size:12px; mso-line-height-rule:exactly; line-height:19px; color:{MUTED};">{{{{ point_{i}_body }}}}</p>
              </td>
            </tr></table>
          </td></tr>""" for i in (1, 2, 3))

    return (
        head("Split Story") + promo() + masthead() + paper_head(46) +
        f"""
  <!-- Optional shade row. Omitted by leaving the cells empty -- the .swatch
       rule collapses an empty block rather than printing eight black squares. -->
  <tr><td style="background:{PAPER}; padding:0; font-size:0; line-height:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{swatches}</tr></table>
  </td></tr>

  <!-- The split: picture one side, three numbered points on ink the other. -->
  <tr><td style="background:{PAPER}; padding:0; border-top:1px solid {CLOUD}; border-bottom:1px solid {CLOUD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <!-- Half-width hero, still a hero: it fills its column at its own ratio
           rather than sitting inside a 340px letterbox. -->
      <td class="col" width="320" valign="top" style="width:320px; padding:0; font-size:0; line-height:0; border-right:1px solid {CLOUD};">
        <img src="{{{{ hero_image }}}}" alt="{{{{ headline_1 }}}}" width="320" style="width:100%; max-width:100%; height:auto; display:block; border:0;">
      </td>
      <td class="col" width="218" valign="middle" style="width:218px; background:{INK}; padding:34px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{points}
        </table>
      </td>
    </tr></table>
  </td></tr>
""" +
        section_head(pad="38px 40px 20px") +
        row([1, 2, 3, 4], 118, 16, band=150, show_note=False) +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:34px 40px 44px;">
    {button_solid("{{ cta_url }}", "{{ cta_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# C -- The Ranked List
# ---------------------------------------------------------------------------
def template_c() -> str:
    # Six rows, of which the design's five are the common case. The sixth is a
    # real extra rather than dead markup: an unused row carries `display:none`
    # from `product_N_hidden`, so it leaves nothing behind -- no numeral, no
    # empty crop, not even its rule. The switch is inline rather than a class
    # in the <style> block because Outlook honours the one and not the other.
    #
    # The rule sits on the row's own top edge, so a hidden row takes its
    # separator with it and the rows that remain stay evenly divided.
    rows = "".join(f"""
  <tr style="{{{{ product_{n}_hidden }}}}"><td class="pad" style="background:{PAPER}; padding:26px 40px;{'' if n == 1 else f' border-top:1px solid {CLOUD};'}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="numcol" width="64" valign="middle" style="width:64px; font-family:{DISPLAY}; font-weight:700; font-size:52px; mso-line-height-rule:exactly; line-height:42px; color:{BLUSH};">0{n}</td>
      <td width="110" valign="middle" style="width:110px;">
        <table role="presentation" width="110" cellpadding="0" cellspacing="0" border="0" style="width:110px;"><tr><td class="imgband" height="110" align="center" style="height:110px; width:110px; background:{MIST}; border:1px solid {CLOUD}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
          <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="108" style="width:auto; max-width:108px; max-height:108px; display:inline-block; border:0;"></a>
        </td></tr></table>
      </td>
      <td width="22" style="width:22px; font-size:0; line-height:0;">&nbsp;</td>
      <td valign="middle">
        <a href="{{{{ product_{n}_url }}}}" style="color:{INK}; text-decoration:none; display:block; font-family:{BODY}; font-weight:600; font-size:15px; mso-line-height-rule:exactly; line-height:21px;">{{{{ product_{n}_title }}}}</a>
        <p style="margin:6px 0 0; font-family:{BODY}; font-weight:400; font-size:12px; mso-line-height-rule:exactly; line-height:20px; color:{SMOKE};">{{{{ product_{n}_note }}}}</p>
        <p style="margin:8px 0 0; font-family:{BODY}; font-weight:500; font-size:12px; mso-line-height-rule:exactly; line-height:17px; color:{INK};">{{{{ product_{n}_price }}}}</p>
      </td>
    </tr></table>
  </td></tr>""" for n in range(1, 7))

    return (
        head("The Ranked List") + promo() + masthead() +
        ink_band(50, eyebrow_color=WINE, with_cta=False, pad="50px 40px 46px") +
        spacer(8) + rows +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:12px 40px 44px;">
    {button_solid("{{ cta_url }}", "{{ cta_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# D -- Palette Block
# ---------------------------------------------------------------------------
def template_d() -> str:
    bands = ""
    for b, (a_slot, b_slot) in enumerate([(1, 2), (3, 4), (5, 6)], start=1):
        edge = f" border-top:1px solid {CLOUD};" if b == 1 else ""
        bands += f"""
  <!-- Colour band {b}. The colour field names itself and carries its own pair.
       The tint behind the products is the fifth part of the same band cell. -->
  <tr><td style="background:{PAPER}; padding:0;{edge} border-bottom:1px solid {CLOUD};">
    <!-- Fixed layout, or the colour name decides the column width and a band
         called Teal gives its products more room than one called Burgundy. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td class="bandcol" width="136" valign="middle" style="width:136px; background:{{{{ band_{b}_color }}}}; padding:26px 22px;">
        <p style="margin:0; font-family:{DISPLAY}; font-weight:700; font-size:26px; mso-line-height-rule:exactly; line-height:26px; text-transform:uppercase; color:{WHITE};">{{{{ band_{b}_name }}}}</p>
        <p style="margin:10px 0 0; font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:15px; letter-spacing:1.6px; text-transform:uppercase; color:{BLUSH};">{{{{ band_{b}_count }}}}</p>
        <p style="margin:12px 0 0; font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:18px; color:{BLUSH};">{{{{ band_{b}_note }}}}</p>
      </td>
      <td class="bandcol" width="374" valign="top" style="width:374px; background:{{{{ band_{b}_tint }}}}; padding:22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="col colgap" width="179" valign="top" style="width:179px; height:1px;">{tile(a_slot, 179, band=180, show_price=False, show_note=False, ground=WHITE)}</td>
          <td class="gut" width="16" style="width:16px; font-size:0; line-height:0;">&nbsp;</td>
          <td class="col" width="179" valign="top" style="width:179px; height:1px;">{tile(b_slot, 179, band=180, show_price=False, show_note=False, ground=WHITE)}</td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>
"""
    return (
        head("Palette Block") + promo() + masthead() +
        ink_band(48, pad="48px 40px") +
        image_band("hero_image", "headline_1", "cta_url") + bands +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:36px 40px 44px;">
    {button_solid("{{ secondary_url }}", "{{ secondary_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# E -- Campaign Chapter
# ---------------------------------------------------------------------------
def template_e() -> str:
    # Five products and a burgundy count tile in the sixth position. The tile
    # closes the grid rather than a sixth pair, which is what stops the chapter
    # reading as a category page.
    count_tile = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;">
        <tr><td class="imgband" height="170" align="center" valign="middle" style="height:170px; background:{BURGUNDY}; text-align:center; padding:16px;">
          <p style="margin:0; font-family:{DISPLAY}; font-weight:700; font-size:30px; mso-line-height-rule:exactly; line-height:30px; color:{WHITE};">{{{{ section_count }}}}</p>
          <p style="margin:8px 0 0; font-family:{BODY}; font-weight:600; font-size:9px; mso-line-height-rule:exactly; line-height:14px; letter-spacing:1.6px; text-transform:uppercase; color:{BLUSH};">Styles<br>In the Edit</p>
        </td></tr>
      </table>"""

    def grid(slots: list[int], last: str | None = None) -> str:
        entries = [tile(n, 160, band=170, show_price=False, show_note=False) for n in slots]
        if last:
            entries.append(last)
        cells = []
        for i, cell in enumerate(entries):
            gap = '<td class="gut" width="16" style="width:16px; font-size:0; line-height:0;">&nbsp;</td>' if i else ""
            cls = "col colgap" if i < len(entries) - 1 else "col"
            cells.append(f"""{gap}<td class="{cls}" width="160" valign="top" style="width:160px; height:1px;">{cell}</td>""")
        return f"""
  <tr><td class="pad" style="background:{PAPER}; padding:0 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table>
  </td></tr>
"""

    return (
        head("Campaign Chapter") + promo() + masthead() +
        ink_band(54, pad="52px 40px 46px") +
        image_band("hero_image", "headline_1", "cta_url", border_bottom=True) +
        centred_copy("intro", "38px 46px 32px") +
        # The design puts a price where the other templates put a count -- the
        # edit is one price point, so that is the number worth stating here.
        section_head(count_field="product_1_price", pad="0 40px 18px") +
        grid([1, 2, 3]) + spacer(16) + grid([4, 5], last=count_tile) +
        spacer(40) + footer() + TAIL)


# ---------------------------------------------------------------------------
# F -- Category Lookbook
# ---------------------------------------------------------------------------
def template_f() -> str:
    def big_tile(n: int, flag: str) -> str:
        return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;">
        <tr><td class="imgband" height="280" align="center" style="height:280px; background:{MIST}; border:1px solid {CLOUD}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
          <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="250" style="width:auto; max-width:100%; max-height:280px; display:inline-block; border:0;"></a>
        </td></tr>
        <tr><td style="padding:16px 0 0;"><p class="badge" style="margin:0; font-family:{BODY}; font-weight:600; font-size:9px; mso-line-height-rule:exactly; line-height:14px; letter-spacing:1.8px; text-transform:uppercase; color:{flag};">{{{{ product_{n}_badge }}}}</p></td></tr>
        <tr><td style="padding:6px 0 0;"><a href="{{{{ product_{n}_url }}}}" style="color:{INK}; text-decoration:none; display:block; font-family:{BODY}; font-weight:600; font-size:17px; mso-line-height-rule:exactly; line-height:23px;">{{{{ product_{n}_title }}}}</a></td></tr>
        <tr><td style="height:100%; padding:6px 0 0; vertical-align:top;"><p style="margin:0; font-family:{BODY}; font-weight:400; font-size:12px; mso-line-height-rule:exactly; line-height:20px; color:{SMOKE};">{{{{ product_{n}_note }}}}</p></td></tr>
        <tr><td style="padding:10px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:500; font-size:13px; mso-line-height-rule:exactly; line-height:18px; color:{INK};">{{{{ product_{n}_price }}}}</p></td></tr>
      </table>"""

    rail = ""
    for start in (3, 6):
        cells = []
        for i, n in enumerate(range(start, start + 3)):
            gap = '<td class="gut" width="14" style="width:14px; font-size:0; line-height:0;">&nbsp;</td>' if i else ""
            cls = "col colgap" if i < 2 else "col"
            cells.append(f"""{gap}<td class="{cls}" width="164" valign="top" style="width:164px; height:1px;">{tile(n, 164, band=120, show_price=False, show_note=False)}</td>""")
        rail += f"""
  <tr><td class="pad" style="background:{PAPER}; padding:{'0' if start == 3 else '14px'} 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table>
  </td></tr>
"""

    return (
        head("Category Lookbook") + promo() + masthead() + paper_head(46) +
        f"""
  <!-- Two tiles argue side by side. The flag label is what separates them:
       burgundy on the one being argued for, grey on the one it is against. -->
  <tr><td style="background:{CLOUD}; padding:0; border-top:1px solid {CLOUD}; border-bottom:1px solid {CLOUD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col" width="251" valign="top" style="width:251px; background:{PAPER}; padding:24px;">{big_tile(1, BURGUNDY)}</td>
      <td class="gut" width="1" style="width:1px; font-size:0; line-height:0; background:{CLOUD};">&nbsp;</td>
      <td class="col" width="250" valign="top" style="width:250px; background:{PAPER}; padding:24px;">{big_tile(2, MUTED)}</td>
    </tr></table>
  </td></tr>
""" +
        image_band("break_image", "break_title", "break_url") +
        f"""
  <!-- The design floats this caption over the foot of the image. Email cannot
       overlay reliably, so it sits directly beneath at the same weight.
       The break is its own picture rather than a product slot: nine tiles do
       not fit in eight, and a full-bleed campaign frame is not a catalogue
       tile anyway -- it wants its own crop and its own line of copy. -->
  <tr><td style="background:{INK}; padding:20px 28px; border-bottom:1px solid {CLOUD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle" style="font-family:{DISPLAY}; font-weight:700; font-size:22px; mso-line-height-rule:exactly; line-height:28px; text-transform:uppercase; color:{WHITE};">{{{{ break_title }}}}</td>
      <td align="right" valign="middle" style="font-family:{BODY}; font-weight:500; font-size:10px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.8px; text-transform:uppercase; color:{MUTED};">{{{{ break_note }}}}</td>
    </tr></table>
  </td></tr>
""" +
        section_head(pad="34px 40px 18px") + rail +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:32px 40px 40px;">
    {button_solid("{{ cta_url }}", "{{ cta_text }}")}
  </td></tr>
""" + footer() + TAIL)


TEMPLATES = {
    "01-hero-editorial.html":    ("Hero Editorial",    template_a),
    "02-split-story.html":       ("Split Story",       template_b),
    "03-ranked-list.html":       ("Ranked List",       template_c),
    "04-palette-block.html":     ("Palette Block",     template_d),
    "05-campaign-chapter.html":  ("Campaign Chapter",  template_e),
    "06-category-lookbook.html": ("Category Lookbook", template_f),
}

# The chrome is the part that must not drift, so it is asserted rather than
# trusted: every file has to carry the burgundy bar, the blush footer with its
# burgundy rule, and the logo twice.
CHROME = [
    (f"background:{BURGUNDY}; padding:11px 16px", 1, "burgundy announcement bar"),
    (f"background:{BLUSH}; padding:34px 36px; border-top:2px solid {BURGUNDY}", 1, "blush footer"),
    (LOGO, 2, "logo (masthead + footer)"),
]

# Classes whose whole job is to disappear when their field is blank. `:empty`
# means no child nodes at all, so wrapping the value in anything -- even a
# <span> that prints nothing -- silently stops the collapse working. That is
# not visible in the markup and only shows up as a row that will not go away,
# so it is checked here rather than left to be noticed in a preview.
COLLAPSING = ("swatch", "badge")

# Text elements whose alignment a mail platform is liable to have an opinion
# about. Anything that carries words and can be targeted by a bare tag selector.
ALIGNABLE = ("h1", "h2", "h3", "h4", "p")


def pin_text_alignment(html: str) -> str:
    """Write each cell's alignment onto the text inside it.

    A heading centred by its parent cell is centred by inheritance, and
    inheritance is the weakest thing in CSS. Klaviyo's drag-and-drop templates
    carry their own heading and paragraph styles -- typically `text-align: left`
    -- and a rule that matches the element beats alignment inherited from its
    parent. So a hero that is centred in the preview arrives left-aligned, which
    is what happened, and happened equally to templates pasted in by hand.

    Saying it on the element itself settles it: an inline style outranks any
    stylesheet the platform wraps around the content.
    """
    from html.parser import HTMLParser

    class Pin(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=False)
            self.out: list[str] = []
            self.cells: list[str | None] = []

        def _alignment(self, attrs: dict[str, str]) -> str | None:
            style = attrs.get("style", "")
            found = re.search(r"text-align\s*:\s*(left|center|right)", style)
            if found:
                return found.group(1)
            align = attrs.get("align", "").lower()
            return align if align in ("left", "center", "right") else None

        def handle_starttag(self, tag: str, attrs_list) -> None:
            attrs = {k: (v or "") for k, v in attrs_list}
            if tag in ("td", "th"):
                self.cells.append(self._alignment(attrs))
            elif tag in ALIGNABLE and self.cells:
                inherited = self.cells[-1]
                if inherited and not re.search(r"text-align\s*:", attrs.get("style", "")):
                    attrs["style"] = f"text-align:{inherited}; " + attrs.get("style", "")
            rendered = "".join(f' {k}="{v}"' if v != "" else f" {k}" for k, v in attrs.items())
            self.out.append(f"<{tag}{rendered}>")

        def handle_endtag(self, tag: str) -> None:
            if tag in ("td", "th") and self.cells:
                self.cells.pop()
            self.out.append(f"</{tag}>")

        def handle_startendtag(self, tag: str, attrs_list) -> None:
            rendered = "".join(f' {k}="{v}"' if (v or "") != "" else f" {k}" for k, v in attrs_list)
            self.out.append(f"<{tag}{rendered}>")

        def handle_data(self, data: str) -> None:
            self.out.append(data)

        def handle_entityref(self, name: str) -> None:
            self.out.append(f"&{name};")

        def handle_charref(self, name: str) -> None:
            self.out.append(f"&#{name};")

        def handle_comment(self, data: str) -> None:
            self.out.append(f"<!--{data}-->")

        def handle_decl(self, decl: str) -> None:
            self.out.append(f"<!{decl}>")

    pin = Pin()
    pin.feed(html)
    return "".join(pin.out)


def alignment_faults(html: str) -> list[str]:
    """Any text element left relying on inheritance inside an aligned cell."""
    faults = []
    cell = None
    for token in re.finditer(r"<(/?)(td|th|h1|h2|h3|h4|p)\b([^>]*)>", html):
        closing, tag, attrs = token.groups()
        if tag in ("td", "th"):
            if closing:
                cell = None
            else:
                found = re.search(r"text-align\s*:\s*(left|center|right)", attrs)
                align = re.search(r'align="(left|center|right)"', attrs)
                cell = found.group(1) if found else (align.group(1) if align else None)
        elif not closing and cell and not re.search(r"text-align\s*:", attrs):
            faults.append(f"<{tag}> inherits its alignment from a {cell} cell")
    return faults


def collapse_faults(html: str) -> list[str]:
    faults = []
    for cls in COLLAPSING:
        for tag, inner in re.findall(rf'<(\w+)[^>]*class="{cls}"[^>]*>(.*?)</\1>', html, re.S):
            if "<" in inner:
                faults.append(f".{cls} wraps its value, so :empty can never match")
    return faults

if __name__ == "__main__":
    failed = False
    for filename, (name, fn) in TEMPLATES.items():
        html = pin_text_alignment(fn())
        (OUT / filename).write_text(html, encoding="utf-8")
        ph = sorted(set(re.findall(r"\{\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}\}", html)))
        checks = []
        for tag in ("table", "tr", "td"):
            o = len(re.findall(rf"<{tag}\b", html))
            c = len(re.findall(rf"</{tag}>", html))
            if o != c:
                failed = True
            checks.append(f"{tag} {o}/{c}" + ("" if o == c else " MISMATCH"))
        for token, want, label in CHROME:
            got = html.count(token)
            if got != want:
                failed = True
                checks.append(f"{label} {got}/{want} MISSING")
        for fault in dict.fromkeys(collapse_faults(html) + alignment_faults(html)):
            failed = True
            checks.append(fault)
        print(f"{filename:28} {name:18} {len(ph):3} placeholders   {' · '.join(checks)}")
    raise SystemExit(1 if failed else 0)
