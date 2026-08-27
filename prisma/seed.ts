/**
 * Demo data so a fresh install has something to look at.
 * Run with `npm run seed`. Safe to re-run: it clears the demo company first.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "previewme123";

const PROMO_HTML = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;max-width:600px;">
            <tr>
              <td style="padding:20px 28px;border-bottom:1px solid #eeeeee;">
                <img src="{{ logo_url }}" alt="{{ brand_name }}" height="28" style="display:block;">
              </td>
            </tr>
            <tr>
              <td>
                <img src="{{ hero_image }}" alt="{{ hero_alt }}" width="600" style="display:block;width:100%;height:auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px;">
                <h1 style="margin:0 0 8px;font-size:27px;line-height:1.25;color:#111827;">{{ headline }}</h1>
                <p style="margin:0;font-size:16px;line-height:1.6;color:#4b5563;">{{ subheadline }}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px;font-size:15px;line-height:1.7;color:#374151;">
                {{{ body_copy }}}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 34px;">
                <a href="{{ cta_url }}" style="display:inline-block;background:#111827;color:#ffffff;padding:13px 26px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">{{ cta_text }}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#fafafa;border-top:1px solid #eeeeee;font-size:12px;color:#9ca3af;line-height:1.6;">
                {{ footer_note }}<br>
                <a href="{{ unsubscribe_url }}" style="color:#9ca3af;">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const ANNOUNCE_HTML = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#111827;font-family:Georgia,serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
            <tr>
              <td style="padding:36px 34px 12px;text-align:center;">
                <p style="margin:0 0 14px;letter-spacing:0.22em;text-transform:uppercase;font-size:11px;color:#9ca3af;font-family:Helvetica,Arial,sans-serif;">{{ eyebrow }}</p>
                <h1 style="margin:0;font-size:34px;line-height:1.15;color:#111827;">{{ headline }}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 34px;">
                <img src="{{ hero_image }}" alt="{{ hero_alt }}" width="492" style="display:block;width:100%;height:auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:0 34px 22px;font-size:16px;line-height:1.75;color:#374151;">
                {{{ body_copy }}}
              </td>
            </tr>
            <tr>
              <td style="padding:0 34px 40px;text-align:center;">
                <a href="{{ cta_url }}" style="display:inline-block;border:2px solid #111827;color:#111827;padding:12px 30px;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:14px;letter-spacing:0.05em;text-transform:uppercase;">{{ cta_text }}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const COLUMNS = [
  "Brand Name",
  "logo_url",
  "hero_image",
  "hero_alt",
  "headline",
  "subheadline",
  "body_copy",
  "cta_text",
  "cta_url",
  "footer_note",
  "unsubscribe_url",
  "Internal Owner",
  "Send Date",
];

const ROWS: Record<string, string>[] = [
  {
    "Brand Name": "Acme Retail",
    logo_url: "https://placehold.co/120x28/111827/ffffff?text=ACME",
    hero_image: "https://placehold.co/600x320/e5e7eb/6b7280?text=Spring+Sale",
    hero_alt: "Spring sale hero",
    headline: "Spring styles, 30% off",
    subheadline: "Three days only, on everything in the new-season edit.",
    body_copy:
      "Our lightest layers are back in stock, and everything in the spring edit is marked down through Sunday.<br><br>Free returns, as always.",
    cta_text: "Shop the sale",
    cta_url: "https://example.com/spring-sale",
    footer_note: "You are receiving this because you shop with Acme Retail.",
    unsubscribe_url: "https://example.com/unsubscribe",
    "Internal Owner": "Priya",
    "Send Date": "2026-03-14",
  },
  {
    "Brand Name": "Acme Retail",
    logo_url: "https://placehold.co/120x28/111827/ffffff?text=ACME",
    hero_image: "https://placehold.co/600x320/dbeafe/1e40af?text=New+Arrivals",
    hero_alt: "New arrivals hero",
    headline: "The summer drop is here",
    subheadline: "Forty new pieces, made in limited runs.",
    body_copy: "Everything in this drop is made in runs of 200 or fewer. When it is gone, it is gone.",
    cta_text: "See what's new",
    cta_url: "https://example.com/new-arrivals",
    footer_note: "You are receiving this because you shop with Acme Retail.",
    unsubscribe_url: "https://example.com/unsubscribe",
    "Internal Owner": "Dana",
    "Send Date": "2026-06-02",
  },
  {
    // Deliberately incomplete: shows the coverage panel doing its job.
    "Brand Name": "Acme Retail",
    logo_url: "https://placehold.co/120x28/111827/ffffff?text=ACME",
    hero_image: "https://placehold.co/600x320/fee2e2/991b1b?text=Last+Chance",
    hero_alt: "Last chance hero",
    headline: "Last chance: winter clearance",
    subheadline: "",
    body_copy: "Final markdowns on everything left from the winter collection.",
    cta_text: "Shop clearance",
    cta_url: "https://example.com/clearance",
    footer_note: "",
    unsubscribe_url: "https://example.com/unsubscribe",
    "Internal Owner": "Priya",
    "Send Date": "2026-01-20",
  },
  {
    "Brand Name": "Acme Retail",
    logo_url: "https://placehold.co/120x28/111827/ffffff?text=ACME",
    // A broken URL on purpose, so the image warning has something to catch.
    hero_image: "https://placehold.co/600x320/broken-path-does-not-exist.jpg",
    hero_alt: "Collaboration hero",
    headline: "We teamed up with Studio Nord",
    subheadline: "A ten-piece capsule, out Friday.",
    body_copy: "Ten pieces, designed with Studio Nord in Copenhagen. Available Friday at 9am.",
    cta_text: "Preview the capsule",
    cta_url: "https://example.com/studio-nord",
    footer_note: "You are receiving this because you shop with Acme Retail.",
    unsubscribe_url: "https://example.com/unsubscribe",
    "Internal Owner": "Dana",
    "Send Date": "2026-04-18",
  },
];

function placeholdersOf(html: string): string {
  const found = new Set<string>();
  const re = /\{\{\{?\s*([A-Za-z0-9][A-Za-z0-9 ._-]*?)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) found.add(m[1].trim());
  return JSON.stringify([...found]);
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.company.deleteMany({
      where: { memberships: { some: { userId: existing.id, role: "owner" } } },
    });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
    },
  });

  const company = await prisma.company.create({
    data: {
      name: "Acme Retail",
      memberships: { create: { userId: user.id, role: "owner" } },
      templates: {
        create: [
          {
            name: "Weekly Promo",
            description: "Hero image, headline, body and a single call to action",
            html: PROMO_HTML,
            placeholders: placeholdersOf(PROMO_HTML),
          },
          {
            name: "Product Announcement",
            description: "Editorial layout on a dark ground",
            html: ANNOUNCE_HTML,
            placeholders: placeholdersOf(ANNOUNCE_HTML),
          },
        ],
      },
      sheets: {
        create: [
          {
            name: "Q1 Campaign Copy",
            sourceFilename: "q1-campaigns.xlsx",
            columns: JSON.stringify(COLUMNS),
            rows: {
              create: ROWS.map((data, index) => ({
                position: index,
                data: JSON.stringify(data),
                createdById: user.id,
              })),
            },
          },
        ],
      },
    },
  });

  console.log(`Seeded "${company.name}".`);
  console.log(`  Sign in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
