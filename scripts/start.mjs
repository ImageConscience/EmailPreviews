/**
 * Production start: check the database, apply migrations, run the server.
 *
 * When the database is not usable this still starts the web server, in a mode
 * where every page explains what is missing. On a hosted deploy the operator's
 * only window into the app is its URL, and a container that exits leaves that
 * URL blank with the reason buried in logs. A page that names the missing step
 * is the difference between a five second fix and a hunt.
 */
import { spawn } from "node:child_process";
import {
  describeUrl,
  inspectDatabase,
  loadDotEnv,
  onRailway,
} from "./lib/database-config.mjs";

const SCHEMA = new URL("../prisma/schema.prisma", import.meta.url);

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...env },
    });
    child.on("exit", (code, signal) => resolve({ code: code ?? 0, signal }));
    child.on("error", () => resolve({ code: 1, signal: null }));
  });
}

function startServer(issue) {
  const env = issue
    ? {
        EP_SETUP_ISSUE: issue.summary,
        EP_SETUP_DETAIL: issue.detail,
        EP_SETUP_STEPS: JSON.stringify(issue.steps ?? []),
      }
    : {};

  const child = spawn("next", ["start"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  // Forward shutdown signals so the platform can stop the container cleanly.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
}

function report(issue) {
  const lines = [
    "",
    `[database] ${issue.summary}`,
    `           ${issue.detail}`,
    ...(issue.steps ?? []).map((step, i) => `           ${i + 1}. ${step}`),
    "",
    "[startup]  Starting anyway so the site can explain this instead of showing nothing.",
    "",
  ];
  console.error(lines.join("\n"));
}

loadDotEnv();

const problem = inspectDatabase(SCHEMA);
if (problem) {
  report(problem);
  startServer(problem);
} else {
  console.log(`[database] PostgreSQL at ${describeUrl(process.env.DATABASE_URL)}`);

  const migrate = await run("prisma", ["migrate", "deploy"]);
  if (migrate.code !== 0) {
    const issue = {
      summary: "The database is configured but could not be prepared.",
      detail:
        "Applying migrations failed. The connection string may point at a database that is " +
        "unreachable, still starting up, or rejecting these credentials. The deploy logs above " +
        "carry the exact error.",
      steps: onRailway()
        ? [
            "Check the Postgres service in Railway is running.",
            "Confirm DATABASE_URL on this service references it, e.g. ${{Postgres.DATABASE_URL}}.",
            "Redeploy once it is: migrations run again on every start.",
          ]
        : [],
    };
    report(issue);
    startServer(issue);
  } else {
    startServer(null);
  }
}
