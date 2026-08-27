/**
 * Dump every table to a single JSON file.
 *
 * Paired with db-import.ts this is the move-to-Postgres path: export from
 * SQLite, repoint DATABASE_URL, run the migrations, import.
 *
 *   npx tsx scripts/db-export.ts backup.json
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const target = process.argv[2] ?? "backup.json";

async function main() {
  const data = {
    exportedAt: new Date().toISOString(),
    users: await prisma.user.findMany(),
    companies: await prisma.company.findMany(),
    memberships: await prisma.membership.findMany(),
    invites: await prisma.invite.findMany(),
    templates: await prisma.template.findMany(),
    sheets: await prisma.contentSheet.findMany(),
    rows: await prisma.sheetRow.findMany(),
    revisions: await prisma.rowRevision.findMany(),
    // Sessions are deliberately not exported -- everyone signs in again.
  };
  writeFileSync(target, JSON.stringify(data, null, 2));
  console.log(
    `Wrote ${target}: ${data.users.length} users, ${data.companies.length} companies, ` +
      `${data.templates.length} templates, ${data.rows.length} rows.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
