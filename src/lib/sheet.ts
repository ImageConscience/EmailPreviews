/**
 * Ingest .xlsx / .xls / .csv / .tsv uploads into plain records.
 *
 * The uploaded file is a one-time import: after this runs the app owns the
 * data as ContentSheet + SheetRow records, and the original file is not kept.
 */
import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, string>[];
}

/** ExcelJS cells can be dates, formulas, hyperlinks or rich text -- flatten all of it. */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    // Dates in content sheets are almost always calendar dates, not instants.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
    }
    // A hyperlink cell: prefer the target, since that is what a template needs.
    if (typeof v.hyperlink === "string") return v.hyperlink;
    if ("result" in v) return cellToString(v.result);
    if (typeof v.text === "string") return v.text;
    if ("error" in v) return "";
  }
  return String(value);
}

/** Blank and duplicate headers would silently collide, so give them stable names. */
function normalizeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    let name = (header ?? "").toString().trim();
    if (!name) name = `column_${index + 1}`;
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

function toRecords(headers: string[], rows: string[][]): ParsedSheet {
  const columns = normalizeHeaders(headers);
  const records: Record<string, string>[] = [];
  for (const cells of rows) {
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // skip blank lines
    const record: Record<string, string> = {};
    columns.forEach((column, i) => {
      record[column] = (cells[i] ?? "").toString().trim();
    });
    records.push(record);
  }
  return { columns, rows: records };
}

function parseDelimited(text: string): ParsedSheet {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), {
    header: false,
    skipEmptyLines: "greedy",
  });
  const table = (result.data ?? []).filter(Array.isArray) as string[][];
  if (table.length === 0) return { columns: [], rows: [] };
  const [headers, ...body] = table;
  return toRecords(headers.map((h) => (h ?? "").toString()), body);
}

async function parseWorkbook(buffer: Buffer, sheetName?: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = sheetName
    ? workbook.worksheets.find((w) => w.name === sheetName) ?? workbook.worksheets[0]
    : workbook.worksheets[0];
  if (!worksheet) return { columns: [], rows: [] };

  const table: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // `values` is 1-indexed in ExcelJS; index 0 is always empty.
    const values = row.values as unknown[];
    for (let i = 1; i < values.length; i += 1) cells.push(cellToString(values[i]));
    table.push(cells);
  });

  if (table.length === 0) return { columns: [], rows: [] };
  const [headers, ...body] = table;
  const width = Math.max(...table.map((r) => r.length));
  while (headers.length < width) headers.push("");
  return toRecords(headers, body);
}

export async function parseSheetFile(
  filename: string,
  buffer: Buffer,
  sheetName?: string,
): Promise<ParsedSheet> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    return parseDelimited(buffer.toString("utf8"));
  }
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") {
    return parseWorkbook(buffer, sheetName);
  }
  throw new Error(`Unsupported file type ".${ext}". Upload a .csv, .tsv or .xlsx file.`);
}

/** Worksheet names in an uploaded workbook, so the user can pick one. */
export async function listWorksheets(filename: string, buffer: Buffer): Promise<string[]> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (!["xlsx", "xlsm", "xls"].includes(ext)) return [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook.worksheets.map((w) => w.name);
}
