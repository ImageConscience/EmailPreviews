# Getting this online

## Where can it run?

This is a real web application, not a set of files. It needs a machine that keeps
running: it checks passwords, stores your templates and content, and saves edits.
That rules some hosts in and others out.

| Host | Works? | Why |
| --- | --- | --- |
| **Railway** | **Yes — use this** | Runs the server and gives you a disk that survives deploys. |
| Render, Fly.io | Yes | Same shape as Railway; the steps below translate directly. |
| Vercel | Only with PostgreSQL | Runs the app, but throws the disk away between requests, so SQLite would lose everything. See *Switching to PostgreSQL*. |
| **GitHub Pages** | **No** | Serves fixed files only. It cannot run a server, so there is nowhere for logins or saved content to live. |

GitHub Pages is the common misconception here, and it is worth being clear about:
it is not a matter of configuration. Pages hands visitors files exactly as they
sit in the repository. There is no process running to check a password or write
an edit to a database, so accounts and saved changes are impossible on it.

---

## Railway, step by step

You need a Railway account (railway.com — sign in with GitHub). About five
minutes, no terminal.

### 1. Create the project

- **New Project → Deploy from GitHub repo → `ImageConscience/EmailPreviews`.**
- Railway reads `railway.json` from the repo and configures the build and start
  commands itself. Nothing to fill in.
- It will start building. **Let this first build fail or sit** — it has nowhere to
  put the database yet. That is what the next step fixes.

### 2. Give it a disk

This is the step that matters, and the one that is easy to miss.

- Open the service → **Settings → Volumes → Add Volume**.
- Set the mount path to **`/data`**.

Without this, the database lives in temporary space and **every deploy wipes
every account and every template.** The app refuses to start in that state rather
than let it happen quietly — if you see a message about "no persistent disk",
this is the step you skipped.

### 3. Point the app at the disk

- Service → **Variables → New Variable**:

  | Name | Value |
  | --- | --- |
  | `DATABASE_URL` | `file:/data/app.db` |

- Redeploy. The logs should show `[database] SQLite at /data/app.db (on the
  mounted volume)` followed by the migration being applied.

### 4. Get your URL

- Service → **Settings → Networking → Generate Domain**.
- Railway gives you something like `emailpreviews-production.up.railway.app`.
  That is the link you share with your team.

### 5. Create your account

Visit the URL and you land on the sign-in page. Click **Create one**, and the
first account you make becomes the owner of your company. From **Team** you can
invite everyone else — each person gets their own login attached to the same
company.

The app does not send email, so an invitation produces a link that you pass along
yourself (Slack, email, however you like). That is deliberate: it means there is
no mail provider to sign up for before the app is usable.

### Using your own domain

Settings → Networking → Custom Domain, then add the CNAME record Railway shows
you at your DNS provider. HTTPS is handled for you, which the app requires —
session cookies are marked secure in production.

---

## What the deploy actually does

Worth knowing, because it explains the shape of the setup:

- **Build** runs `prisma generate && next build`. No database work happens here,
  because Railway builds in a throwaway container where your disk is not mounted.
- **Start** runs `scripts/check-db.mjs`, then `prisma migrate deploy`, then the
  server. Migrations run against the real disk, on the real machine, every boot.
  Applying an already-applied migration does nothing, so restarts are safe.

`scripts/check-db.mjs` is the guard. It stops the boot with an explanation when
the database is configured in a way that would lose data or fail confusingly
later. To run deliberately without persistence (a throwaway demo), set
`ALLOW_EPHEMERAL_DB=1`.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | `file:/data/app.db` on Railway, or a `postgresql://` connection string. |
| `SESSION_COOKIE_NAME` | No | Defaults to `ep_session`. |
| `ALLOW_EPHEMERAL_DB` | No | Set to `1` to allow running with a database that does not persist. |

`PORT` is set by the host; you do not need to configure it.

---

## Switching to PostgreSQL

Worth doing once several people are editing at the same time — SQLite handles one
write at a time, which is fine for a small team and not for a large one. It is
also what Vercel would require.

On Railway, add a PostgreSQL service to the project and it provides a connection
string you can reference from your app's variables.

The schema deliberately avoids everything that differs between the two databases
(no enums, no scalar lists, no native JSON columns), so this is a configuration
change rather than a rewrite:

```bash
# 1. Dump what you have
npx tsx scripts/db-export.ts backup.json

# 2. In prisma/schema.prisma change:  provider = "sqlite"  ->  provider = "postgresql"

# 3. Point at the new database and rebuild the migration history
export DATABASE_URL="postgresql://user:pass@host:5432/emailpreviews"
rm -rf prisma/migrations
npx prisma migrate dev --name init

# 4. Load the data back in
npx tsx scripts/db-import.ts backup.json
```

`db-import.ts` refuses to run against a database that already has users, so it
cannot half-merge into a live system. Sessions are not copied — everyone signs in
again, which is the right outcome for a database move.

If you set a Postgres `DATABASE_URL` but forget step 2, the startup guard says so
plainly instead of failing later with a Prisma error.

### What survives the move

- Row content and template placeholder lists are JSON strings in ordinary text
  columns on both databases; nothing needs converting.
- Roles are plain strings, not a database enum, so no type needs creating.
- Record ids are generated by Prisma rather than the database, so they come
  across unchanged and every relationship stays intact.

---

## Backups

`scripts/db-export.ts` writes every table except sessions to one JSON file, and
is the portable backup:

```bash
npx tsx scripts/db-export.ts backup-2026-08-27.json
```

On SQLite you can also copy `app.db` off the volume. The JSON dump is the one
that works regardless of which database you are on.
