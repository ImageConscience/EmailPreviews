/**
 * Shared inspection of DATABASE_URL, used by the start script.
 *
 * Returns `null` when the configuration is usable, or a problem describing what
 * is wrong in terms of the step that was missed rather than the error it would
 * eventually cause.
 */
import { existsSync, readFileSync } from "node:fs";

/**
 * Load .env for local runs. Prisma and Next each do this themselves, but this
 * runs as plain Node before either of them. Real environment variables always
 * win, so a host's configuration is never overridden by a stray file.
 */
export function loadDotEnv() {
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

export function onRailway() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
}

/** Connection string with the password removed, safe to print or display. */
export function describeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

const LINK_STEPS = [
  "Open your app service in Railway, then Variables -> New Variable.",
  "Name it DATABASE_URL, with the value ${{Postgres.DATABASE_URL}} - braces included.",
  "If your database service is not called Postgres, use its name instead.",
];

export function inspectDatabase(schemaPath) {
  const url = process.env.DATABASE_URL;

  if (!url) {
    return {
      summary: "This app has no database connection yet.",
      detail: onRailway()
        ? "Adding a Postgres service to the project does not by itself tell the app where it is."
        : "Copy .env.example to .env and set DATABASE_URL to a postgresql:// connection string.",
      steps: onRailway() ? LINK_STEPS : [],
    };
  }

  const schema = readFileSync(schemaPath, "utf8");
  const provider = schema.match(/datasource\s+db\s*\{[^}]*provider\s*=\s*"([^"]+)"/s)?.[1];
  const isPostgresUrl = /^postgres(ql)?:\/\//i.test(url);
  const isFileUrl = url.startsWith("file:");

  if (provider === "postgresql" && !isPostgresUrl) {
    return {
      summary: "The database connection string is not a PostgreSQL one.",
      detail:
        `This app is configured for PostgreSQL, but DATABASE_URL is ${
          isFileUrl ? "a SQLite file path" : "not a postgres:// connection string"
        }. It should look like postgresql://user:password@host:5432/dbname`,
      steps: onRailway() ? LINK_STEPS : [],
    };
  }
  if (provider === "sqlite" && !isFileUrl) {
    return {
      summary: "The database connection string does not match the schema.",
      detail:
        "prisma/schema.prisma is set to sqlite, but DATABASE_URL is not a file: path. " +
        'Either set DATABASE_URL=file:./dev.db or change the provider to "postgresql".',
      steps: [],
    };
  }

  return null;
}
