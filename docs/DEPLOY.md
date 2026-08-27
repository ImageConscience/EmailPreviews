# Getting this online

## Where can it run?

This is a real web application, not a set of files. It needs a machine that keeps
running: it checks passwords, stores your templates and content, and saves edits.
That rules some hosts in and others out.

| Host | Works? | Why |
| --- | --- | --- |
| **Railway** | **Yes — use this** | Runs the server and provisions the Postgres database alongside it. |
| Render, Fly.io | Yes | Same shape; the steps below translate directly. |
| Vercel | Yes, with an external database | Runs the app fine, but has no database of its own — point `DATABASE_URL` at Neon, Supabase or Railway Postgres. |
| **GitHub Pages** | **No** | Serves fixed files only. It cannot run a server, so there is nowhere for logins or saved content to live. |

GitHub Pages is the common misconception, and it is worth being clear about: it
is not a matter of configuration. Pages hands visitors files exactly as they sit
in the repository. There is no process running to check a password or write an
edit to a database, so accounts and saved changes are impossible on it.

---

## Railway, step by step

You need a Railway account (railway.com — sign in with GitHub). No terminal
required.

### 1. Deploy the app

- **New Project → Deploy from GitHub repo → `ImageConscience/EmailPreviews`.**
- Railway reads `railway.json` from the repo and sets the build and start
  commands itself.
- The first build will succeed but the app will not start yet — it has no
  database. That is the next step.

### 2. Add Postgres

- In the same project: **New → Database → Add PostgreSQL.**

Railway provisions it with backups and its own credentials. You do not need to
create tables — the app does that itself on its next boot.

### 3. Link the two

Adding the database is not enough on its own; the app service has to be told
where it is.

- Open your **app** service → **Variables → New Variable**:

  | Name | Value |
  | --- | --- |
  | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

  Type it exactly like that, braces included — Railway resolves the reference at
  deploy time, so the credentials are never copied around or committed. If your
  database service has a different name, use that name instead of `Postgres`.

If you skip this, the app stops on boot and prints these instructions rather
than failing with a database error.

### 4. Get your URL

- App service → **Settings → Networking → Generate Domain**.
- You get something like `emailpreviews-production.up.railway.app`. That is the
  link you share with your team.

### 5. Create your account

Visit the URL and you land on the sign-in page. Click **Create one** — the first
account becomes the owner of your company. From **Team** you can invite everyone
else; each person gets their own login attached to the same company.

The app does not send email, so an invitation produces a link you pass along
yourself (Slack, email, however you like). That is deliberate: no mail provider
to sign up for before the app is usable.

### Using your own domain

Settings → Networking → Custom Domain, then add the CNAME record Railway shows
you at your DNS provider. HTTPS is handled for you, which the app requires —
session cookies are marked secure in production.

---

## The ongoing workflow

Once deployed, pushing to the repo's default branch redeploys automatically, and
**schema changes apply themselves**:

- **Build** runs `prisma generate && next build`. No database work happens here,
  because Railway builds in a throwaway container.
- **Start** runs `scripts/check-db.mjs`, then `prisma migrate deploy`, then the
  server. Any migration committed to the repo and not yet applied runs against
  the live database at that moment. Already-applied migrations are skipped, so
  restarts and redeploys with no schema change are no-ops.

So the loop for a schema change is: the migration is generated and committed
here, you push, Railway applies it on boot. Nothing manual.

`prisma migrate deploy` never rewrites or drops existing data — it only applies
migration files it has not seen. Destructive changes are only ever destructive if
a migration file says so, which is worth a read of the SQL for anything that
renames or removes a column.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | `${{Postgres.DATABASE_URL}}` on Railway, or any `postgresql://` connection string. |
| `SESSION_COOKIE_NAME` | No | Defaults to `ep_session`. |

`PORT` is set by the host; you do not need to configure it.

---

## Working on the code locally

The app needs a Postgres to talk to. Two options:

**Use the Railway database.** In the Postgres service → **Variables**, copy
`DATABASE_PUBLIC_URL` (not `DATABASE_URL` — that one is only reachable from
inside Railway) into your local `.env`. Quickest, but you are working against
live data.

**Run one locally.** With Docker:

```bash
docker run -d --name ep-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=emailpreviews postgres:16
```

Then in `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/emailpreviews"
```

Either way:

```bash
npm install
npx prisma migrate deploy   # create the tables
npm run seed                # optional demo company
npm run dev                 # http://localhost:3000
```

### Changing the schema

Edit `prisma/schema.prisma`, then:

```bash
npx prisma migrate dev --name describe_the_change
```

That updates your local database and writes a migration file under
`prisma/migrations/`. **Commit that file** — it is what Railway applies on the
next deploy.

---

## Backups

Railway takes its own Postgres backups. For a portable copy that does not depend
on the host:

```bash
npx tsx scripts/db-export.ts backup-2026-08-27.json
```

That writes every table except sessions to one JSON file.
`scripts/db-import.ts` loads it into an empty database, and refuses to run
against one that already has users so it cannot half-merge into a live system.
Sessions are not carried across — everyone signs in again, which is the right
outcome for a database move.
