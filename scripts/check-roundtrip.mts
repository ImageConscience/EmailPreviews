/**
 * Prove that an exported sheet re-imports as the same sheet.
 *
 * The export exists to be uploaded again, and every way that quietly stops
 * being true looks harmless in a diff: writing xlsx cells as values rather than
 * text, dropping the BOM, letting a column list drift. None of it shows up in
 * the file you open -- it shows up as a section count of 5 where it used to say
 * 05, weeks later, in a send.
 *
 * So the values below are chosen to break a naive exporter rather than to look
 * realistic. Run with `npm run check:roundtrip`; no database needed.
 */
import { parseSheetFile } from "../src/lib/sheet.ts";
import { toCsv, toXlsx, exportColumns, takeHiddenFlags, type ExportRow } from "../src/lib/sheet-export.ts";

// Values picked to break a naive exporter, not to look realistic.
const columns = [
  "template", "send_date", "section_count", "subject", "promo_line",
  "grid_collection", "swatches", "band_1",
  "product_1_title", "product_1_price", "product_1_url", "product_1_image",
  "product_5_title", "product_5_price", "intro", "nasty",
];

const rows: ExportRow[] = [
  {
    hidden: false,
    data: {
      template: "Ranked List",
      send_date: "2026-09-07",              // must not become a date serial
      section_count: "05",                  // must not lose its leading zero
      subject: "The five that never leave",
      promo_line: "Free Shipping on All Orders Over $150 — US & Worldwide",
      grid_collection: "fall-faves | price-desc | 4 | 2",   // a collection block
      swatches: "#f4dcc8, #e3bfa1, #c9a083, #a67b5b",
      band_1: "Burgundy | Four Styles | The colour the season turned on. | #590529 | #f3e6ec",
      product_1_title: "Sierra — Black Vegan Leather",       // a picked product
      product_1_price: "$179.00",           // must not become 179
      product_1_url: "https://burjushoes.com/products/sierra-black",
      product_1_image: "https://cdn.shopify.com/s/files/1/0794/x.jpg?v=1769467218",
      product_5_title: "",                  // left empty: the collection fills it
      product_5_price: "",
      intro: 'A line with "quotes", a comma, and\na newline in it.',
      nasty: "=1+1",                        // must survive as text, not a formula
    },
  },
  { hidden: true, data: { template: "Split Story", send_date: "2026-09-10", subject: "Rejected row", intro: "Truly Nude™ · 50% off" } },
  { hidden: false, data: { template: "Palette Block", section_count: "0", subject: "Zero, not blank", nasty: "  padded  " } },
];

const cols = exportColumns(columns, rows);

function expected(row: ExportRow) {
  const out: Record<string, string> = {};
  for (const c of cols) out[c] = (row.data[c] ?? "").trim();   // the parser trims
  return out;
}

let failures = 0;
function check(label: string, got: Record<string, string>[], hidden: boolean[]) {
  rows.forEach((row, i) => {
    const want = expected(row);
    for (const c of cols) {
      if ((got[i]?.[c] ?? "<missing row>") !== want[c]) {
        failures++;
        console.log(`  ${label} row ${i} "${c}": got ${JSON.stringify(got[i]?.[c])}, want ${JSON.stringify(want[c])}`);
      }
    }
    if (hidden[i] !== row.hidden) {
      failures++;
      console.log(`  ${label} row ${i} hidden: got ${hidden[i]}, want ${row.hidden}`);
    }
  });
  if (Object.keys(got[0] ?? {}).length !== cols.length) {
    failures++;
    console.log(`  ${label}: column count ${Object.keys(got[0] ?? {}).length} != ${cols.length}`);
  }
}

const csv = Buffer.from(toCsv(cols, rows), "utf8");
check("csv", ...(await (async () => { const p = takeHiddenFlags(await parseSheetFile("s.csv", csv)); return [p.rows, p.hidden] as const; })()));

const xlsx = await toXlsx("September sends", cols, rows);
check("xlsx", ...(await (async () => { const p = takeHiddenFlags(await parseSheetFile("s.xlsx", xlsx)); return [p.rows, p.hidden] as const; })()));

console.log(failures === 0 ? "ROUND TRIP OK — csv and xlsx both reproduce every cell" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
