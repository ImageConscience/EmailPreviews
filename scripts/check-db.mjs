/**
 * Startup sanity check for DATABASE_URL, run before migrations.
 *
 * It exists to turn the two configuration mistakes that otherwise surface as
 * opaque Prisma errors into a message that names the step you missed: no
 * DATABASE_URL because the database service was never linked to the app, and a
 * URL whose kind disagrees with the provider in schema.prisma.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * Load .env for local runs. Prisma and Next each do this themselves, but this
 * script runs as plain Node before either of them. Real environment variables
 * always win, so a host's configuration is never overridden by a stray file.
 */
function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/s, "$1");
  }
}

loadDotEnv();

const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);

function die(message) {
  console.error(`\n[database] ${message}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;

if (!url) {
  die(
    "DATABASE_URL is not set.\n" +
      (onRailway
        ? "  Adding a Postgres service to the project is not enough on its own -- the app\n" +
          "  service needs a variable pointing at it.\n\n" +
          "  In your app service: Variables -> New Variable\n" +
          "    Name:  DATABASE_URL\n" +
          "    Value: ${{Postgres.DATABASE_URL}}\n\n" +
          "  (If the database service is named something other than Postgres, use that name.)"
        : "  Copy .env.example to .env and set a connection string, e.g.\n" +
          "    DATABASE_URL=\"postgresql://user:pass@localhost:5432/emailpreviews\""),
  );
}

// --- does the schema's provider agree with the URL? ---
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const provider = schema.match(/datasource\s+db\s*\{[^}]*provider\s*=\s*"([^"]+)"/s)?.[1];
const isPostgresUrl = /^postgres(ql)?:\/\//i.test(url);
const isFileUrl = url.startsWith("file:");

if (provider === "postgresql" && !isPostgresUrl) {
  die(
    `prisma/schema.prisma expects PostgreSQL, but DATABASE_URL is ${
      isFileUrl ? "a SQLite file path" : "not a postgres:// connection string"
    }.\n` +
      `  Got: ${url.replace(/:\/\/[^@]*@/, "://***@")}\n` +
      "  It should look like: postgresql://user:password@host:5432/dbname",
  );
}
if (provider === "sqlite" && !isFileUrl) {
  die(
    `prisma/schema.prisma expects SQLite, but DATABASE_URL is not a file: path.\n` +
      "  Either set DATABASE_URL=file:./dev.db or change the provider to \"postgresql\".",
  );
}

if (isPostgresUrl) {
  // Log the destination without ever printing the password.
  let where = "PostgreSQL";
  try {
    const parsed = new URL(url);
    where = `PostgreSQL at ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    /* an unparseable URL is Prisma's error to report, not ours */
  }
  console.log(`[database] ${where}`);
} else {
  console.log(`[database] SQLite at ${url.slice("file:".length)}`);
}
