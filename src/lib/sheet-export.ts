/**
 * Writing a sheet back out in the shape it came in.
 *
 * The point of this file is the round trip, not the download: what comes out
 * has to go back through `parseSheetFile` and produce the same records. That is
 * a stronger requirement than "a readable spreadsheet", and it decides most of
 * what is here -- every cell is written as text, values are taken raw, and the
 * column order is the sheet's own.
 *
 * What is deliberately *not* exported is as important. A product picked into a
 * slot is already stored as ordinary cells, so it exports as cells and comes
 * back as one. A collection block is stored as the spec that drives it
 * (`handle | order | count | skip`) and its product slots are left empty,
 * because they are filled at render time rather than saved. Exporting the
 * filled slots instead would look more complete and would quietly break the
 * block: on re-import those slots would be occupied, and an occupied slot beats
 * the collection. The empty cells are the fidelity.
 */
import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Carries the hidden flag through a round trip.
 *
 * Without it, exporting and re-importing silently un-hides every row someone
 * rejected -- rows come back visible and land in the sendable set. The
 * importer consumes this column and drops it, so it never becomes a field a
 * template could see.
 */
export const HIDDEN_COLUMN = "__hidden";

export interface ExportRow {
  data: Record<string, string>;
  hidden: boolean;
}

/**
 * The sheet's own column order, plus anything a row carries that the column
 * list has lost track of.
 *
 * Those stragglers should not happen -- `saveRowAction` adds new keys to the
 * sheet as it writes them -- but an export that drops data because of a
 * bookkeeping slip is worse than one with an unexpected column on the end.
 */
export function exportColumns(columns: string[], rows: ExportRow[]): string[] {
  const out = [...columns];
  const seen = new Set(columns.map((c) => c.toLowerCase()));
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (seen.has(key.toLowerCase())) continue;
      seen.add(key.toLowerCase());
      out.push(key);
    }
  }
  return out;
}

/** Header row first, then one row per record, as plain strings. */
export function toTable(columns: string[], rows: ExportRow[]): string[][] {
  const headers = [...columns, HIDDEN_COLUMN];
  const body = rows.map((row) => [
    ...columns.map((column) => row.data[column] ?? ""),
    row.hidden ? "yes" : "",
  ]);
  return [headers, ...body];
}

/**
 * Every field quoted, so nothing in the data can be read as structure.
 *
 * A BOM because Excel reads a CSV without one as the system codepage and
 * mangles anything non-ASCII -- "Truly Nude™" and every em dash in the copy.
 * `parseSheetFile` strips it again on the way back in.
 */
export function toCsv(columns: string[], rows: ExportRow[]): string {
  const csv = Papa.unparse(toTable(columns, rows), { quotes: true, newline: "\r\n" });
  return `﻿${csv}`;
}

/**
 * The same table as a workbook, with every cell forced to text.
 *
 * This is the format to edit in. A spreadsheet left to its own judgement reads
 * `05` as the number five and `2026-09-02` as a date, and writes back `5` and
 * whatever its locale thinks a date looks like; the section count and every
 * send date in the sheet would not survive a save. Text cells and an `@` format
 * on the column tell it not to try.
 */
export async function toXlsx(name: string, columns: string[], rows: ExportRow[]): Promise<Buffer> {
  const table = toTable(columns, rows);
  const workbook = new ExcelJS.Workbook();
  // A worksheet name cannot carry any of : \ / ? * [ ] and stops at 31 chars.
  const worksheet = workbook.addWorksheet(name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  for (const cells of table) {
    const added = worksheet.addRow(cells);
    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = "@";
      cell.value = typeof cell.value === "string" ? cell.value : (cell.value ?? "").toString();
    });
  }

  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.numFmt = "@";
    // Wide enough to read a heading, narrow enough that 80 of them are usable.
    column.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Pull the hidden flag back out of a parsed upload.
 *
 * Anything that reads as a yes counts, because the column survives a trip
 * through a spreadsheet that may have rewritten it -- and a row marked hidden
 * in any recognisable way should stay hidden rather than quietly come back.
 */
export function takeHiddenFlags(parsed: { columns: string[]; rows: Record<string, string>[] }): {
  columns: string[];
  rows: Record<string, string>[];
  hidden: boolean[];
} {
  const column = parsed.columns.find((c) => c.trim().toLowerCase() === HIDDEN_COLUMN);
  if (!column) {
    return { columns: parsed.columns, rows: parsed.rows, hidden: parsed.rows.map(() => false) };
  }

  const truthy = new Set(["yes", "y", "true", "1", "hidden"]);
  const hidden = parsed.rows.map((row) => truthy.has((row[column] ?? "").trim().toLowerCase()));
  const rows = parsed.rows.map((row) => {
    const next = { ...row };
    delete next[column];
    return next;
  });
  return { columns: parsed.columns.filter((c) => c !== column), rows, hidden };
}

/** `September sends` -> `september-sends-2026-09-01.xlsx`. */
export function exportFilename(name: string, extension: "csv" | "xlsx"): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sheet";
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
