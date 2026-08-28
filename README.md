# Email Previews

Merge spreadsheet content into HTML email templates and see the result on screen
before anything gets sent.

Built for teams who keep their campaign copy in a spreadsheet and their email
markup in template files, and who currently have no way to see the two combined
without pasting values by hand.

---

## What it does

**Companies.** A company is one store of content. Whoever signs up first owns it
and can invite collaborators, each with their own login. Templates, sheets and
rows all belong to a company and are never visible outside it.

**Templates.** Paste an HTML email and mark the variable parts as
`{{ placeholder_name }}`. The app parses the markup and tracks which
placeholders exist. A company can have as many templates as it likes.

**Content sheets.** Upload a `.csv`, `.tsv` or `.xlsx`. It is parsed on import
into records that live in the app — the original file is not kept or needed
again. Column headers correspond to placeholder names.

**Preview.** Pick a row and the merged email renders in an isolated frame at
mobile, desktop or full width. Edit any field and the preview updates as you
type. Save writes the change back to the row and keeps the previous values as a
revision, so a collaborator's edit is always recoverable.

**One sheet, many templates.** A sheet can carry a `template` column naming the
template each row belongs to, so every campaign lives in one place and each row
previews itself correctly without anyone choosing from a list. Switching
template is still one click, and the app says which template the row asked for
so you can get back.

**Subject and preview text** sit above the render rather than inside it. The
sending platform sets both, so they are not placeholders in the template, but
they are campaign copy that gets written and approved with everything else.

**Images.** Anyone with a login can upload images under **Images**, and each one
gets a permanent public link to use in a campaign. The bytes live in the
database rather than in the repository, because an image committed to git can
only be added by whoever can push to it — the wrong shape for a tool the whole
team works in. Image fields in the preview get a picker, and still accept a
pasted URL from anywhere else.

**Approvals.** Each person can sign off the row currently on screen, in the
template currently on screen, and the bar next to the preview shows who has.
The record is per row *and* template, because the same copy in a different
layout is a different email. Editing the copy or the template marks existing
approvals stale rather than letting them silently stand, so an approval always
means "this version was approved".

### The parts that usually go wrong

- **Headers rarely match placeholders exactly.** A column called `Hero Image URL`
  fills `{{ hero_image_url }}`, because both sides are normalised before
  matching. Nobody has to rename anything.
- **Sheets and templates disagree, and that is normal.** A sheet may be missing
  placeholders a template needs, or carry columns the template ignores. The
  coverage panel reports both, so a typo'd header shows up as *no column for
  `headlne`* instead of a silently blank email.
- **Image URLs are just values.** Any field holding a URL is probed by actually
  loading it. If it resolves you get a thumbnail; if it fails and the URL looked
  like an image you get a warning, so a dead asset link is caught here rather
  than in the inbox.
- **A missing image placeholder is a gap, not a broken image.** An unfilled
  `src="{{ hero_image }}"` renders as a labelled dashed box at the right size
  instead of leaving a raw token the browser tries to fetch.
- **One sheet across templates means most columns are irrelevant to any one
  row.** The editor lists the fields the current template actually uses and
  folds the rest away, so a wide sheet does not read as an equally wide form.
- **An approval has to be attached to a version, or it means nothing.** Each one
  fingerprints the row values and the template it was given against, so a later
  edit shows the sign-off as stale instead of carrying it forward. Approving
  is blocked while there are unsaved changes, for the same reason.

---

## Running it

Needs a PostgreSQL database. To run one locally:

```bash
docker run -d --name ep-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=emailpreviews postgres:16
```

Then:

```bash
npm install
cp .env.example .env         # already points at the container above
npx prisma migrate deploy    # create the tables
npm run seed                 # optional demo company
npm run dev                  # http://localhost:3000
```

The seed creates a company with two templates and a four-row content sheet:

```
demo@example.com / previewme123
```

For production: `npm run build && npm start`.

---

## Stack

Next.js (App Router) · TypeScript · Prisma · PostgreSQL · no CSS framework.

Authentication is email + password (bcrypt) with database-backed sessions in an
httpOnly cookie. There is no email provider to configure: invitations produce a
link that the inviter passes along, and the app is fully usable the moment it
starts.

### Putting it online

This needs a host that runs a server, plus a database — **Railway** is the
straightforward choice, since it provisions both in the same project. Render and
Fly.io work the same way; Vercel runs the app but needs an external database.

GitHub Pages cannot host it: Pages serves fixed files, and there is no process
there to check a password or save an edit, so accounts are impossible on it.

On Railway it is: deploy from the repo, add a PostgreSQL database, set
`DATABASE_URL` to `${{Postgres.DATABASE_URL}}` on the app service, generate a
domain. `railway.json` supplies the build and start commands.

After that, pushing to the default branch redeploys, and **schema changes apply
themselves** — migrations run at start (not at build, since a build container has
no access to the database), so a committed migration is applied on the next boot
and already-applied ones are skipped.

If the app starts without a usable database it still serves the site, in a mode
where every page names the missing step. A container that exits instead would
leave the URL blank with the reason buried in platform logs, which is a much
worse place to be when the URL is your only window into the deploy.

[**docs/DEPLOY.md**](docs/DEPLOY.md) has the click-by-click walkthrough, local
development setup, how to make a schema change, and backups.

## Project layout

```
prisma/schema.prisma     data model, with the portability notes
src/lib/template.ts      placeholder parsing and merging (runs on server and client)
src/lib/sheet.ts         .xlsx / .csv ingestion
src/lib/auth.ts          sessions, roles, the single tenancy choke point
src/actions/             server actions: auth, content, members, approvals
src/lib/approval.ts      approval fingerprinting and reviewer initials
src/lib/media.ts         image types and formatting (shared with the browser)
src/lib/media-server.ts  byte-level validation of uploads
src/app/i/[file]/        public, unauthenticated image serving
src/app/c/[companyId]/   the signed-in app; preview/ is the workspace
scripts/start.mjs        production start: check database, migrate, serve
scripts/db-export.ts     dump every table to JSON (portable backup)
scripts/db-import.ts     load a dump into an empty database
railway.json             build and start commands for Railway
```

Every company-scoped read and write goes through `requireCompanyAccess`, which
is the one place tenancy is enforced.

---

## Placeholder syntax

| Written in the template | Behaviour |
| --- | --- |
| `{{ name }}` | Value is HTML-escaped. Use this for copy, subject lines and URLs. |
| `{{{ name }}}` | Value is injected as raw HTML, for cells that legitimately contain markup. |

Names may contain letters, digits, spaces, `_`, `-` and `.`. Matching against
sheet columns is case- and punctuation-insensitive.
