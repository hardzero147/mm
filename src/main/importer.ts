import fs from "node:fs";
import path from "node:path";
import type { PartInput, ReferenceOptions } from "../shared/types";

const MAIN_SHEETS = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];

const HEADERS = [
  "no",
  "plant",
  "location",
  "machineCode",
  "machineName",
  "device",
  "brand",
  "model",
  "quantity",
  "softwareSupport",
  "statusOfParts",
  "mtStore",
  "secondHand",
  "actionByMaker",
  "actionByMt",
  "howToSolution"
] as const;

type HeaderKey = (typeof HEADERS)[number];
type RawRow = Record<HeaderKey, string>;

export interface ParsedWorkbook {
  filePath: string;
  records: PartInput[];
  references: ReferenceOptions;
  sheetCounts: Record<string, number>;
  skippedRows: string[];
  duplicateGroups: number;
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value).trim();
  }

  if (typeof value === "object" && "text" in (value as object)) {
    return String((value as { text: unknown }).text ?? "").replace(/\s+/g, " ").trim();
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function canonical(value: string): string {
  return cleanCell(value).toUpperCase();
}

export function buildImportKey(record: PartInput): string {
  return [
    record.sourceSheet,
    record.plant,
    record.location,
    record.machineCode,
    record.machineName,
    record.device,
    record.brand,
    record.model
  ]
    .map((part) => canonical(part))
    .join("|");
}

function normalizeRowValues(values: unknown[]): RawRow {
  return HEADERS.reduce((acc, key, index) => {
    // exceljs row.values is 1-indexed (index 0 is undefined), skip index 0
    acc[key] = cleanCell(values[index + 1]);
    return acc;
  }, {} as RawRow);
}

function hasPartIdentity(row: RawRow): boolean {
  return Boolean(row.device || row.brand || row.model);
}

export async function parseWorkbook(filePath: string): Promise<ParsedWorkbook> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.readFile(filePath);

  const records: PartInput[] = [];
  const sheetCounts: Record<string, number> = {};
  const skippedRows: string[] = [];

  for (const sheetName of MAIN_SHEETS) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      skippedRows.push(`Missing sheet: ${sheetName}`);
      continue;
    }

    const carry = {
      no: "",
      plant: "",
      location: "",
      machineCode: "",
      machineName: ""
    };

    let count = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 2) return; // skip header rows

      const values = row.values as unknown[];
      const rawRow = normalizeRowValues(values);
      const hasAnyValue = Object.values(rawRow).some(Boolean);

      if (!hasAnyValue) {
        return;
      }

      for (const key of ["no", "plant", "location", "machineCode", "machineName"] as const) {
        if (rawRow[key]) {
          carry[key] = rawRow[key];
        } else {
          rawRow[key] = carry[key];
        }
      }

      if (!hasPartIdentity(rawRow)) {
        skippedRows.push(`${sheetName} row ${rowNumber}: no Device/Brand/Model`);
        return;
      }

      records.push({
        sourceSheet: sheetName,
        plant: rawRow.plant,
        location: rawRow.location,
        machineCode: rawRow.machineCode,
        machineName: rawRow.machineName,
        device: rawRow.device,
        brand: rawRow.brand,
        model: rawRow.model,
        quantity: rawRow.quantity,
        softwareSupport: rawRow.softwareSupport,
        statusOfParts: rawRow.statusOfParts,
        mtStore: rawRow.mtStore,
        secondHand: rawRow.secondHand,
        actionByMaker: rawRow.actionByMaker,
        actionByMt: rawRow.actionByMt,
        howToSolution: rawRow.howToSolution
      });
      count += 1;
    });

    sheetCounts[sheetName] = count;
  }

  // Parse reference options from OTHER sheet
  const references = parseReferenceOptions(workbook);

  const duplicateCounts = new Map<string, number>();
  for (const record of records) {
    const key = buildImportKey(record);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const duplicateGroups = Array.from(duplicateCounts.values()).filter((value) => value > 1).length;

  return {
    filePath: path.resolve(filePath),
    records,
    references,
    sheetCounts,
    skippedRows,
    duplicateGroups
  };
}

function parseReferenceOptions(workbook: import("exceljs").Workbook): ReferenceOptions {
  const sheet = workbook.getWorksheet("OTHER");
  if (!sheet) {
    return { devices: [], brands: [] };
  }

  const devices = new Set<string>();
  const brands = new Set<string>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    const values = row.values as unknown[];
    const device = cleanCell(values[5]); // column E (1-indexed)
    const brand = cleanCell(values[6]);  // column F (1-indexed)
    if (device) devices.add(device);
    if (brand) brands.add(brand);
  });

  return {
    devices: Array.from(devices).sort((a, b) => a.localeCompare(b)),
    brands: Array.from(brands).sort((a, b) => a.localeCompare(b))
  };
}
