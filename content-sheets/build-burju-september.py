#!/usr/bin/env python3
"""
Build the unified Burju Shoes September content sheet.

One sheet, six templates, 21 sends. The columns are the union of what the six
templates ask for, minus the two groups that are packed into single cells:
`swatches` carries a colour range and `band_1..3` each carry a colour band, so
twenty headings become four. Everything else is a field some template actually
renders.

Products are real: titles, prices, images and handles come from the live
Burju catalogue via the Shopify Admin API, filtered to active products.
"""

import csv
from pathlib import Path

OUT = Path(__file__).parent / "burju-shoes-september.csv"
P = "https://burjushoes.com/products/"
C = "https://burjushoes.com/collections/"
SHIP = "Free Shipping on All Orders Over $150 — US & Worldwide"

# --- the catalogue, as pulled from Shopify --------------------------------
CDN = "https://cdn.shopify.com/s/files/1/0794/3074/6422/files/"
CAT = {
 "sierra_black":   ("Sierra — Black Vegan Leather", "179.00", "sierra-black-vegan-leather-street-sole", "Sierra-4.2-mesh-boot-black-1.jpg?v=1762283301"),
 "sierra_silver":  ("Sierra — Silver Vegan Leather", "179.00", "sierra-silver-vegan-leather-street-sole", "Sierra-silver-lace-up-ankle-boot-1_e16d7338-d1ad-47ee-be2c-a372b1e26e37.jpg?v=1762444206"),
 "sierralynn_blk": ("Sierralynn — Black Vegan Suede", "179.00", "sierralynn-black-vegan-suede-street-sole", "Sierralynn-black-suede-lace-up-bootie-1_e6990d06-3227-46ce-a7cd-4683fc2d71ff.jpg?v=1713711139"),
 "sierralynn_red": ("Sierralynn — Red Vegan Suede", "179.00", "sierralynn-red-vegan-suede-street-sole", "Sierralynn-red-lace-up-ankle-boot-1_6335fbe0-e602-4cfb-a38c-db659bd90cf7.jpg?v=1713711405"),
 "xiomara_black":  ("Xiomara — Black Vegan Leather", "179.00", "xiomara-black-vegan-leather-street-sole", "Xiomara-black-mesh-ankle-bootie-1__56362_569ba94b-f51a-42c6-9448-ab6936c84dee.jpg?v=1776302499"),
 "xiomara_red":    ("Xiomara — Red Vegan Leather", "179.00", "xiomara-red-vegan-leather-suede-sole-dance-floor-only", "Xiomara-red-lace-up-ankle-boot-1_fe0fbab4-5dbb-472b-9fd0-aa401de24a0e.jpg?v=1716346242"),
 "shabina_black":  ("Shabina — Black Lycra", "179.00", "shabina-black-lycra-street-sole", "Shabina-black-sock-ankle-boot-1__51849_76fe3416-a3c9-43ef-9032-c5dc8260101a.jpg?v=1718130136"),
 "shabina_red":    ("Shabina — Red Lycra", "179.00", "shabina-red-lycra-street-sole", "Shabina-red-lycra-ankle-bootie-1.jpg?v=1716813675"),
 "shabina_pink":   ("Shabina — Hot Pink Lycra", "179.00", "shabina-hot-pink-lycra-street-sole", "Shabina-pink-stretch-sock-bootie-1.jpg?v=1716813677"),
 "shabina_tan":    ("Shabina — Dark Tan Lycra", "179.00", "shabina-dark-tan-lycra-street-sole", "shabina_product_shot.jpg?v=1778081261"),
 "marley_black":   ("Marley — Black Vegan Patent", "179.00", "marley-black-vegan-patent-street-sole", "Marley-open-toe-mesh-cut-out-ankle-boot-black-1.jpg?v=1776302571"),
 "marley_burg":    ("Marley — Burgundy Vegan Patent", "179.00", "marley-burgundy-vegan-patent-street-sole", "Marley-open-toe-lace-up-ankle-boot-burgundy-1.jpg?v=1776302571"),
 "koda_black":     ("Koda — Black Vegan Leather", "179.00", "koda-black-vegan-leather-street-sole", "Koda-mesh-cut-out-ankle-boot-black-1.jpg?v=1776302552"),
 "koda_nude6":     ("Koda — Truly Nude Shade Six", "179.00", "koda-truly-nude-shade-six-street-sole", "Koda-mesh-cut-cout-ankle-boot-tan-1.jpg?v=1753802431"),
 "nyx_black":      ("Nyx — Black Vegan Leather", "179.00", "nyx-black-vegan-leather-street-sole", "Nyx-strappy-buckle-ankle-bootie-black-1.jpg?v=1776302623"),
 "nyx_nude1":      ("Nyx — Truly Nude Shade One", "179.00", "nyx-truly-nude-shade-one-street-sole", "Nyx-strappy-buckle-open-toe-ankle-boot-1.jpg?v=1776302623"),
 "nyx_nude8":      ("Nyx — Truly Nude Shade Eight", "179.00", "nyx-truly-nude-shade-eight-street-sole", "Nyx-strappy-buckle-ankle-bootie-brown-1.jpg?v=1753804441"),
 "jett_black":     ("Jett — Black Vegan Leather", "179.00", "jett-black-vegan-leather-street-sole", "Jett-sporty-open-toe-ankle-bootie-black-1.jpg?v=1753801481"),
 "jett_burg":      ("Jett — Burgundy Vegan Suede", "179.00", "jett-burgundy-vegan-suede-street-sole", "Jett-open-toe-sporty-ankle-bootie-burgundy-1.jpg?v=1753801271"),
 "lowen_black":    ("Lowen — Black Vegan Leather", "179.00", "lowen-black-vegan-leather-street-sole", "Lowen-open-toe-ankle-boot-black-1.jpg?v=1753803736"),
 "cora_black":     ("Cora — Black Vegan Leather", "179.00", "cora-black-vegan-leather-street-sole", "Cora-mesh-open-toe-ankle-bootie-black-1.jpg?v=1753801978"),
 "bett_black":     ("Bett — Black Vegan Leather", "179.00", "bett-black-vegan-leather-street-sole", "Bett-sporty-mesh-ankle-bootie-black-1.jpg?v=1754070404"),
 "jezabel":        ("Jezabel — Black Vegan Leather", "179.00", "jezabel-black-vegan-leather-street-sole", "Jezabel-black-net-lace-up-bootie-1_d9328a33-7695-4d7e-b17c-ae8e43b196cb.jpg?v=1713449408"),
 "tempest":        ("Tempest — Black Vegan Leather", "179.00", "tempest-black-vegan-leather-street-sole", "Tempest-black-mesh-ankle-boot-1_aa807d46-d3b4-4a66-82d5-7abbdd74830a.jpg?v=1718130358"),
 "karma":          ("Karma — Black with Black Straps", "179.00", "karma-black-with-black-straps-street-sole", "IMG_7259.jpg?v=1716813796"),
 "rizzo":          ("Rizzo — Gold Leopard", "179.00", "rizzo-gold-leopard-street-sole", "Rizzo-gold-mesh-ankle-boot-1_86d47dd4-4544-489d-9bc7-ed21807a41a3.jpg?v=1714235667"),
 "elliray":        ("Elliray — Black Vegan Leather", "179.00", "elliray-black-vegan-leather-street-sole", "Elliray-platform-short-ankle-boot-black-1_eb14a441-5951-42d9-bd78-6a561191f5bf.jpg?v=1717011052"),
 "aadijay":        ("Aadijay — Black Vegan Leather", "179.00", "aadijay-black-vegan-leather-street-sole", "Aadijay-platform-ankle-boot-black-1__47039.jpg?v=1716813858"),
 "adira_black":    ("Adira — Black Vegan Leather", "149.00", "adira-black-vegan-leather-street-sole", "Adira-matte-black-pump-1__16973.jpg?v=1716813764"),
 "adira_burg":     ("Adira — Burgundy Vegan Patent", "149.00", "adira-burgundy-vegan-patent-street-sole", "Adira-classic-stiletto-pump-burgundy-1.jpg?v=1772138343"),
 "adira_nude3":    ("Adira Nude — Truly Nude Shade Three", "149.00", "adiranude-truly-nude-shade-three-street-sole", "Adira-nude-shade-three-pump-1_037a4e07-f6aa-4b20-a8c6-15c75bb0d730.jpg?v=1716813752"),
 "adira_nude6":    ("Adira Nude — Truly Nude Shade Six", "149.00", "adiranude-truly-nude-shade-six-street-sole", "Adira-nude-shade-six-pump-1_65fbf706-5877-48d0-bd03-0e88dc986543.jpg?v=1716813758"),
 "starlette_burg": ("Starlette — Burgundy Vegan Patent", "149.00", "starlette-burgundy-vegan-patent-street-sole", "Starlette-peep-toe-heeled-sandal-burgundy-1_f836b3c9-c6a7-47e9-9b7b-a73f733be4b3.jpg?v=1753756636"),
 "amiri_burg":     ("Amiri — Burgundy Vegan Patent", "179.00", "amiri-burgundy-vegan-patent-street-sole", "Amiri-harness-strap-open-toe-ankle-boot-burgundy-1.jpg?v=1773088470"),
 "rene_burg":      ("Rene — Burgundy Vegan Patent", "159.00", "rene-burgundy-vegan-patent-street-sole", "Rene-strappy-open-toe-ankle-boot-burgundy-1.jpg?v=1769467218"),
 "skylar_burg":    ("Skylar — Burgundy Vegan Patent", "169.00", "skylar-burgundy-vegan-patent-street-sole", "skylar-open-toe-strappy-heeled-sandal-burgundy-1.jpg?v=1769403825"),
 "devilla_2":      ("Devilla Size Inclusive — Burgundy", "199.00", "devilla-size-inclusive-burgundy-vegan-patent-street-sole-thigh-variant-two", "Devilla-round-toe-size-inclusive-thigh-high-burgundy-2-1.jpg?v=1763046208"),
 "devilla_3":      ("Devilla Size Inclusive — Burgundy", "199.00", "devilla-size-inclusive-burgundy-vegan-patent-street-sole-thigh-variant-three", "Devilla-round-toe-size-inclusive-thigh-high-burgundy-3-1.jpg?v=1763046431"),
 "phoenix":        ("Phoenix — Black Metallic", "119.40", "phoenix-black-metallic-street-sole", "Phoenix-stretch-thigh-high-boot-black-1__38277_4a696f7d-0875-45ce-ab67-066046c21448.jpg?v=1749155867"),
 "khadija":        ("Khadija — Black Vegan Suede", "107.40", "khadija-black-vegan-suede", "Khadija-black-vegan-pointed-toe-boot-1__39792.jpg?v=1749155843"),
 "sybil_black":    ("Sybil — Black Vegan Leather", "89.40", "sybil-black-vegan-leather-street-sole", "sybil-black-patent-classic-pump-1__94923_ff1082f5-fcd0-4282-976a-050012aceb12.jpg?v=1749155897"),
 "sybil_leopard":  ("Sybil — Tan Leopard", "89.40", "sybil-tan-leopard-street-sole", "sybil-leopard-classic-pump-1.jpg?v=1749155898"),
 "sybil_red":      ("Sybil — Red Vegan Leather", "89.40", "sybil-red-vegan-leather-street-sole", "sybil-red-patent-classic-pump-1__51093.jpg?v=1749155898"),
 "dafne":          ("Dafne — Black Vegan Leather", "95.40", "dafne-black-vegan-leather-street-sole", "dafne-black-loafer-pump-1__89406_03201c37-b4c5-4eda-920f-eeb581944229.jpg?v=1710883521"),
}

COLUMNS = (
    ["template", "send_date", "send_time", "campaign", "subject", "preheader", "promo_line",
     "eyebrow", "headline_1", "headline_2", "subhead", "intro",
     "cta_text", "cta_url", "secondary_text", "secondary_url",
     "hero_image", "detail_image", "detail_title", "detail_body",
     "section_label", "section_count",
     "point_1_title", "point_1_body", "point_2_title", "point_2_body", "point_3_title", "point_3_body",
     "swatches", "band_1", "band_2", "band_3",
     "break_image", "break_title", "break_note", "break_url"]
    + [f"product_{n}_{f}" for n in range(1, 9) for f in ("image", "title", "price", "url", "note")]
    + ["product_1_badge", "product_2_badge"]
)


def prod(row: dict, n: int, key: str, note: str = "", badge: str = "") -> None:
    title, price, handle, img = CAT[key]
    row[f"product_{n}_title"] = title
    row[f"product_{n}_price"] = f"${price}"
    row[f"product_{n}_url"] = P + handle
    row[f"product_{n}_image"] = CDN + img
    if note:
        row[f"product_{n}_note"] = note
    if badge and n in (1, 2):
        row[f"product_{n}_badge"] = badge


# How many product slots each template actually renders. A row that supplies
# more is not filling a longer list -- the extra products are simply dropped,
# silently, which is how a six-item ranking reached a template headlined
# "The Five That Never Leave".
SLOTS = {
    "Hero Editorial": 3,
    "Split Story": 4,
    "Ranked List": 6,   # the sixth row hides itself when unused
    "Palette Block": 6,
    "Campaign Chapter": 5,
    "Category Lookbook": 9,   # two tiles, the full-bleed break, then six rail
}


def send(**kw) -> dict:
    row = {c: "" for c in COLUMNS}
    row["send_time"] = "10:00"
    row["promo_line"] = SHIP
    products = kw.pop("products", [])
    budget = SLOTS[kw["template"]]
    if len(products) > budget:
        raise SystemExit(
            f'{kw["campaign"]}: {kw["template"]} renders {budget} products, '
            f"but the row supplies {len(products)}")
    # The lookbook argues two styles side by side, then breaks full-bleed to a
    # third before the colourway rail. That third is a campaign frame rather
    # than a tile, so it comes out of the product list and into its own fields.
    if kw.get("template") == "Category Lookbook" and len(products) > 2:
        key = products[2]
        note = key[1] if isinstance(key, tuple) and len(key) > 1 else ""
        title, price, handle, img = CAT[key[0] if isinstance(key, tuple) else key]
        row["break_image"] = CDN + img
        row["break_title"] = title
        # The caption sits on one line beside a 22px title, so it takes a
        # descriptor and a price -- not the sentence a rail tile would carry.
        short = note.split(".")[0].split(",")[0].strip()
        row["break_note"] = f"{short} \u00b7 ${price}" if 0 < len(short) <= 34 else f"${price}"
        row["break_url"] = P + handle
        products = products[:2] + products[3:]
    row.update(kw)
    for n, spec in enumerate(products, 1):
        prod(row, n, *spec) if isinstance(spec, tuple) else prod(row, n, spec)
    return row


ROWS = []

# ---------------------------------------------------------------- E · chapters
ROWS.append(send(
    template="Campaign Chapter", send_date="2026-09-02", campaign="Back to Work",
    subject="The shoes that survive a nine-hour day",
    preheader="Chapter one: what you wear when the day is long and the floor is hard.",
    eyebrow="Back To… · Chapter One", headline_1="Back to", headline_2="Work.",
    subhead="Desk to dinner without a second pair",
    intro="September starts with the longest days of the year — not in daylight, in hours on your feet. This chapter is the block heels, the closed toes and the pairs that look composed at 6pm because they were built to.",
    cta_text="Shop the Edit", cta_url=C + "best-sellers",
    secondary_text="In the Edit", secondary_url=C + "best-sellers",
    hero_image=CDN + "Adira-matte-black-pump-1__16973.jpg?v=1716813764",
    section_label="Chapter One", section_count="05",
    products=["adira_black", "sybil_black", "dafne", "khadija", "adira_nude3"],
))
ROWS.append(send(
    template="Campaign Chapter", send_date="2026-09-09", campaign="Back to Life",
    subject="Chapter two: the pair you actually go out in",
    preheader="Work is handled. This one is for everything after it.",
    eyebrow="Back To… · Chapter Two", headline_1="Back to", headline_2="Life.",
    subhead="For the part of the evening nobody scheduled",
    intro="The last chapter ended at the office door. This one starts there. Straps that hold through a night out, mesh that breathes, and heights that still let you get to the train.",
    cta_text="Shop the Edit", cta_url=C + "new-arrivals",
    secondary_text="In the Edit", secondary_url=C + "new-arrivals",
    hero_image=CDN + "Nyx-strappy-buckle-ankle-bootie-black-1.jpg?v=1776302623",
    section_label="Chapter Two", section_count="05",
    products=["nyx_black", "jett_black", "cora_black", "lowen_black", "bett_black"],
))
ROWS.append(send(
    template="Campaign Chapter", send_date="2026-09-16", campaign="Back to the Grind",
    subject="Chapter three: back in the studio",
    preheader="Where the series has been heading — the floor, and what holds on it.",
    eyebrow="Back To… · Chapter Three", headline_1="Back to", headline_2="the Grind.",
    subhead="Suede soles, sealed boxes, real rehearsal",
    intro="Two chapters of getting through the day and getting out of the house. This one is the reason for the other two — the studio floor, where the sole matters more than the silhouette.",
    cta_text="Shop the Edit", cta_url=C + "advanced-guide-to-heels-dance",
    secondary_text="In the Edit", secondary_url=C + "advanced-guide-to-heels-dance",
    hero_image=CDN + "Sierralynn-black-suede-lace-up-bootie-1_e6990d06-3227-46ce-a7cd-4683fc2d71ff.jpg?v=1713711139",
    section_label="Chapter Three", section_count="05",
    products=["sierralynn_blk", "shabina_black", "xiomara_black", "tempest", "jezabel"],
))

# ------------------------------------------------------------------ A · heroes
ROWS.append(send(
    template="Hero Editorial", send_date="2026-09-04", campaign="Sierra",
    subject="Sierra: the 4.2 that keeps getting reordered",
    preheader="One style, three colourways, and the reason it never leaves the best-seller list.",
    eyebrow="Style Spotlight", headline_1="Sierra Does", headline_2="Not Move.",
    subhead="4.2 inch · Mesh upper · Street sole",
    intro="Most boots this height ask you to choose between staying upright and looking like you meant it. Sierra's mesh upper holds the foot where a leather one would slide, which is why it comes back in every colour we make it in.",
    cta_text="Shop Sierra", cta_url=C + "best-sellers",
    secondary_text="See all colourways", secondary_url=C + "best-sellers",
    hero_image=CDN + "Sierra-4.2-mesh-boot-black-1.jpg?v=1762283301",
    detail_image=CDN + "Sierra-silver-lace-up-ankle-boot-1_e16d7338-d1ad-47ee-be2c-a372b1e26e37.jpg?v=1762444206",
    detail_title="Why It Holds Up",
    detail_body="A 4.2 inch heel on a street sole, with the mesh cut on the bias so it gives across the instep and not along the length. Broken in within a wear; sized true, with room at the toe box for a wide foot.",
    section_label="The Colourways", section_count="03 styles",
    products=[("sierra_black", "Black Vegan Leather"), ("sierra_silver", "Silver Vegan Leather"),
              ("sierralynn_blk", "Black Vegan Suede")],
))
ROWS.append(send(
    template="Hero Editorial", send_date="2026-09-19", campaign="Xiomara",
    subject="Xiomara: mesh where it matters",
    preheader="The bootie built for people whose feet swell by hour three.",
    eyebrow="Style Spotlight", headline_1="Xiomara,", headline_2="Reconsidered.",
    subhead="4 inch · Mesh panel · Street or suede sole",
    intro="Feet swell. Most boots pretend otherwise. Xiomara puts mesh exactly where the foot widens, so hour six fits the way hour one did — and it does it without looking like a compromise.",
    cta_text="Shop Xiomara", cta_url=C + "ankle-boots",
    secondary_text="See all colourways", secondary_url=C + "ankle-boots",
    hero_image=CDN + "Xiomara-black-mesh-ankle-bootie-1__56362_569ba94b-f51a-42c6-9448-ab6936c84dee.jpg?v=1776302499",
    detail_image=CDN + "Xiomara-red-lace-up-ankle-boot-1_fe0fbab4-5dbb-472b-9fd0-aa401de24a0e.jpg?v=1716346242",
    detail_title="Why It Holds Up",
    detail_body="The mesh panel sits over the metatarsal, the one place a rigid upper cuts in. Available on a street sole for the commute or a suede sole for the floor — same last, same fit, different grip.",
    section_label="The Colourways", section_count="03 styles",
    products=[("xiomara_black", "Black Vegan Leather"), ("xiomara_red", "Red Vegan Leather"),
              ("tempest", "Black Vegan Leather")],
))
ROWS.append(send(
    template="Hero Editorial", send_date="2026-09-21", campaign="Shabina Burgundy",
    subject="Shabina, now in burgundy",
    preheader="The stretch sock bootie in the colour the season turned on.",
    eyebrow="New Colourway", headline_1="Shabina,", headline_2="In Burgundy.",
    subhead="Lycra upper · Sock fit · Street sole",
    intro="Shabina has always been the answer to a narrow heel and a wide forefoot — lycra goes where the foot goes. Burgundy is the colour every other brand ran out of in August. We didn't.",
    cta_text="Shop Shabina", cta_url=C + "trending-now-burgundy-beauty",
    secondary_text="See the burgundy edit", secondary_url=C + "trending-now-burgundy-beauty",
    hero_image=CDN + "Shabina-red-lycra-ankle-bootie-1.jpg?v=1716813675",
    detail_image=CDN + "shabina_product_shot.jpg?v=1778081261",
    detail_title="Why It Holds Up",
    detail_body="A lycra sock upper with no zip and no seam across the instep, so nothing digs when the foot flexes. It pulls on, it stays on, and it does not gape at the ankle the way a leather bootie will.",
    section_label="The Colourways", section_count="03 styles",
    products=[("shabina_red", "Red Lycra"), ("shabina_tan", "Dark Tan Lycra"),
              ("shabina_pink", "Hot Pink Lycra")],
))
ROWS.append(send(
    template="Hero Editorial", send_date="2026-09-25", campaign="Marley",
    subject="Marley: the open toe that still holds",
    preheader="Lace-up structure, open-toe ease — usually you pick one.",
    eyebrow="Style Spotlight", headline_1="Marley Holds", headline_2="an Open Toe.",
    subhead="Lace-up · Open toe · Patent finish",
    intro="An open toe usually means the foot slides forward all night. Marley laces across the instep instead of gripping at the toe, which is the only way an open front stays put through a full evening.",
    cta_text="Shop Marley", cta_url=C + "ankle-boots",
    secondary_text="See all colourways", secondary_url=C + "ankle-boots",
    hero_image=CDN + "Marley-open-toe-lace-up-ankle-boot-burgundy-1.jpg?v=1776302571",
    detail_image=CDN + "Marley-open-toe-mesh-cut-out-ankle-boot-black-1.jpg?v=1776302571",
    detail_title="Why It Holds Up",
    detail_body="The lacing runs from the throat to the ankle, so tension is spread rather than concentrated at one strap. Patent upper wipes clean, which matters more than it should on an open-toe style.",
    section_label="The Colourways", section_count="03 styles",
    products=[("marley_burg", "Burgundy Vegan Patent"), ("marley_black", "Black Vegan Patent"),
              ("amiri_burg", "Burgundy Vegan Patent")],
))

# --------------------------------------------------------------- B · split story
ROWS.append(send(
    template="Split Story", send_date="2026-09-01", campaign="Summer Edit",
    subject="Last call on the summer edit",
    preheader="Three things worth knowing before the sandals go away.",
    eyebrow="Season Change", headline_1="The Summer Edit,", headline_2="Closing.",
    intro="Sandals and open toes are going back into storage. Before they do, here is what the last three months taught us about what actually got worn.",
    point_1_title="Height was not the problem",
    point_1_body="The 4 inch styles outsold the 3.5s all summer. Height was never what people were avoiding.",
    point_2_title="Straps beat slides",
    point_2_body="Anything that fastened at the ankle got worn twice as often as anything that did not.",
    point_3_title="Nude is a range, not a colour",
    point_3_body="Shades three and six moved fastest, which tells you the middle of the range is where most feet sit.",
    hero_image=CDN + "Starlette-peep-toe-heeled-sandal-burgundy-1_f836b3c9-c6a7-47e9-9b7b-a73f733be4b3.jpg?v=1753756636",
    cta_text="Shop What's Left", cta_url=C + "all-shoes",
    section_label="Still Available", section_count="04 styles",
    products=["starlette_burg", "skylar_burg", "sybil_red", "rene_burg"],
))
ROWS.append(send(
    template="Split Story", send_date="2026-09-10", campaign="Truly Nude™",
    subject="Nude is not one colour",
    preheader="Eight shades, because a nude shoe only works if it matches the wearer.",
    eyebrow="Truly Nude™", headline_1="Nude Is Not", headline_2="One Colour.",
    intro="A nude shoe is supposed to disappear against the leg. For most of the industry's history it only did that for a narrow slice of people. Eight shades is the fix.",
    swatches="#f4dcc8, #e3bfa1, #c9a083, #a67b5b, #7a5238, #4d3321, #2f1e13, #1a0f08",
    point_1_title="Match the leg, not the foot",
    point_1_body="Hold the shade against your calf in daylight — the leg is what the shoe has to continue.",
    point_2_title="Between two shades, go deeper",
    point_2_body="A shade slightly darker than the leg reads as a shadow. A lighter one reads as a sock.",
    point_3_title="The line matters more than the colour",
    point_3_body="An unbroken line from calf to toe is what lengthens the leg. The shade only has to not interrupt it.",
    hero_image=CDN + "Adira-nude-shade-six-pump-1_65fbf706-5877-48d0-bd03-0e88dc986543.jpg?v=1716813758",
    cta_text="Find Your Shade", cta_url=C + "best-sellers",
    section_label="In Every Shade", section_count="04 styles",
    products=["adira_nude3", "adira_nude6", "nyx_nude1", "nyx_nude8"],
))
ROWS.append(send(
    template="Split Story", send_date="2026-09-11", campaign="Guide: Heels Dance",
    subject="What to wear to your first heels class",
    preheader="Sole, height and fit — in that order.",
    eyebrow="The Guide", headline_1="Your First", headline_2="Heels Class.",
    intro="The most common mistake is buying for the mirror instead of the floor. Three things decide whether you get through an hour of class, and only one of them is height.",
    point_1_title="Sole first",
    point_1_body="Suede for a sprung studio floor, street for anywhere you also have to walk. Getting this wrong is what makes people quit.",
    point_2_title="Height second",
    point_2_body="Start at 3.5 or 4 inches. You can move up a class or two later; you cannot un-sprain an ankle.",
    point_3_title="Fit last, and snug",
    point_3_body="A dance shoe should feel closer than a street shoe. Movement inside the shoe is what causes blisters, not the heel.",
    hero_image=CDN + "Sierralynn-black-suede-lace-up-bootie-1_e6990d06-3227-46ce-a7cd-4683fc2d71ff.jpg?v=1713711139",
    cta_text="Shop Beginner Styles", cta_url=C + "beginners-guide-to-heels-dance",
    section_label="Where to Start", section_count="04 styles",
    products=["sierralynn_blk", "shabina_black", "adira_black", "xiomara_black"],
))
ROWS.append(send(
    template="Split Story", send_date="2026-09-23", campaign="Practice Heels",
    subject="The pair you rehearse in",
    preheader="Practice shoes take more wear than performance shoes. Buy accordingly.",
    eyebrow="The Guide", headline_1="Rehearsal Wears", headline_2="Harder.",
    intro="A performance pair goes out a handful of times a year. A practice pair goes out three times a week. Most people buy the wrong one first.",
    point_1_title="Buy for hours, not occasions",
    point_1_body="Rehearsal is where the mileage happens. The pair you practise in should be the better-built one.",
    point_2_title="Two soles, two lives",
    point_2_body="A suede sole on a studio floor lasts a season. On concrete it lasts a week. Keep them separate.",
    point_3_title="Replace before it fails",
    point_3_body="When the sole stops gripping on a turn, that is the warning. Do not wait for the strap to go.",
    hero_image=CDN + "shabina_product_shot.jpg?v=1778081261",
    cta_text="Shop Practice Styles", cta_url=C + "beginner-friendly",
    section_label="Built for Hours", section_count="04 styles",
    products=["sierralynn_blk", "sierralynn_red", "shabina_tan", "jezabel"],
))

# ------------------------------------------------------------- C · ranked lists
ROWS.append(send(
    template="Ranked List", send_date="2026-09-07", campaign="Fall Top Sellers",
    subject="The five that never leave",
    preheader="Ranked by what actually reorders, not by what we like.",
    eyebrow="September Ranking", headline_1="The Five That", headline_2="Never Leave.",
    subhead="Ranked by reorder rate, not opinion",
    cta_text="Shop Best Sellers", cta_url=C + "best-sellers",
    products=[("sierra_black", "First on the list three seasons running. The mesh upper is why."),
              ("sierralynn_blk", "The suede sole version outsells the street sole two to one."),
              ("shabina_black", "The only pair on this list with no zip. That is the whole appeal."),
              ("jezabel", "Net upper, lace-up front. The pair people buy after their first class."),
              ("xiomara_black", "Consistently top five, never number one. A quiet workhorse."),
              ("tempest", "Rounds out the list every autumn without fail.")],
))
ROWS.append(send(
    template="Ranked List", send_date="2026-09-26", campaign="Statement Stilettos",
    subject="Six stilettos worth the walk to the car",
    preheader="A stiletto is a commitment. These six earn it.",
    eyebrow="The Ranking", headline_1="Worth the Walk", headline_2="to the Car.",
    subhead="Six stilettos, ranked by how long you last in them",
    cta_text="Shop Stilettos", cta_url=C + "4-5-inch-heels",
    products=[("adira_burg", "The classic pump in the season's colour. Nothing to explain."),
              ("starlette_burg", "Peep toe on a stiletto heel — rarer than it should be."),
              ("skylar_burg", "Strappy enough to hold, plain enough to wear twice a week."),
              ("adira_black", "The one you own before you own any of the others."),
              ("rene_burg", "Open toe, ankle strap, and a heel that does not wobble."),
              ("sybil_black", "The lowest price on this list and the highest repeat rate.")],
))
ROWS.append(send(
    template="Ranked List", send_date="2026-09-29", campaign="Fall Roundup",
    subject="Everything September taught us",
    preheader="The month in six pairs.",
    eyebrow="Month End", headline_1="September,", headline_2="In Six Pairs.",
    subhead="What moved, and what it says about the season",
    cta_text="Shop the Month", cta_url=C + "fall-faves",
    products=[("marley_burg", "Burgundy outsold black for the first time in four years."),
              ("koda_nude6", "Truly Nude shade six was the single fastest mover of the month."),
              ("sierra_black", "Never off the list. Included here for completeness."),
              ("jett_burg", "The new-arrival that behaved like an established style."),
              ("shabina_tan", "Proof that the dark tan lycra should have launched sooner."),
              ("devilla_2", "Size-inclusive thigh highs, and the month's biggest surprise.")],
))

# ------------------------------------------------------------- D · palette blocks
ROWS.append(send(
    template="Palette Block", send_date="2026-09-14", campaign="Cool Fall Colors",
    subject="Three colours, and none of them are black",
    preheader="Burgundy, eggplant and teal — the fall palette in full.",
    promo_line="The Fall Palette Is Here — Burgundy, Eggplant, Teal",
    eyebrow="The Palette", headline_1="Cool Fall", headline_2="Colours.",
    subhead="Burgundy · Eggplant · Teal",
    cta_text="See the Palette", cta_url=C + "fall-faves",
    secondary_text="Shop the Palette", secondary_url=C + "fall-faves",
    hero_image=CDN + "Adira-classic-stiletto-pump-burgundy-1.jpg?v=1772138343",
    band_1="Burgundy | Four Styles | The colour the whole season turned on, and the one that sold out elsewhere in August. | #590529",
    band_2="Eggplant | Two Styles | Deeper than black in daylight, softer than it under a light. | #4a2647",
    band_3="Teal | Two Styles | The one nobody asks for and everybody notices. | #2f7a7a",
    products=[("adira_burg", "Burgundy Vegan Patent"), ("marley_burg", "Burgundy Vegan Patent"),
              ("amiri_burg", "Burgundy Vegan Patent"), ("rene_burg", "Burgundy Vegan Patent"),
              ("jett_burg", "Burgundy Vegan Suede"), ("skylar_burg", "Burgundy Vegan Patent")],
))
ROWS.append(send(
    template="Palette Block", send_date="2026-09-15", campaign="New & Now",
    subject="Everything that landed this month",
    preheader="New arrivals, grouped by the colour they arrived in.",
    promo_line="New Arrivals — Just Landed",
    eyebrow="New & Now", headline_1="Just Landed,", headline_2="By Colour.",
    subhead="Black · Burgundy · Truly Nude",
    cta_text="Shop New Arrivals", cta_url=C + "new-arrivals",
    secondary_text="See Everything New", secondary_url=C + "new-arrivals",
    hero_image=CDN + "Nyx-strappy-buckle-ankle-bootie-black-1.jpg?v=1776302623",
    band_1="Black | Four Styles | Where every new silhouette starts, because it is where the fit gets judged. | #111111",
    band_2="Burgundy | Two Styles | The new arrivals that skipped black entirely this season. | #590529",
    band_3="Truly Nude | Two Styles | New silhouettes in the shade range, not just the range in old silhouettes. | #7a5238",
    products=[("nyx_black", "Black Vegan Leather"), ("koda_black", "Black Vegan Leather"),
              ("jett_burg", "Burgundy Vegan Suede"), ("marley_burg", "Burgundy Vegan Patent"),
              ("koda_nude6", "Truly Nude Shade Six"), ("nyx_nude1", "Truly Nude Shade One")],
))
ROWS.append(send(
    template="Palette Block", send_date="2026-09-22", campaign="Rising Stars Teal",
    subject="The colour nobody asked for",
    preheader="Teal, and the two colours it sits between.",
    promo_line="Rising Stars — The Colours Moving Fastest",
    eyebrow="Rising Stars", headline_1="The Colour", headline_2="Nobody Asked For.",
    subhead="Teal · Burgundy · Leopard",
    cta_text="See What's Rising", cta_url=C + "fall-faves",
    secondary_text="Shop the Palette", secondary_url=C + "fall-faves",
    hero_image=CDN + "Rizzo-gold-mesh-ankle-boot-1_86d47dd4-4544-489d-9bc7-ed21807a41a3.jpg?v=1714235667",
    band_1="Teal | Two Styles | Requested by nobody, noticed by everybody. The month's quiet climber. | #2f7a7a",
    band_2="Burgundy | Two Styles | Still the volume colour, and still the one people photograph. | #590529",
    band_3="Leopard | Two Styles | Not a colour, strictly. Behaves like one on this list. | #b78c3c",
    products=[("rizzo", "Gold Leopard"), ("sybil_leopard", "Tan Leopard"),
              ("adira_burg", "Burgundy Vegan Patent"), ("starlette_burg", "Burgundy Vegan Patent"),
              ("sybil_leopard", "Tan Leopard"), ("rizzo", "Gold Leopard")],
))

# --------------------------------------------------------- F · category lookbooks
ROWS.append(send(
    template="Category Lookbook", send_date="2026-09-08", campaign="New Ankle Boots",
    subject="Five new ankle boots, one new last",
    preheader="The autumn booties, and what changed inside them.",
    eyebrow="The Category", headline_1="New Ankle", headline_2="Boots.",
    intro="Ankle boots are the hardest thing we make: the shaft has to hold without cutting, on an ankle that is never the same shape twice. This season's are built on a revised last.",
    cta_text="Shop Ankle Boots", cta_url=C + "ankle-boots",
    section_label="Every Colourway", section_count="06 styles",
    products=[("koda_black", "Mesh cut-out upper with a closed back, so the boot holds while the foot breathes.", "New Last"),
              ("nyx_black", "Strappy buckle front. The most adjustable boot on the list, by some distance.", "Most Adjustable"),
              ("jett_black", "Sporty, open-toe, and the one that gets worn on a Tuesday."),
              ("lowen_black", "Open toe"), ("cora_black", "Mesh open toe"), ("bett_black", "Sporty mesh"),
              ("koda_nude6", "Truly Nude Six"), ("nyx_nude1", "Truly Nude One"), ("jett_burg", "Burgundy suede")],
))
ROWS.append(send(
    template="Category Lookbook", send_date="2026-09-18", campaign="Fall Boot Pivot",
    subject="The week the sandals go away",
    preheader="Boots take over. Here is where to start.",
    eyebrow="The Pivot", headline_1="Sandals Out,", headline_2="Boots In.",
    intro="Every year there is one week where the whole catalogue turns over. This is it. If you own one pair of boots this season, these are the two arguments for which one.",
    cta_text="Shop All Boots", cta_url=C + "boots",
    section_label="Every Colourway", section_count="06 styles",
    products=[("sierralynn_blk", "Suede upper, lace-up shaft. The one that survives a full season of rehearsal.", "The Workhorse"),
              ("marley_burg", "Open toe on a lace-up boot — the pair that carries into evening.", "The Statement"),
              ("khadija", "Pointed toe · Black vegan suede"),
              ("elliray", "Platform"), ("aadijay", "Platform"), ("tempest", "Mesh"),
              ("jezabel", "Net lace-up"), ("xiomara_black", "Mesh panel"), ("sierra_black", "4.2 mesh")],
))
ROWS.append(send(
    template="Category Lookbook", send_date="2026-09-24", campaign="Thigh Highs + Calf",
    subject="Thigh highs that fit actual thighs",
    preheader="Three calf widths, because one was never going to work.",
    eyebrow="Size Inclusive", headline_1="Thigh Highs,", headline_2="Three Widths.",
    intro="A thigh high that only comes in one calf width is a thigh high for one leg shape. Devilla comes in three, which is why it is the only one we put our name on twice.",
    cta_text="Shop Thigh Highs", cta_url=C + "boots",
    section_label="Every Colourway", section_count="06 styles",
    products=[("devilla_2", "Calf width two, for a standard-to-full calf. The most-ordered of the three.", "Width Two"),
              ("devilla_3", "Calf width three, cut for a fuller calf without shortening the shaft.", "Width Three"),
              ("phoenix", "Stretch thigh high · Black metallic"),
              ("khadija", "Pointed toe"), ("sybil_black", "Classic pump"), ("adira_black", "Classic pump"),
              ("sybil_red", "Red patent"), ("sybil_leopard", "Tan leopard"), ("dafne", "Loafer pump")],
))
ROWS.append(send(
    template="Category Lookbook", send_date="2026-09-28", campaign="Koda + Shabina",
    subject="Two boots, two completely different feet",
    preheader="Structured versus stretch — pick by foot, not by photo.",
    eyebrow="Side by Side", headline_1="Structured", headline_2="or Stretch.",
    intro="These two get compared constantly and they should not be. One holds a narrow foot with structure; the other moves with a wide one. The right answer depends entirely on your foot.",
    cta_text="Compare Both", cta_url=C + "ankle-boots",
    section_label="Every Colourway", section_count="06 styles",
    products=[("koda_black", "Structured mesh cut-out. Holds a narrower foot without pressure at the instep.", "Structured"),
              ("shabina_black", "Lycra sock upper. Moves with a wider forefoot; no zip, no seam, no gape.", "Stretch"),
              ("koda_nude6", "Truly Nude Six · Street sole"),
              ("shabina_red", "Red lycra"), ("shabina_tan", "Dark tan lycra"), ("shabina_pink", "Hot pink lycra"),
              ("koda_black", "Black vegan leather"), ("nyx_black", "Black vegan leather"), ("cora_black", "Mesh open toe")],
))

ROWS.sort(key=lambda r: r["send_date"])

if __name__ == "__main__":
    with OUT.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(ROWS)
    print(f"{len(ROWS)} rows · {len(COLUMNS)} columns -> {OUT.name}")
