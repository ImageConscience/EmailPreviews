/**
 * What survives the trip from a whole email into a Klaviyo HTML block.
 *
 * Two of these are the kind of thing that looks fine in a desktop preview and
 * is wrong in an inbox -- a dropped media query, a doubled preheader -- so they
 * are checked against a real template rather than a snippet.
 */
import { readFileSync } from "node:fs";
import { toBlockContent, findContentBlock, CONTENT_MARKER } from "../src/lib/block-content.ts";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

console.log("Extracting from a real template");
const real = readFileSync("templates/burju-shoes/01-hero-editorial.html", "utf8");
const out = toBlockContent(real);

check("the doctype is gone", !/<!doctype/i.test(out.html));
check("the html and head tags are gone", !/<html[\s>]/i.test(out.html) && !/<head[\s>]/i.test(out.html));
check("the body tags are gone", !/<body[\s>]/i.test(out.html) && !/<\/body>/i.test(out.html));
check("the content itself survived", out.html.includes("{{ promo_line }}") && out.html.includes("{{ headline_1 }}"));

check("the mobile media query came along", /@media only screen and \(max-width:620px\)/.test(out.html));
check("...and so did the rules inside it", /\.imgband\s*\{/.test(out.html) && /\.col\s*\{/.test(out.html));
check("the style block sits before the content", out.html.indexOf("<style") < out.html.indexOf("<table"));
check("moving the style block is flagged", out.notes.some((n) => /mobile layout/.test(n)));

check("the hidden preheader was removed", !out.html.includes("{{ preheader }}"));
check("...and that is flagged too", out.notes.some((n) => /preheader/.test(n)));

// A `display:none` element that is not the preheader must be left alone.
const withLater = `<html><head></head><body><table>x</table>${"y".repeat(500)}<div style="display:none">keep me</div></body></html>`;
check("a display:none element further down is kept", toBlockContent(withLater).html.includes("keep me"));

// A fragment with no document wrapper should pass through.
check("a bare fragment passes through", toBlockContent("<table>hi</table>").html === "<table>hi</table>");

console.log("\nFinding the block to fill");
const htmlBlock = (content: string) => ({ content_type: "block", type: "html", data: { content } });
const textBlock = { content_type: "block", type: "text", data: { content: "words" } };
const wrap = (blocks: unknown[]) => ({
  body: { sections: [{ data: { rows: [{ columns: [{ blocks }] }] } }] },
});

const one = findContentBlock(wrap([textBlock, htmlBlock("<p>placeholder</p>")]));
check("a single HTML block needs no marker", "block" in one);

const marked = findContentBlock(
  wrap([htmlBlock("header bits"), htmlBlock(`<!-- ${CONTENT_MARKER} -->`), htmlBlock("footer bits")]),
);
check("the marker picks one out of several", "block" in marked && marked.block.data?.content?.includes(CONTENT_MARKER));

const none = findContentBlock(wrap([textBlock]));
check("no HTML block is an explained refusal", "error" in none && /has no HTML block/.test(none.error),
  "error" in none ? none.error.slice(0, 60) + "…" : "");

const ambiguous = findContentBlock(wrap([htmlBlock("a"), htmlBlock("b")]));
check("several unmarked blocks are refused, not guessed", "error" in ambiguous && /no way to tell which one/.test(ambiguous.error));

const twice = findContentBlock(wrap([htmlBlock(`<!-- ${CONTENT_MARKER} -->`), htmlBlock(`x <!-- ${CONTENT_MARKER} -->`)]));
check("two marked blocks are refused", "error" in twice && /Leave it in only one/.test(twice.error));

// Nesting: real definitions bury blocks several levels down, and the marker
// must still be found wherever the person dropped it.
const deep = { body: { sections: [{ data: { rows: [{ columns: [{ blocks: [] }] } ] } },
  { data: { rows: [{ columns: [{ blocks: [textBlock] }, { blocks: [htmlBlock("only one")] }] }] } }] } };
check("a block nested in a later section is found", "block" in findContentBlock(deep));

check("rubbish in is refused, not crashed on", "error" in findContentBlock(null) && "error" in findContentBlock("nope"));

console.log(bad === 0 ? "\nALL BLOCK CHECKS PASSED" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
