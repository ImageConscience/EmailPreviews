#!/usr/bin/env python3
"""
Build the six Burju Shoes email templates.

They are generated rather than hand-written because the chrome is the point:
the promo bar, wordmark, nav, footer and the two button styles are identical in
every send, and the brief is explicit that only the middle stack changes. Six
hand-maintained copies of that frame would drift within a month. Here the frame
exists once and each template is only its own middle.

Design tokens are lifted from the Burju design system: ink #111111 on paper
#faf9f6, burgundy #590529 as the accent, Playfair Display for headlines and DM
Sans for everything else. Red (#c8102e) is deliberately absent -- it is reserved
for sale sends, and September has none.
"""

import re
from pathlib import Path

OUT = Path(__file__).parent

INK        = "#111111"
PAPER      = "#faf9f6"
WHITE      = "#ffffff"
MIST       = "#f2f1ee"
CLOUD      = "#e6e6e6"
SMOKE      = "#7a7a7a"
GRAPHITE   = "#4a4a4a"
BURGUNDY   = "#590529"

DISPLAY = "'Playfair Display',Didot,'Bodoni 72',Georgia,serif"
BODY    = "'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif"

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
<title>Burju Shoes</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  body {{ margin:0; padding:0; background:{PAPER}; -webkit-text-size-adjust:100%; }}
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
    .dsp  {{ font-size:34px !important; }}
    .dsp-sm {{ font-size:26px !important; }}
    .col  {{ display:block !important; width:100% !important; height:auto !important; }}
    .gut  {{ display:none !important; }}
    .colgap {{ padding-bottom:24px !important; }}
    /* Stacked, the tiles have nothing left to line up against, and holding a
       fixed band across a full-width column would letterbox every picture. */
    .imgband {{ height:auto !important; }}
    .imgband img {{ max-height:none !important; width:100% !important; }}
    .numcol {{ width:52px !important; }}
  }}
</style>
</head>
<body style="margin:0; padding:0; background:{PAPER};">
<div style="display:none; font-size:0; line-height:0; max-height:0; overflow:hidden;">{{{{ preheader }}}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAPER};">
<tr><td align="center" style="padding:0;">
<table role="presentation" class="wrap" width="{W}" cellpadding="0" cellspacing="0" border="0" style="width:{W}px; max-width:{W}px; background:{PAPER};">
"""


def promo(bg: str = INK) -> str:
    """The announcement bar. Ink on every send; burgundy only for a launch."""
    return f"""
  <!-- PERMANENT: promo bar. Ink on every send; template D uses burgundy, which
       the brief reserves for launch moments. -->
  <tr><td class="pad" align="center" style="background:{bg}; padding:9px 40px;">
    <p style="margin:0; font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.5px; text-transform:uppercase; color:{WHITE};">{{{{ promo_line }}}}</p>
  </td></tr>
"""


NAV_ITEMS = [("New", "new-arrivals"), ("Heels", "heels"), ("Boots", "boots"),
             ("Truly Nude&trade;", "truly-nude"), ("Sale", "sale")]


def masthead() -> str:
    cells = []
    for i, (label, handle) in enumerate(NAV_ITEMS):
        gap = '<td width="18" style="width:18px; font-size:0;">&nbsp;</td>' if i else ""
        cells.append(f"""{gap}<td style="font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.4px; text-transform:uppercase;"><a href="https://burjushoes.com/collections/{handle}" style="color:{INK}; text-decoration:none;">{label}</a></td>""")
    nav = "".join(cells)
    return f"""
  <!-- PERMANENT: wordmark and nav. Identical on every send. -->
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:26px 40px 18px;">
    <a href="https://burjushoes.com" style="color:{INK}; text-decoration:none; font-family:{DISPLAY}; font-weight:400; font-size:30px; mso-line-height-rule:exactly; line-height:34px; letter-spacing:6px; text-transform:uppercase;">Burju</a>
  </td></tr>
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:0 40px 20px; border-bottom:1px solid {CLOUD};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>{nav}</tr></table>
  </td></tr>
"""


def button_solid(url: str, text: str) -> str:
    """Solid ink. Used on paper."""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:{INK};"><a href="{url}" style="color:{WHITE}; text-decoration:none; display:inline-block; padding:15px 30px; font-family:{BODY}; font-weight:700; font-size:12px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.6px; text-transform:uppercase;">{text}</a></td>
    </tr></table>"""


def button_outline(url: str, text: str) -> str:
    """Outlined white. Used on the ink band."""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border:1px solid {WHITE};"><a href="{url}" style="color:{WHITE}; text-decoration:none; display:inline-block; padding:14px 29px; font-family:{BODY}; font-weight:700; font-size:12px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.6px; text-transform:uppercase;">{text}</a></td>
    </tr></table>"""


def eyebrow(color: str = SMOKE) -> str:
    return f"""<p style="margin:0 0 12px; font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:2.2px; text-transform:uppercase; color:{color};">{{{{ eyebrow }}}}</p>"""


def headline(color: str, size: int = 44) -> str:
    """Two lines, so a break can be placed deliberately rather than by wrapping."""
    return f"""<h1 class="dsp" style="margin:0; font-family:{DISPLAY}; font-weight:400; font-size:{size}px; mso-line-height-rule:exactly; line-height:{int(size * 1.08)}px; letter-spacing:-0.5px; color:{color};">{{{{ headline_1 }}}}<br>{{{{ headline_2 }}}}</h1>"""


def subhead(color: str) -> str:
    """The dash-framed subhead. The dashes are fixtures of the design."""
    return f"""<p style="margin:16px 0 0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:18px; letter-spacing:1.4px; text-transform:uppercase; color:{color};">&ndash;&nbsp;{{{{ subhead }}}}&nbsp;&ndash;</p>"""


def body_copy(field: str, color: str = GRAPHITE) -> str:
    return f"""<p style="margin:18px 0 0; font-family:{BODY}; font-weight:400; font-size:15px; mso-line-height-rule:exactly; line-height:25px; color:{color};">{{{{ {field} }}}}</p>"""


def image_band(field_img: str, field_alt: str, field_url: str, height: int, bg: str = MIST) -> str:
    """Full-bleed hero. A fixed band so a tall shot cannot push the copy down."""
    return f"""
  <tr><td class="imgband" height="{height}" align="center" style="height:{height}px; background:{bg}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
    <a href="{{{{ {field_url} }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ {field_img} }}}}" alt="{{{{ {field_alt} }}}}" width="{W}" style="width:100%; max-width:100%; max-height:{height}px; display:block; border:0;"></a>
  </td></tr>
"""


def section_head() -> str:
    """Label on the left, count on the right, hairline under."""
    return f"""
  <tr><td class="pad" style="background:{PAPER}; padding:34px 40px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:2.2px; text-transform:uppercase; color:{INK};">{{{{ section_label }}}}</td>
      <td align="right" style="font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.6px; text-transform:uppercase; color:{SMOKE};">{{{{ section_count }}}}</td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="background:{PAPER}; padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid {CLOUD}; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>
"""


def tile(n: int, width: int, show_price: bool = True, show_note: bool = True,
         band: int | None = None, on_ink: bool = False) -> str:
    """One product cell: picture, name, optional note, optional price."""
    band = band if band is not None else width
    fg = WHITE if on_ink else INK
    sub = "#b5b5b5" if on_ink else SMOKE
    note = f"""
        <tr><td style="padding:4px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:400; font-size:12px; mso-line-height-rule:exactly; line-height:18px; color:{sub};">{{{{ product_{n}_note }}}}</p></td></tr>""" if show_note else ""
    price = f"""
        <tr><td style="padding:6px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:700; font-size:13px; mso-line-height-rule:exactly; line-height:18px; color:{fg};">{{{{ product_{n}_price }}}}</p></td></tr>""" if show_price else ""
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;">
        <tr><td class="imgband" height="{band}" align="center" style="height:{band}px; background:{MIST}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
          <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="{width}" style="width:auto; max-width:100%; max-height:{band}px; display:inline-block; border:0;"></a>
        </td></tr>
        <tr><td style="height:100%; padding:12px 0 0; vertical-align:top;"><a href="{{{{ product_{n}_url }}}}" style="color:{fg}; text-decoration:none; display:block; font-family:{BODY}; font-weight:500; font-size:13px; mso-line-height-rule:exactly; line-height:19px; letter-spacing:0.2px;">{{{{ product_{n}_title }}}}</a></td></tr>{note}{price}
      </table>"""


def row(slots: list[int], width: int, gutter: int, **kw) -> str:
    """A row of equal tiles. `height:1px` lets the inner percentage heights
    resolve; a table cell still grows to its content."""
    cells = []
    for i, n in enumerate(slots):
        gap = f'<td class="gut" width="{gutter}" style="width:{gutter}px; font-size:0;">&nbsp;</td>' if i else ""
        cls = "col colgap" if i < len(slots) - 1 else "col"
        cells.append(f"""{gap}<td class="{cls}" width="{width}" valign="top" style="width:{width}px; height:1px;">{tile(n, width, **kw)}</td>""")
    return f"""
  <tr><td class="pad" style="background:{PAPER}; padding:22px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table>
  </td></tr>
"""


def footer() -> str:
    links = []
    for i, (label, handle) in enumerate([("New Arrivals", "new-arrivals"), ("Truly Nude&trade;", "truly-nude"),
                                         ("Wide Fit", "wide-fit"), ("Bridal", "bridal")]):
        gap = '<td width="16" style="width:16px; font-size:0;">&nbsp;</td>' if i else ""
        links.append(f"""{gap}<td style="font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.4px; text-transform:uppercase;"><a href="https://burjushoes.com/collections/{handle}" style="color:{WHITE}; text-decoration:none;">{label}</a></td>""")
    return f"""
  <!-- PERMANENT: footer. The unsubscribe href is a placeholder because Klaviyo
       injects the real one -- set it once per template, not once per send. -->
  <tr><td class="pad" align="center" style="background:{INK}; padding:36px 40px 34px;">
    <a href="https://burjushoes.com" style="color:{WHITE}; text-decoration:none; font-family:{DISPLAY}; font-weight:400; font-size:22px; mso-line-height-rule:exactly; line-height:26px; letter-spacing:5px; text-transform:uppercase;">Burju</a>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 0;"><tr>{"".join(links)}</tr></table>
    <p style="margin:22px 0 0; font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:18px; color:#8a8a8a;">Free shipping on all orders over $150 &middot; US &amp; Worldwide</p>
    <p style="margin:8px 0 0; font-family:{BODY}; font-weight:400; font-size:11px; mso-line-height-rule:exactly; line-height:18px; color:#8a8a8a;">You subscribed at burjushoes.com &middot; <a href="#" style="color:#8a8a8a; text-decoration:underline;">Unsubscribe</a></p>
  </td></tr>
"""


TAIL = """
</table>
</td></tr>
</table>
</body>
</html>
"""


def ink_band(size: int = 44, with_eyebrow: bool = True, with_subhead: bool = True,
             with_cta: bool = True, bg: str = INK) -> str:
    """Headline reversed out on ink, with the outlined button."""
    parts = [eyebrow("#b5b5b5") if with_eyebrow else "", headline(WHITE, size)]
    if with_subhead:
        parts.append(subhead("#b5b5b5"))
    if with_cta:
        parts.append(f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr><td>{button_outline("{{ cta_url }}", "{{ cta_text }}")}</td></tr></table>""")
    return f"""
  <tr><td class="pad" align="left" style="background:{bg}; padding:44px 40px 46px;">
    {"".join(parts)}
  </td></tr>
"""


def paper_head(size: int = 44) -> str:
    """Headline on paper -- template B and F open this way."""
    return f"""
  <tr><td class="pad" align="left" style="background:{PAPER}; padding:38px 40px 0;">
    {eyebrow(SMOKE)}
    {headline(INK, size)}
    {body_copy("intro")}
  </td></tr>
"""


# ---------------------------------------------------------------------------
# A -- Hero Editorial
# ---------------------------------------------------------------------------
def template_a() -> str:
    return (
        head("Hero Editorial") + promo() + masthead() + ink_band() +
        image_band("hero_image", "headline_1", "cta_url", 400) +
        f"""
  <tr><td class="pad" style="background:{PAPER}; padding:32px 40px 0;">
    {body_copy("intro")}
  </td></tr>
""" +
        section_head() +
        row([1, 2, 3], 160, 20) +
        f"""
  <!-- The detail split: a crop of the construction beside the note that
       explains it. This is what makes A editorial rather than a product grid. -->
  <tr><td class="pad" style="background:{PAPER}; padding:38px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col colgap" width="240" valign="top" style="width:240px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="imgband" height="240" align="center" style="height:240px; background:{MIST}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
            <img src="{{{{ detail_image }}}}" alt="{{{{ detail_title }}}}" width="240" style="width:auto; max-width:100%; max-height:240px; display:inline-block; border:0;">
          </td></tr>
        </table>
      </td>
      <td class="gut" width="24" style="width:24px; font-size:0;">&nbsp;</td>
      <td class="col" width="256" valign="top" style="width:256px;">
        <h2 class="dsp-sm" style="margin:0; font-family:{DISPLAY}; font-weight:400; font-size:26px; mso-line-height-rule:exactly; line-height:32px; color:{INK};">{{{{ detail_title }}}}</h2>
        <p style="margin:14px 0 0; font-family:{BODY}; font-weight:400; font-size:14px; mso-line-height-rule:exactly; line-height:23px; color:{GRAPHITE};">{{{{ detail_body }}}}</p>
        <p style="margin:18px 0 0; font-family:{BODY}; font-weight:700; font-size:12px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.4px; text-transform:uppercase;"><a href="{{{{ secondary_url }}}}" style="color:{INK}; text-decoration:underline;">{{{{ secondary_text }}}}</a></p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:38px; font-size:0; line-height:38px;">&nbsp;</td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# B -- Split Story
# ---------------------------------------------------------------------------
def template_b() -> str:
    swatches = "".join(
        f"""<td width="65" style="width:65px; padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="swatch" height="46" style="height:46px; background:{{{{ swatch_{i} }}}}; font-size:0; line-height:0;">&nbsp;</td></tr></table></td>"""
        for i in range(1, 9))
    points = "".join(f"""
          <tr><td style="padding:{'0' if i == 1 else '20px'} 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td class="numcol" width="40" valign="top" style="width:40px; font-family:{DISPLAY}; font-weight:400; font-size:26px; mso-line-height-rule:exactly; line-height:28px; color:{BURGUNDY};">0{i}</td>
              <td valign="top">
                <p style="margin:0; font-family:{BODY}; font-weight:700; font-size:14px; mso-line-height-rule:exactly; line-height:20px; color:{INK};">{{{{ point_{i}_title }}}}</p>
                <p style="margin:5px 0 0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:21px; color:{GRAPHITE};">{{{{ point_{i}_body }}}}</p>
              </td>
            </tr></table>
          </td></tr>""" for i in (1, 2, 3))

    return (
        head("Split Story") + promo() + masthead() + paper_head() +
        f"""
  <!-- Optional swatch row. Omitted by leaving the cells empty -- the .swatch
       rule collapses an empty block rather than printing a black square. -->
  <tr><td style="background:{PAPER}; padding:30px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{swatches}</tr></table>
  </td></tr>

  <!-- The split: picture one side, three numbered points the other. -->
  <tr><td class="pad" style="background:{PAPER}; padding:34px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col colgap" width="232" valign="top" style="width:232px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="imgband" height="300" align="center" style="height:300px; background:{MIST}; font-size:0; line-height:0; text-align:center; vertical-align:middle;">
            <img src="{{{{ hero_image }}}}" alt="{{{{ headline_1 }}}}" width="232" style="width:auto; max-width:100%; max-height:300px; display:inline-block; border:0;">
          </td></tr>
        </table>
      </td>
      <td class="gut" width="24" style="width:24px; font-size:0;">&nbsp;</td>
      <td class="col" width="264" valign="top" style="width:264px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{points}
        </table>
      </td>
    </tr></table>
  </td></tr>
""" +
        section_head() +
        row([1, 2, 3, 4], 118, 16, show_note=False) +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:36px 40px 40px;">
    {button_solid("{{ cta_url }}", "{{ cta_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# C -- The Ranked List
# ---------------------------------------------------------------------------
def template_c() -> str:
    rows = "".join(f"""
  <tr><td class="pad" style="background:{PAPER}; padding:{'26px' if n == 1 else '22px'} 40px 22px; border-top:1px solid {CLOUD};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="numcol" width="64" valign="top" style="width:64px; font-family:{DISPLAY}; font-weight:400; font-size:40px; mso-line-height-rule:exactly; line-height:42px; color:{BURGUNDY};">0{n}</td>
      <td width="110" valign="top" style="width:110px;">
        <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="110" style="width:110px; max-width:100%; display:block; border:0; background:{MIST};"></a>
      </td>
      <td width="16" style="width:16px; font-size:0;">&nbsp;</td>
      <td valign="top">
        <a href="{{{{ product_{n}_url }}}}" style="color:{INK}; text-decoration:none; display:block; font-family:{BODY}; font-weight:700; font-size:15px; mso-line-height-rule:exactly; line-height:21px;">{{{{ product_{n}_title }}}}</a>
        <p style="margin:6px 0 0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:20px; color:{GRAPHITE};">{{{{ product_{n}_note }}}}</p>
        <p style="margin:8px 0 0; font-family:{BODY}; font-weight:700; font-size:13px; mso-line-height-rule:exactly; line-height:18px; color:{INK};">{{{{ product_{n}_price }}}}</p>
      </td>
    </tr></table>
  </td></tr>""" for n in range(1, 7))

    return (
        head("The Ranked List") + promo() + masthead() +
        ink_band(with_cta=False) + rows +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:34px 40px 40px; border-top:1px solid {CLOUD};">
    {button_solid("{{ cta_url }}", "{{ cta_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# D -- Palette Block
# ---------------------------------------------------------------------------
def template_d() -> str:
    bands = ""
    for b, (a_slot, b_slot) in enumerate([(1, 2), (3, 4), (5, 6)], start=1):
        bands += f"""
  <!-- Colour band {b}. The field names itself and carries its own pair. -->
  <tr><td class="pad" style="background:{{{{ band_{b}_color }}}}; padding:30px 40px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:{DISPLAY}; font-weight:400; font-size:26px; mso-line-height-rule:exactly; line-height:32px; color:{WHITE};">{{{{ band_{b}_name }}}}</td>
      <td align="right" style="font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:1.8px; text-transform:uppercase; color:#e0d5da;">{{{{ band_{b}_count }}}}</td>
    </tr></table>
    <p style="margin:10px 0 0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:21px; color:#e0d5da;">{{{{ band_{b}_note }}}}</p>
  </td></tr>
  <tr><td class="pad" style="background:{{{{ band_{b}_color }}}}; padding:18px 40px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col colgap" width="248" valign="top" style="width:248px; height:1px;">{tile(a_slot, 248, on_ink=True)}</td>
      <td class="gut" width="24" style="width:24px; font-size:0;">&nbsp;</td>
      <td class="col" width="248" valign="top" style="width:248px; height:1px;">{tile(b_slot, 248, on_ink=True)}</td>
    </tr></table>
  </td></tr>
"""
    return (
        head("Palette Block") + promo(BURGUNDY) + masthead() + ink_band() +
        image_band("hero_image", "headline_1", "cta_url", 360) + bands +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:36px 40px 40px;">
    {button_solid("{{ secondary_url }}", "{{ secondary_text }}")}
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# E -- Campaign Chapter
# ---------------------------------------------------------------------------
def template_e() -> str:
    return (
        head("Campaign Chapter") + promo() + masthead() + ink_band() +
        image_band("hero_image", "headline_1", "cta_url", 300) +
        f"""
  <tr><td class="pad" style="background:{PAPER}; padding:32px 40px 0;">
    {body_copy("intro")}
  </td></tr>
""" +
        section_head() +
        row([1, 2, 3], 160, 20, show_note=False) +
        row([4, 5, 6], 160, 20, show_note=False) +
        f"""
  <!-- The count tile closes the grid: a burgundy square that states how many
       styles are in the edit, rather than a seventh product. -->
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:34px 40px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td align="center" style="background:{BURGUNDY}; padding:24px 40px;">
        <p style="margin:0; font-family:{DISPLAY}; font-weight:400; font-size:38px; mso-line-height-rule:exactly; line-height:42px; color:{WHITE};">{{{{ section_count }}}}</p>
        <p style="margin:4px 0 14px; font-family:{BODY}; font-weight:500; font-size:11px; mso-line-height-rule:exactly; line-height:16px; letter-spacing:2.2px; text-transform:uppercase; color:#e0d5da;">Styles</p>
        {button_outline("{{ secondary_url }}", "{{ secondary_text }}")}
      </td>
    </tr></table>
  </td></tr>
""" + footer() + TAIL)


# ---------------------------------------------------------------------------
# F -- Category Lookbook
# ---------------------------------------------------------------------------
def template_f() -> str:
    def big_tile(n: int) -> str:
        return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;">
        <tr><td height="30" style="height:30px; font-size:0; line-height:0; vertical-align:bottom;"><span class="badge" style="display:inline-block; margin:0; background:{BURGUNDY}; color:{WHITE}; font-family:{BODY}; font-weight:700; font-size:10px; mso-line-height-rule:exactly; line-height:14px; letter-spacing:1.4px; text-transform:uppercase; padding:5px 10px;">{{{{ product_{n}_badge }}}}</span></td></tr>
        <tr><td class="imgband" height="248" align="center" style="height:248px; background:{MIST}; font-size:0; line-height:0; text-align:center; vertical-align:middle; padding-top:10px;">
          <a href="{{{{ product_{n}_url }}}}" style="display:block; font-size:0; line-height:0; text-decoration:none;"><img src="{{{{ product_{n}_image }}}}" alt="{{{{ product_{n}_title }}}}" width="248" style="width:auto; max-width:100%; max-height:248px; display:inline-block; border:0;"></a>
        </td></tr>
        <tr><td style="padding:14px 0 0;"><a href="{{{{ product_{n}_url }}}}" style="color:{INK}; text-decoration:none; display:block; font-family:{DISPLAY}; font-weight:400; font-size:22px; mso-line-height-rule:exactly; line-height:27px;">{{{{ product_{n}_title }}}}</a></td></tr>
        <tr><td style="height:100%; padding:8px 0 0; vertical-align:top;"><p style="margin:0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:21px; color:{GRAPHITE};">{{{{ product_{n}_note }}}}</p></td></tr>
        <tr><td style="padding:10px 0 0;"><p style="margin:0; font-family:{BODY}; font-weight:700; font-size:13px; mso-line-height-rule:exactly; line-height:18px; color:{INK};">{{{{ product_{n}_price }}}}</p></td></tr>
      </table>"""

    rail = ""
    for start in (4, 7):
        cells = []
        for i, n in enumerate(range(start, start + 3)):
            gap = '<td class="gut" width="16" style="width:16px; font-size:0;">&nbsp;</td>' if i else ""
            cls = "col colgap" if i < 2 else "col"
            cells.append(f"""{gap}<td class="{cls}" width="162" valign="top" style="width:162px; height:1px;">{tile(n, 162, show_price=False)}</td>""")
        rail += f"""
  <tr><td class="pad" style="background:{PAPER}; padding:22px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{"".join(cells)}</tr></table>
  </td></tr>
"""

    return (
        head("Category Lookbook") + promo() + masthead() + paper_head(40) +
        f"""
  <!-- Two tiles argue side by side. The flag label is what separates them. -->
  <tr><td class="pad" style="background:{PAPER}; padding:32px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col colgap" width="248" valign="top" style="width:248px; height:1px;">{big_tile(1)}</td>
      <td class="gut" width="24" style="width:24px; font-size:0;">&nbsp;</td>
      <td class="col" width="248" valign="top" style="width:248px; height:1px;">{big_tile(2)}</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:36px; font-size:0; line-height:36px;">&nbsp;</td></tr>
""" +
        image_band("product_3_image", "product_3_title", "product_3_url", 340) +
        f"""
  <tr><td class="pad" align="center" style="background:{INK}; padding:22px 40px 26px;">
    <p style="margin:0; font-family:{DISPLAY}; font-weight:400; font-size:24px; mso-line-height-rule:exactly; line-height:30px; color:{WHITE};">{{{{ product_3_title }}}}</p>
    <p style="margin:8px 0 0; font-family:{BODY}; font-weight:400; font-size:13px; mso-line-height-rule:exactly; line-height:20px; letter-spacing:0.4px; color:#b5b5b5;">{{{{ product_3_note }}}}</p>
  </td></tr>
""" +
        section_head() + rail +
        f"""
  <tr><td class="pad" align="center" style="background:{PAPER}; padding:36px 40px 40px;">
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

if __name__ == "__main__":
    for filename, (name, fn) in TEMPLATES.items():
        html = fn()
        (OUT / filename).write_text(html, encoding="utf-8")
        ph = sorted(set(re.findall(r"\{\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}\}", html)))
        checks = []
        for tag in ("table", "tr", "td"):
            o = len(re.findall(rf"<{tag}\b", html))
            c = len(re.findall(rf"</{tag}>", html))
            checks.append(f"{tag} {o}/{c}" + ("" if o == c else " MISMATCH"))
        print(f"{filename:28} {name:18} {len(ph):3} placeholders   {' · '.join(checks)}")
