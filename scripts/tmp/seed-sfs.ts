/** A Safety-style company: subject and preheader, but no send date or time. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { extractPlaceholders } from "@/lib/template";
const prisma = new PrismaClient();
const HTML = `<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif;">
<table width="600"><tr><td style="padding:24px;">
<h1>{{ headline }}</h1><p>{{ body_paragraph_1 }}</p>
<a href="{{ cta_url }}">{{ cta_text }}</a>
</td></tr></table></body></html>`;
async function main() {
  const user = await prisma.user.findFirst({ where: { email: "tester@example.com" } });
  if (!user) throw new Error("no user");
  await prisma.company.deleteMany({ where: { name: "Safety Facility Services" } });
  const c = await prisma.company.create({ data: { name: "Safety Facility Services" } });
  await prisma.membership.create({ data: { userId: user.id, companyId: c.id, role: "owner" } });
  await prisma.template.create({ data: { companyId: c.id, name: "Core Service", html: HTML,
    placeholders: JSON.stringify(extractPlaceholders(HTML)) } });
  const columns = ["template", "send_month", "option", "subject", "preheader", "headline", "body_paragraph_1", "cta_url", "cta_text"];
  const sheet = await prisma.contentSheet.create({ data: { companyId: c.id, name: "campaign-content.csv", columns: JSON.stringify(columns) } });
  await prisma.sheetRow.createMany({ data: [
    { sheetId: sheet.id, position: 0, data: JSON.stringify({ template: "Core Service", send_month: "Sep 2026", option: "A",
      subject: "Nobody notices clean", preheader: "", headline: "Nobody notices clean",
      body_paragraph_1: "Until they do.", cta_url: "https://example.com", cta_text: "Get a quote" }) },
    { sheetId: sheet.id, position: 1, data: JSON.stringify({ template: "Core Service", send_month: "Oct 2026", option: "A",
      subject: "The pallet came in", preheader: "", headline: "The pallet came in",
      body_paragraph_1: "So did the roaches.", cta_url: "https://example.com", cta_text: "Book an inspection" }) },
  ]});
  console.log("safety company", c.id, "| sheet columns:", columns.join(", "));
}
main().finally(() => prisma.$disconnect());
