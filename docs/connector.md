# The Claude connector

Campaign copy gets written where the brand's voice lives — a Claude project,
usually — and then has to land here. Before this, that meant exporting a sheet,
generating against it, and uploading the result, which makes a *new* sheet every
time because the importer only knows how to create one. This is the other
direction: Claude reads the templates and writes the rows.

## Setting it up

Your name in the top bar → **Claude connector**.

1. **Server URL** — your own Email Previews address with `/api/mcp` on the end.
   The box has it filled in already; click it and copy.
2. **Create a token** — name it after whatever will use it, click Create, copy
   the `ep_…` string.

Both of those go into Claude, where you add a custom connector — not back into
this app.

### What to choose in Claude's dialog

This server authenticates with an API key, not OAuth, so:

- **Authentication → No sign-in.** Its own description covers this case:
  *"for servers that use an API key instead of OAuth"*. The "Detected" badge on
  *Sign in now* means Claude noticed the server wants a credential, not that it
  speaks OAuth — choosing it will fail.
- **Request headers → Add header**, `Authorization` = `Bearer ep_…`.

If the client will not let you set `Authorization` — some reserve it — use
`X-Api-Key` = `ep_…` instead. The `Bearer ` prefix is optional on both.

The token is shown once. Only its SHA-256 is stored, so nobody — including this
app — can read it back; lose it and you make another. Revoking one takes effect
on the next request.

### What a token reaches

Every company its owner belongs to, with exactly the role they already have in
each. It can never do anything that person could not do themselves in the app,
and a company they are not a member of answers "No such company" — phrased that
way on purpose, so a token cannot be used to find out which companies exist.

It is a bearer credential: whoever holds it has that access. A token is as
powerful as the person who made it, so handing one over hands over all of their
brands.

## The tools

| Tool | What it does |
| --- | --- |
| `list_companies` | Every brand this token reaches, and the role it has |
| `list_templates` | A company's templates |
| `describe_template` | **Read this first.** The annotated field list, plus worked examples |
| `list_emails` | Campaigns, filterable by template or search |
| `get_email` | One row's values, for reading prior content |
| `create_email` | Start a row against a template |
| `set_fields` | Merge values into a row |
| `hide_email` | Take a row out of the working view, or put it back |
| `list_attentive_handoffs` | For an Attentive company (admin): approved emails and texts ready to build in Attentive |
| `record_attentive_campaign` | (admin) Record the Attentive campaign Claude built for a row; refused if the row changed since approval |
| `save_attentive_segments` | (admin) Replace the app's copy of the company's Attentive segments |

There is no approve tool and no push tool, deliberately. Sign-off and sending
stay on the screens where a person can see what they are agreeing to.

The three Attentive tools do not change that. Attentive's published API has no
campaigns, so the app cannot push there. Instead the connector hands work that
is *already approved* to the person's Claude session. Claude builds it in
Attentive with Attentive's own MCP tools, where the person approves each write,
then records here what it made. Nothing here sends. Recording is refused for a
row edited since its approval. The step-by-step workflow is in
[skills/attentive-handoff/SKILL.md](skills/attentive-handoff/SKILL.md).

There is no delete either, and that one is a judgement about symmetry: creating
a row over the connector costs one call, so undoing one should not cost the
row. `hide_email` keeps the content, the revision history and the sign-offs,
and the overview filters hidden rows out until you ask to see them. Removing a
row for good is done in the app, on its content sheet.

Hiding a row that is already drafted or scheduled in the company's sending
platform is refused: hiding it here would not stop the send, and would take it
off the screen where you might notice. The refusal names the platform the
campaign is actually in, which is read from the push rather than from the
company -- a company that has switched platforms still has campaigns in the one
it left.

## Why `describe_template` is the point

Prior content teaches by example: it shows what good copy looks like, but it
cannot say that filling `member_price` is *wrong* because the app derives it, or
that `masthead_title` is one of only two fields that accept HTML. Examples
express no prohibitions.

So every mechanical fact the tool reports is **computed, never written down**:

| Fact | Computed from |
| --- | --- |
| Which fields exist | the template's own HTML |
| Which take raw HTML | the brace count — `{{{ }}}` against `{{ }}` |
| Which the app derives | `DERIVED_FIELDS` and `derivedSlotField` in `derived.ts` |
| Which are switches | the same |
| Which packed cells apply | running the expanders in `derived.ts` |
| What the envelope columns are called | this company's actual sheet headers |
| What a push needs | the gate in `push-eligibility.ts` |

`scripts/check-mcp.mts` holds that to the real template files: if someone adds a
raw field or a derived one, the check notices.

A list of rules kept by hand goes stale the first time somebody adds a template,
and a stale rule is worse than none, because it gets believed. The one thing
written by hand is each template's **guidance** box (Settings → Templates →
a template), which is for the judgement that cannot be derived — *products 1–4
are the featured items, 5–8 the closing grid*, *no `.webp`, Outlook shows a gap*.

## Writes are the careful half

An approval is a fingerprint of the whole row, so *any* edit withdraws it. That
is fine when a person edits in the app and watches the approval row change in
front of them. It is not fine when something reaches in over a connector and
nobody sees.

So `set_fields`:

- **refuses outright** on a row already pushed, naming the platform it is in
  and whether it is a draft or scheduled;
- **names whose sign-off** the write would withdraw, and refuses until told
  again with `withdrawApprovals: true`;
- writes a RowRevision every time, noting that the change came over the
  connector, so History shows where it came from.

## Checking it

```
npm run check:mcp     # needs the dev server and a database
```

50 checks: the derived field guide against the real templates, then the
endpoint itself — auth by all three header shapes, tenant isolation against a
company made for the purpose, both write refusals, hiding both ways, and that a
revoked token stops working at once.
