/**
 * Turn the SFS Email Content Planner workbook into a campaign-content sheet.
 *
 * The planner is transposed relative to what the app wants: its rows are
 * fields and its columns are month x option, so one email is a *column* there
 * and a *row* here. Each series tab therefore yields 6 months x 3 options = 18
 * rows, one per option so every alternative can be previewed and approved
 * rather than chosen in a spreadsheet first.
 *
 *   node scripts/planner-to-content.mjs <planner.xlsx> [outDir]
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ExcelJS from "exceljs";

const IMAGES = "https://emailpreviews-production.up.railway.app/brand/";
const SITE = "https://www.safetyfacilityservices.com";
const P1 = "https://www.p1pestsolutions.com";

/** Placeholder photos stand in until real art is sourced per campaign. */
const SAMPLE_HERO = {
  "Core Service": `${IMAGES}sample-hero-team.jpg`,
  Seasonal: `${IMAGES}sample-hero-seasonal.jpg`,
  "Pest Control": `${IMAGES}sample-hero-pest.jpg`,
};

/**
 * Which planner row feeds which placeholder, per series tab. Row numbers are
 * the planner's own; `fixed` values are ones the planner states as constants.
 */
const SERIES = [
  {
    tab: "1. Core Service",
    template: "Core Service",
    planningRow: 5,
    fields: {
      subject: 7,
      preheader: 8,
      eyebrow: 12,
      headline: 13,
      hero_alt: 14,
      body_paragraph_1: 15,
      body_paragraph_2: 16,
      points_label: 17,
      point_1_title: 18,
      point_1_body: 19,
      point_2_title: 20,
      point_2_body: 21,
      point_3_title: 22,
      point_3_body: 23,
      aside_label: 24,
      aside_body: 25,
    },
    constants: {},
  },
  {
    tab: "2. Seasonal",
    template: "Seasonal",
    planningRow: 5,
    fields: {
      subject: 7,
      preheader: 8,
      eyebrow: 12,
      headline: 13,
      hero_alt: 14,
      body_paragraph_1: 15,
      body_paragraph_2: 16,
      cta_text: 17,
      tip_label: 18,
      tip_headline: 19,
      tip_body: 20,
      tip_link_text: 21,
      note_label: 22,
      note_body: 23,
    },
    constants: { cta_url: `${SITE}/request-a-quote`, tip_link_url: `${SITE}/services` },
  },
  {
    tab: "3. Pest (P1)",
    template: "Pest Control",
    planningRow: 5,
    fields: {
      subject: 7,
      preheader: 8,
      issue_date: 6,
      headline: 10,
      hero_alt: 11,
      body_paragraph_1: 12,
      body_paragraph_2: 13,
      cta_text: 14,
      points_label: 15,
      point_1_title: 16,
      point_1_body: 17,
      point_2_title: 18,
      point_2_body: 19,
      point_3_title: 20,
      point_3_body: 21,
      note_label: 22,
      note_body: 23,
    },
    constants: { cta_url: `${P1}/site-inspection` },
  },
];

const COLUMNS = [
  "template", "send_month", "option", "subject", "preheader",
  "hero_image", "hero_alt", "eyebrow", "issue_date", "headline",
  "body_paragraph_1", "body_paragraph_2",
  "cta_url", "cta_text",
  "tip_label", "tip_headline", "tip_body", "tip_link_url", "tip_link_text",
  "points_label", "point_1_title", "point_1_body", "point_2_title",
  "point_2_body", "point_3_title", "point_3_body",
  "aside_label", "aside_body",
  "note_label", "note_body",
];

function text(cell) {
  const value = cell?.value;
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value.richText)) return value.richText.map((r) => r.text ?? "").join("").trim();
  if (typeof value.text === "string") return value.text.trim();
  if ("result" in value) return String(value.result ?? "").trim();
  return String(value).trim();
}

/**
 * A planner row may be filled per option, per month, or once for the whole
 * series. Fall back through those in turn so each reads correctly either way.
 */
function valueAt(ws, row, monthCol, optionCol) {
  return text(ws.getCell(row, optionCol)) || text(ws.getCell(row, monthCol)) || text(ws.getCell(row, 4));
}

/** The planner annotates its constants, e.g. "SAFETY TIP  (fixed label...)". */
function stripNote(value) {
  return value.replace(/\s*\((?:fixed|current)[^)]*\)\s*$/i, "").trim();
}

const [, , plannerPath, outDirArg] = process.argv;
if (!plannerPath) {
  console.error("usage: node scripts/planner-to-content.mjs <planner.xlsx> [outDir]");
  process.exit(1);
}
const outDir = outDirArg ?? resolve(dirname(new URL(import.meta.url).pathname), "../content-sheets");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(plannerPath);

const rows = [];
for (const series of SERIES) {
  const ws = workbook.getWorksheet(series.tab);
  if (!ws) throw new Error(`planner has no tab "${series.tab}"`);

  for (let month = 0; month < 6; month += 1) {
    const monthCol = 4 + month * 3;
    const sendMonth = text(ws.getCell(series.planningRow, monthCol));
    if (!sendMonth) continue;

    for (let option = 0; option < 3; option += 1) {
      const optionCol = monthCol + option;
      const row = {
        template: series.template,
        send_month: sendMonth,
        option: "ABC"[option],
        hero_image: SAMPLE_HERO[series.template],
        ...series.constants,
      };
      for (const [field, plannerRow] of Object.entries(series.fields)) {
        row[field] = stripNote(valueAt(ws, plannerRow, monthCol, optionCol));
      }
      rows.push(row);
    }
  }
}

function csvCell(value) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
const csv = [
  COLUMNS.map(csvCell).join(","),
  ...rows.map((row) => COLUMNS.map((c) => csvCell(row[c] ?? "")).join(",")),
].join("\r\n");
writeFileSync(`${outDir}/campaign-content.csv`, "﻿" + csv, "utf8");

const out = new ExcelJS.Workbook();
out.creator = "Email Previews";
const sheet = out.addWorksheet("Campaigns");
sheet.addRow(COLUMNS);
rows.forEach((row) => sheet.addRow(COLUMNS.map((c) => row[c] ?? "")));
sheet.getRow(1).font = { bold: true };
sheet.columns.forEach((c) => {
  c.width = 34;
});
sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
await out.xlsx.writeFile(`${outDir}/campaign-content.xlsx`);

const bySeries = {};
for (const row of rows) bySeries[row.template] = (bySeries[row.template] ?? 0) + 1;
console.log(`${rows.length} campaign rows, ${COLUMNS.length} columns`);
for (const [template, count] of Object.entries(bySeries)) console.log(`  ${template}: ${count}`);
