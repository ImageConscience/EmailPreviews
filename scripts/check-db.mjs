/**
 * Startup sanity check for DATABASE_URL, run before migrations.
 *
 * It exists to catch the two configuration mistakes that are silent until it is
 * too late: deploying SQLite onto a container with no persistent disk (every
 * redeploy wipes every account), and pointing a Postgres URL at a schema still
 * set to sqlite (which fails later with an opaque Prisma error).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Load .env for local runs. Prisma and Next each do this themselves, but this
 * script runs as plain Node before either of them. Real environment variables
 * always win, so a host's configuration is never overridden by a stray file.
 */
function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/s, "$1");
  }
}

loadDotEnv();

const url = process.env.DATABASE_URL;

function die(message) {
  console.error(`\n[database] ${message}\n`);
  process.exit(1);
}

if (!url) {
  die(
    "DATABASE_URL is not set.\n" +
      "  For SQLite on a mounted disk:  DATABASE_URL=file:/data/app.db\n" +
      "  For PostgreSQL:                DATABASE_URL=postgresql://user:pass@host:5432/dbname",
  );
}

// --- does the schema's provider agree with the URL? ---
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const provider = schema.match(/datasource\s+db\s*\{[^}]*provider\s*=\s*"([^"]+)"/s)?.[1];
const isPostgresUrl = /^postgres(ql)?:\/\//i.test(url);
const isFileUrl = url.startsWith("file:");

if (isPostgresUrl && provider !== "postgresql") {
  die(
    `DATABASE_URL is a PostgreSQL connection but prisma/schema.prisma still says provider = "${provider}".\n` +
      "  Change it to \"postgresql\", delete prisma/migrations, and run `npx prisma migrate dev --name init`.\n" +
      "  See docs/DEPLOY.md for the full switch, including copying existing data across.",
  );
}
if (isFileUrl && provider !== "sqlite") {
  die(
    `DATABASE_URL is a SQLite file path but prisma/schema.prisma says provider = "${provider}".`,
  );
}

if (isPostgresUrl) {
  console.log("[database] PostgreSQL");
  process.exit(0);
}

if (!isFileUrl) {
  die(`DATABASE_URL "${url}" is neither a file: path nor a postgres:// connection.`);
}

// --- SQLite: is the file on something that survives a redeploy? ---
const raw = url.slice("file:".length);
const path = isAbsolute(raw) ? raw : resolve(process.cwd(), "prisma", raw);

// Railway sets this only when a volume is actually attached to the service.
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
const persistent = volume ? path.startsWith(volume) : false;

if (onRailway && !persistent && process.env.ALLOW_EPHEMERAL_DB !== "1") {
  die(
    "This service has no persistent disk, so the database would be erased on every deploy.\n" +
      (volume
        ? `  A volume is mounted at ${volume}, but DATABASE_URL points at ${path}.\n` +
          `  Set DATABASE_URL=file:${volume.replace(/\/$/, "")}/app.db\n`
        : "  In Railway: open the service, Settings -> Volumes -> add one mounted at /data,\n" +
          "  then set DATABASE_URL=file:/data/app.db\n") +
      "\n  To run without persistence anyway (throwaway demo only), set ALLOW_EPHEMERAL_DB=1.",
  );
}

// `prisma migrate deploy` will create the file, but not the directory above it.
try {
  mkdirSync(dirname(path), { recursive: true });
} catch (error) {
  die(`Could not create the directory for ${path}: ${error.message}`);
}

console.log(
  `[database] SQLite at ${path}${onRailway ? (persistent ? " (on the mounted volume)" : " (ephemeral)") : ""}`,
);
