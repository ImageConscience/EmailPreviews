/**
 * Load a db-export.ts dump into the database DATABASE_URL points at.
 * The target must already have the schema (run `npx prisma migrate deploy`).
 *
 *   npx tsx scripts/db-import.ts backup.json
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type {
  Company,
  ContentSheet,
  Invite,
  Membership,
  RowRevision,
  SheetRow,
  Template,
  User,
} from "@prisma/client";

/** Shape written by db-export.ts. Date fields arrive as ISO strings and are
 *  turned back into Dates by `revive` before insertion. */
interface Dump {
  users: User[];
  companies: Company[];
  memberships: Membership[];
  invites: Invite[];
  templates: Template[];
  sheets: ContentSheet[];
  rows: SheetRow[];
  revisions: RowRevision[];
}

const prisma = new PrismaClient();
const source = process.argv[2] ?? "backup.json";

/** Prisma returns Date objects as ISO strings once they round-trip JSON. */
function revive<T>(records: T[], dateKeys: string[]): T[] {
  return records.map((record) => {
    const out = { ...record } as Record<string, unknown>;
    for (const key of dateKeys) {
      if (typeof out[key] === "string") out[key] = new Date(out[key] as string);
    }
    return out as T;
  });
}

async function main() {
  const data = JSON.parse(readFileSync(source, "utf8")) as Dump;

  const existing = await prisma.user.count();
  if (existing > 0) {
    throw new Error("Target database is not empty. Import into a fresh database.");
  }

  // Insertion order follows the foreign keys.
  await prisma.user.createMany({ data: revive(data.users, ["createdAt"]) });
  await prisma.company.createMany({ data: revive(data.companies, ["createdAt"]) });
  await prisma.membership.createMany({ data: revive(data.memberships, ["createdAt"]) });
  await prisma.invite.createMany({
    data: revive(data.invites, ["createdAt", "expiresAt", "acceptedAt", "revokedAt"]),
  });
  await prisma.template.createMany({ data: revive(data.templates, ["createdAt", "updatedAt"]) });
  await prisma.contentSheet.createMany({ data: revive(data.sheets, ["createdAt", "updatedAt"]) });
  await prisma.sheetRow.createMany({ data: revive(data.rows, ["createdAt", "updatedAt"]) });
  await prisma.rowRevision.createMany({ data: revive(data.revisions, ["changedAt"]) });

  console.log(`Imported ${data.users.length} users and ${data.rows.length} content rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
