# The Claude connector

Campaign copy gets written where the brand's voice lives — a Claude project,
usually — and then has to land here. Before this, that meant exporting a sheet,
generating against it, and uploading the result, which makes a *new* sheet every
time because the importer only knows how to create one. This is the other
direction: Claude reads the templates and writes the rows.

## Setting it up

Settings → Integrations → **Claude connector**.

1. **Server URL** — your own Email Previews address with `/api/mcp` on the end.
   The box has it filled in already; click it and copy.
2. **Create a token** — name it after whatever will use it, click Create, copy
   the `ep_…` string.

Both of those go into Claude, where you add a custom connector — not back into
this app.

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

There is no approve tool and no push tool, deliberately. Sign-off and sending
stay on the screens where a person can see what they are agreeing to.

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

- **refuses outright** on a row already in Klaviyo, and says which;
- **names whose sign-off** the write would withdraw, and refuses until told
  again with `withdrawApprovals: true`;
- writes a RowRevision every time, noting that the change came over the
  connector, so History shows where it came from.

## Checking it

```
npm run check:mcp     # needs the dev server and a database
```

32 checks: the derived field guide against the real templates, then the
endpoint itself — auth, tenant isolation against a company made for the purpose,
both write refusals, and that a revoked token stops working at once.
