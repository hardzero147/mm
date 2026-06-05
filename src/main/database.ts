import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type * as ExcelJSNamespace from "exceljs";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  type AppDataSnapshot,
  type AppStats,
  type ImportCommitResult,
  type ImportPreview,
  type ImportRun,
  type PartInput,
  type PartRecord,
  type ReferenceOptions
} from "../shared/types";
import { hasSpareValue } from "../shared/spare";
import type { ParsedWorkbook } from "./importer";

type DbRow = Record<string, unknown>;

const FIELD_NAMES = [
  "sourceSheet",
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

const EXPORT_SHEETS = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"] as const;
const OTHER_EXPORT_SHEET = "OTHER";

const PLANT_GROUP_BY_CODE: Record<string, (typeof EXPORT_SHEETS)[number]> = {
  "100": "P100",
  "0100": "P100",
  "1100": "P100",
  "1200": "P200",
  "1300": "P300 BC",
  "400": "P400",
  "0400": "P400",
  "600": "P600",
  "0600": "P600"
};

const EXPORT_HEADERS = [
  [
    "No.",
    "Plant",
    "Location",
    "Machine Code",
    "Machine Name",
    "Device",
    "Brand",
    "Model",
    "Quantity",
    "Software Support",
    "Status of parts",
    "Spare parts",
    "",
    "Breakdown Recovery",
    ""
  ],
  ["", "", "", "", "", "", "", "", "", "", "", " MT store", "Second hand", "Action by Maker", "Action by MT"]
] as const;

const EXPORT_COLUMN_WIDTHS = [6.2, 16.6, 22.6, 21.1, 21.1, 21.1, 27.9, 53.9, 13.6, 28.4, 23.8, 19.4, 18.6, 22.6, 18.5];

let sqlPromise: Promise<SqlJsStatic> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function clean(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function normalizePlantCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function exportSheetFromSource(sourceSheet: string, location: string): (typeof EXPORT_SHEETS)[number] | "" {
  const normalized = sourceSheet.trim().toUpperCase();
  const exact = EXPORT_SHEETS.find((sheetName) => sheetName === normalized);
  if (exact) {
    return exact;
  }

  const group = normalized.match(/P\d+/)?.[0] ?? "";
  if (group === "P300") {
    return location.toUpperCase().includes("NOC") ? "P300 NOC" : "P300 BC";
  }

  return EXPORT_SHEETS.find((sheetName) => sheetName === group) ?? "";
}

function inferExportSheet(part: PartRecord): (typeof EXPORT_SHEETS)[number] | typeof OTHER_EXPORT_SHEET {
  const fromSource = exportSheetFromSource(part.sourceSheet, part.location);
  if (fromSource) {
    return fromSource;
  }

  // Handle P100–P600 stored directly as plant value (from form dropdown)
  const fromPlantAsSource = exportSheetFromSource(part.plant, part.location);
  if (fromPlantAsSource) {
    return fromPlantAsSource;
  }

  const code = normalizePlantCode(part.plant);
  const fromPlant = PLANT_GROUP_BY_CODE[code];
  if (fromPlant === "P300 BC") {
    return part.location.toUpperCase().includes("NOC") ? "P300 NOC" : "P300 BC";
  }

  return fromPlant ?? OTHER_EXPORT_SHEET;
}

function exportSheetOrder(sheetName: string): number {
  const index = EXPORT_SHEETS.findIndex((candidate) => candidate === sheetName);
  return index === -1 ? EXPORT_SHEETS.length : index;
}

function machineGroupKey(part: PartRecord): string {
  return [inferExportSheet(part), part.plant, part.location, part.machineCode, part.machineName].join("|");
}

function importIdentityKey(importKey: string, duplicateIndex: number): string {
  return `${importKey}\u0000${duplicateIndex}`;
}

function canonicalImportValue(value: string): string {
  return clean(value).replace(/\s+/g, " ").trim().toUpperCase();
}

function buildImportKey(record: PartInput): string {
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
    .map((part) => canonicalImportValue(part))
    .join("|");
}

async function parseWorkbookLazy(filePath: string): Promise<ParsedWorkbook> {
  const { parseWorkbook } = await import("./importer");
  return await parseWorkbook(filePath);
}

async function loadExcelJs(): Promise<typeof import("exceljs")> {
  return await import("exceljs");
}

function excelValue(value: string): string | number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && !/^0\d/.test(trimmed)) {
    return Number(trimmed);
  }
  return value;
}

function applyExportWorksheetLayout(worksheet: ExcelJSNamespace.Worksheet, rowCount: number): void {
  const headerMerges = [
    "A1:A2",
    "B1:B2",
    "C1:C2",
    "D1:D2",
    "E1:E2",
    "F1:F2",
    "G1:G2",
    "H1:H2",
    "I1:I2",
    "J1:J2",
    "K1:K2",
    "L1:M1",
    "N1:O1"
  ];

  EXPORT_COLUMN_WIDTHS.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  for (let row = 1; row <= rowCount; row += 1) {
    worksheet.getRow(row).height = 25.5;
  }

  headerMerges.forEach((range) => worksheet.mergeCells(range));
}

function applyExportCellStyle(cell: ExcelJSNamespace.Cell, bold = false): void {
  const border = {
    top: { style: "thin" as const, color: { argb: "FF000000" } },
    bottom: { style: "thin" as const, color: { argb: "FF000000" } },
    left: { style: "thin" as const, color: { argb: "FF000000" } },
    right: { style: "thin" as const, color: { argb: "FF000000" } }
  };

  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.font = { bold, color: { argb: "FF000000" } };
  cell.border = border;
}

function applyExportRowStyles(worksheet: ExcelJSNamespace.Worksheet, rowCount: number): void {
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < 15; column += 1) {
      applyExportCellStyle(worksheet.getCell(row + 1, column + 1), row < 2);
    }
  }
}

function mergeExportMachineRows(
  worksheet: ExcelJSNamespace.Worksheet,
  startRow: number,
  partRows: Array<Pick<PartRecord, "device" | "brand">>
): void {
  if (partRows.length > 1) {
    for (let column = 1; column <= 5; column += 1) {
      worksheet.mergeCells(startRow, column, startRow + partRows.length - 1, column);
    }
  }

  let runStart = 0;
  for (let index = 1; index <= partRows.length; index += 1) {
    const startsNextDevice = index < partRows.length && Boolean(partRows[index].device || partRows[index].brand);
    if (index !== partRows.length && !startsNextDevice) {
      continue;
    }

    const runEnd = index - 1;
    if (runEnd > runStart) {
      for (let column = 6; column <= 7; column += 1) {
        worksheet.mergeCells(startRow + runStart, column, startRow + runEnd, column);
      }
    }
    runStart = index;
  }
}

function normalizeRecord(input: PartInput): PartInput {
  return {
    id: input.id,
    sourceSheet: clean(input.sourceSheet),
    plant: clean(input.plant),
    location: clean(input.location),
    machineCode: clean(input.machineCode),
    machineName: clean(input.machineName),
    device: clean(input.device),
    brand: clean(input.brand),
    model: clean(input.model),
    quantity: clean(input.quantity),
    softwareSupport: clean(input.softwareSupport),
    statusOfParts: clean(input.statusOfParts),
    mtStore: clean(input.mtStore),
    secondHand: clean(input.secondHand),
    actionByMaker: clean(input.actionByMaker),
    actionByMt: clean(input.actionByMt),
    howToSolution: clean(input.howToSolution)
  };
}

function rowToPart(row: DbRow): PartRecord {
  return {
    id: Number(row.id),
    sourceSheet: clean(row.source_sheet),
    importKey: clean(row.import_key),
    duplicateIndex: Number(row.duplicate_index ?? 0),
    plant: clean(row.plant),
    location: clean(row.location),
    machineCode: clean(row.machine_code),
    machineName: clean(row.machine_name),
    device: clean(row.device),
    brand: clean(row.brand),
    model: clean(row.model),
    quantity: clean(row.quantity),
    softwareSupport: clean(row.software_support),
    statusOfParts: clean(row.status_of_parts),
    mtStore: clean(row.mt_store),
    secondHand: clean(row.second_hand),
    actionByMaker: clean(row.action_by_maker),
    actionByMt: clean(row.action_by_mt),
    howToSolution: clean(row.how_to_solution),
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
    lastImportedAt: clean(row.last_imported_at)
  };
}

function rowValuesToPart(row: unknown[], columnIndex: Record<string, number>): PartRecord {
  const value = (column: string): unknown => {
    const index = columnIndex[column];
    return index === undefined ? "" : row[index];
  };

  return {
    id: Number(value("id")),
    sourceSheet: clean(value("source_sheet")),
    importKey: clean(value("import_key")),
    duplicateIndex: Number(value("duplicate_index") ?? 0),
    plant: clean(value("plant")),
    location: clean(value("location")),
    machineCode: clean(value("machine_code")),
    machineName: clean(value("machine_name")),
    device: clean(value("device")),
    brand: clean(value("brand")),
    model: clean(value("model")),
    quantity: clean(value("quantity")),
    softwareSupport: clean(value("software_support")),
    statusOfParts: clean(value("status_of_parts")),
    mtStore: clean(value("mt_store")),
    secondHand: clean(value("second_hand")),
    actionByMaker: clean(value("action_by_maker")),
    actionByMt: clean(value("action_by_mt")),
    howToSolution: clean(value("how_to_solution")),
    createdAt: clean(value("created_at")),
    updatedAt: clean(value("updated_at")),
    lastImportedAt: clean(value("last_imported_at"))
  };
}

function rowToImportRun(row: DbRow | undefined): ImportRun | null {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    filePath: clean(row.file_path),
    importedAt: clean(row.imported_at),
    newCount: Number(row.new_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    unchangedCount: Number(row.unchanged_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    totalRows: Number(row.total_rows ?? 0)
  };
}

function partChanged(existing: PartRecord, incoming: PartInput): boolean {
  return FIELD_NAMES.some((field) => existing[field] !== clean(incoming[field]));
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => {
        const candidates = [
          path.join(process.resourcesPath ?? "", file),
          path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file),
          path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", file)
        ];
        return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[candidates.length - 1];
      }
    });
  }

  return sqlPromise;
}

function getDefaultDbPath(): string {
  return path.join(app.getPath("userData"), "electrical-parts.sqlite");
}

function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export class PartsDatabase {
  private db: Database | null = null;
  private dbPath = getDefaultDbPath();

  get path(): string {
    return this.dbPath;
  }

  async initialize(dbPath = getDefaultDbPath()): Promise<void> {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    const SQL = await getSql();
    this.db?.close();
    this.db = null;

    if (fs.existsSync(this.dbPath)) {
      const file = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(file);
    } else {
      this.db = new SQL.Database();
    }

    this.migrate();
    await this.seedFromDefaultWorkbookIfEmpty();
    this.save();
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("Database has not been initialized.");
    }

    return this.db;
  }

  private save(): void {
    const db = this.requireDb();
    const data = db.export();
    const tempPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tempPath, Buffer.from(data));
    fs.renameSync(tempPath, this.dbPath);
  }

  private migrate(): void {
    const db = this.requireDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_sheet TEXT NOT NULL DEFAULT '',
        import_key TEXT NOT NULL,
        duplicate_index INTEGER NOT NULL DEFAULT 0,
        plant TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        machine_code TEXT NOT NULL DEFAULT '',
        machine_name TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        quantity TEXT NOT NULL DEFAULT '',
        software_support TEXT NOT NULL DEFAULT '',
        status_of_parts TEXT NOT NULL DEFAULT '',
        mt_store TEXT NOT NULL DEFAULT '',
        second_hand TEXT NOT NULL DEFAULT '',
        action_by_maker TEXT NOT NULL DEFAULT '',
        action_by_mt TEXT NOT NULL DEFAULT '',
        how_to_solution TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_imported_at TEXT NOT NULL DEFAULT '',
        UNIQUE(import_key, duplicate_index)
      );

      CREATE TABLE IF NOT EXISTS import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        new_count INTEGER NOT NULL,
        updated_count INTEGER NOT NULL,
        unchanged_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        total_rows INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reference_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        option_type TEXT NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(option_type, value)
      );

      CREATE INDEX IF NOT EXISTS idx_parts_machine ON parts(machine_name, machine_code);
      CREATE INDEX IF NOT EXISTS idx_parts_filters ON parts(plant, location, device, brand, status_of_parts);
      CREATE INDEX IF NOT EXISTS idx_parts_import_key ON parts(import_key, duplicate_index);
      CREATE INDEX IF NOT EXISTS idx_parts_snapshot_order ON parts(source_sheet, plant, location, machine_name, machine_code, id);
    `);
  }

  private async seedFromDefaultWorkbookIfEmpty(): Promise<void> {
    const defaultWorkbook = "C:\\Users\\preec\\Downloads\\MASTER ELECTRICAL PARTS PACKING MACHINE.xlsx";
    const existingCount = Number(this.queryValue("SELECT COUNT(*) AS count FROM parts") ?? 0);
    const isDefaultDatabase = path.resolve(this.dbPath).toLowerCase() === path.resolve(getDefaultDbPath()).toLowerCase();

    if (isDefaultDatabase && existingCount === 0 && fs.existsSync(defaultWorkbook)) {
      await this.commitImport(defaultWorkbook);
    }
  }

  getSnapshot(): AppDataSnapshot {
    const parts = this.getAllParts();
    return {
      parts,
      stats: this.calculateStats(parts),
      lastImport: this.getLastImport(),
      references: this.getReferenceOptions(),
      databasePath: this.dbPath
    };
  }

  getAllParts(): PartRecord[] {
    const statement = this.requireDb().prepare(`
      SELECT * FROM parts
      ORDER BY source_sheet, plant, location, machine_name, machine_code, id
    `);
    try {
      const columnIndex = Object.fromEntries(statement.getColumnNames().map((column, index) => [column, index]));
      const parts: PartRecord[] = [];
      while (statement.step()) {
        parts.push(rowValuesToPart(statement.get(), columnIndex));
      }
      return parts;
    } finally {
      statement.free();
    }
  }

  getPartById(id: number): PartRecord | null {
    const rows = this.queryRows("SELECT * FROM parts WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? rowToPart(rows[0]) : null;
  }

  getPartsByIds(ids: number[]): PartRecord[] {
    const normalizedIds = Array.from(
      new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );

    if (!normalizedIds.length) {
      return [];
    }

    const parts: PartRecord[] = [];
    const batchSize = 900;
    for (let index = 0; index < normalizedIds.length; index += batchSize) {
      const batch = normalizedIds.slice(index, index + batchSize);
      const placeholders = batch.map(() => "?").join(", ");
      parts.push(...this.queryRows(`SELECT * FROM parts WHERE id IN (${placeholders})`, batch).map(rowToPart));
    }

    return parts;
  }

  savePart(input: PartInput): PartRecord {
    const [saved] = this.saveParts([input]);
    if (!saved) {
      throw new Error("Saved part could not be found.");
    }
    return saved;
  }

  saveParts(inputs: PartInput[]): PartRecord[] {
    if (!inputs.length) {
      return [];
    }

    const db = this.requireDb();
    const timestamp = nowIso();
    const existingById = new Map(
      this.getPartsByIds(inputs.map((input) => input.id ?? 0)).map((part) => [part.id, part])
    );
    const savedParts: PartRecord[] = [];

    db.run("BEGIN TRANSACTION");
    try {
      for (const input of inputs) {
        savedParts.push(this.savePartRecord(input, timestamp, existingById));
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }

    this.save();
    return savedParts;
  }

  private savePartRecord(input: PartInput, timestamp: string, existingById: Map<number, PartRecord>): PartRecord {
    const db = this.requireDb();
    const record = normalizeRecord(input);
    const importKey = buildImportKey(record);

    if (record.id) {
      const existing = existingById.get(record.id);
      if (!existing) {
        throw new Error("Saved part could not be found.");
      }

      db.run(
        `
        UPDATE parts SET
          source_sheet = ?, import_key = ?, plant = ?, location = ?, machine_code = ?,
          machine_name = ?, device = ?, brand = ?, model = ?, quantity = ?,
          software_support = ?, status_of_parts = ?, mt_store = ?, second_hand = ?,
          action_by_maker = ?, action_by_mt = ?, how_to_solution = ?, updated_at = ?
        WHERE id = ?
      `,
        [
          record.sourceSheet,
          importKey,
          record.plant,
          record.location,
          record.machineCode,
          record.machineName,
          record.device,
          record.brand,
          record.model,
          record.quantity,
          record.softwareSupport,
          record.statusOfParts,
          record.mtStore,
          record.secondHand,
          record.actionByMaker,
          record.actionByMt,
          record.howToSolution,
          timestamp,
          record.id
        ]
      );
      return {
        ...record,
        id: existing.id,
        importKey,
        duplicateIndex: existing.duplicateIndex,
        createdAt: existing.createdAt,
        updatedAt: timestamp,
        lastImportedAt: existing.lastImportedAt
      };
    }

    const duplicateIndex = this.nextDuplicateIndex(importKey);
    db.run(
      `
      INSERT INTO parts (
        source_sheet, import_key, duplicate_index, plant, location, machine_code,
        machine_name, device, brand, model, quantity, software_support, status_of_parts,
        mt_store, second_hand, action_by_maker, action_by_mt, how_to_solution,
        created_at, updated_at, last_imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        record.sourceSheet,
        importKey,
        duplicateIndex,
        record.plant,
        record.location,
        record.machineCode,
        record.machineName,
        record.device,
        record.brand,
        record.model,
        record.quantity,
        record.softwareSupport,
        record.statusOfParts,
        record.mtStore,
        record.secondHand,
        record.actionByMaker,
        record.actionByMt,
        record.howToSolution,
        timestamp,
        timestamp,
        ""
      ]
    );

    const inserted = this.getByImportIdentity(importKey, duplicateIndex);
    if (!inserted) {
      throw new Error("Inserted part could not be found.");
    }
    return inserted;
  }

  deletePart(id: number): void {
    const db = this.requireDb();
    db.run("DELETE FROM parts WHERE id = ?", [id]);
    this.save();
  }

  deleteParts(ids: number[]): void {
    const normalizedIds = Array.from(
      new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );

    if (!normalizedIds.length) {
      return;
    }

    const db = this.requireDb();
    db.run("BEGIN TRANSACTION");
    try {
      const batchSize = 900;
      for (let index = 0; index < normalizedIds.length; index += batchSize) {
        const batch = normalizedIds.slice(index, index + batchSize);
        const placeholders = batch.map(() => "?").join(", ");
        db.run(`DELETE FROM parts WHERE id IN (${placeholders})`, batch);
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }

    this.save();
  }

  async previewImport(filePath: string): Promise<ImportPreview> {
    const parsed = await parseWorkbookLazy(filePath);
    const comparison = this.compareImport(parsed.records);

    return {
      filePath: parsed.filePath,
      totalRows: parsed.records.length,
      newCount: comparison.newCount,
      updatedCount: comparison.updatedCount,
      unchangedCount: comparison.unchangedCount,
      skippedCount: parsed.skippedRows.length,
      sheetCounts: parsed.sheetCounts,
      duplicateGroups: parsed.duplicateGroups,
      sampleRows: parsed.records.slice(0, 8),
      skippedRows: parsed.skippedRows.slice(0, 12)
    };
  }

  async commitImport(filePath: string): Promise<ImportCommitResult> {
    const parsed = await parseWorkbookLazy(filePath);
    const db = this.requireDb();
    const timestamp = nowIso();
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const existingByIdentity = this.getImportIdentityMap();

    db.run("BEGIN TRANSACTION");
    try {
      const duplicateTracker = new Map<string, number>();
      for (const rawRecord of parsed.records) {
        const record = normalizeRecord(rawRecord);
        const importKey = buildImportKey(record);
        const duplicateIndex = duplicateTracker.get(importKey) ?? 0;
        duplicateTracker.set(importKey, duplicateIndex + 1);

        const existing = existingByIdentity.get(importIdentityKey(importKey, duplicateIndex));
        if (!existing) {
          this.insertImportedRecord(record, importKey, duplicateIndex, timestamp);
          newCount += 1;
        } else if (partChanged(existing, record)) {
          this.updateImportedRecord(existing.id, record, importKey, timestamp);
          updatedCount += 1;
        } else {
          db.run("UPDATE parts SET last_imported_at = ? WHERE id = ?", [timestamp, existing.id]);
          unchangedCount += 1;
        }
      }

      this.replaceReferenceOptions(parsed.references);
      db.run(
        `
        INSERT INTO import_runs (
          file_path, imported_at, new_count, updated_count, unchanged_count, skipped_count, total_rows
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [parsed.filePath, timestamp, newCount, updatedCount, unchangedCount, parsed.skippedRows.length, parsed.records.length]
      );
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }

    this.save();

    return {
      filePath: parsed.filePath,
      totalRows: parsed.records.length,
      newCount,
      updatedCount,
      unchangedCount,
      skippedCount: parsed.skippedRows.length,
      sheetCounts: parsed.sheetCounts,
      duplicateGroups: parsed.duplicateGroups,
      sampleRows: parsed.records.slice(0, 8),
      skippedRows: parsed.skippedRows.slice(0, 12),
      importedAt: timestamp
    };
  }

  async exportToXlsx(filePath: string): Promise<void> {
    const parts = this.getAllParts().sort((a, b) => {
      const bySheet = exportSheetOrder(inferExportSheet(a)) - exportSheetOrder(inferExportSheet(b));
      return bySheet || a.id - b.id;
    });
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Electrical Parts Manager";
    workbook.created = new Date();
    workbook.modified = new Date();
    const groupedBySheet = new Map<
      string,
      { groups: Array<{ key: string; parts: PartRecord[] }>; groupByKey: Map<string, { key: string; parts: PartRecord[] }> }
    >();

    for (const part of parts) {
      const sheetName = inferExportSheet(part);
      const key = machineGroupKey(part);
      let sheetGroup = groupedBySheet.get(sheetName);
      if (!sheetGroup) {
        sheetGroup = { groups: [], groupByKey: new Map() };
        groupedBySheet.set(sheetName, sheetGroup);
      }

      let group = sheetGroup.groupByKey.get(key);

      if (!group) {
        group = { key, parts: [] };
        sheetGroup.groups.push(group);
        sheetGroup.groupByKey.set(key, group);
      }

      group.parts.push(part);
    }

    const sheetNames = [...EXPORT_SHEETS, ...(groupedBySheet.has(OTHER_EXPORT_SHEET) ? [OTHER_EXPORT_SHEET] : [])];

    for (const sheetName of sheetNames) {
      const worksheet = workbook.addWorksheet(sheetName);
      const rows: Array<Array<string | number | null>> = EXPORT_HEADERS.map((row) =>
        row.map((cell) => (cell ? cell : null))
      );
      const groups = groupedBySheet.get(sheetName)?.groups ?? [];
      let machineNumber = 1;

      for (const group of groups) {
        const [firstPart] = group.parts;

        group.parts.forEach((part, index) => {
          rows.push([
            index === 0 ? machineNumber : null,
            index === 0 ? excelValue(firstPart.plant) : null,
            index === 0 ? excelValue(firstPart.location) : null,
            index === 0 ? excelValue(firstPart.machineCode) : null,
            index === 0 ? excelValue(firstPart.machineName) : null,
            excelValue(part.device),
            excelValue(part.brand),
            excelValue(part.model),
            excelValue(part.quantity),
            excelValue(part.softwareSupport),
            excelValue(part.statusOfParts),
            excelValue(part.mtStore),
            excelValue(part.secondHand),
            excelValue(part.actionByMaker),
            excelValue(part.actionByMt)
          ]);
        });

        machineNumber += 1;
      }

      rows.forEach((row) => worksheet.addRow(row));
      applyExportWorksheetLayout(worksheet, rows.length);

      let dataRow = 3;
      for (const group of groups) {
        mergeExportMachineRows(worksheet, dataRow, group.parts);
        dataRow += group.parts.length;
      }

      applyExportRowStyles(worksheet, rows.length);
    }

    await workbook.xlsx.writeFile(filePath);
  }

  backupTo(filePath: string): void {
    this.save();
    fs.copyFileSync(this.dbPath, filePath);
  }

  async restoreFrom(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error("Backup file not found.");
    }
    await this.validateBackupDatabase(filePath);

    const rollbackPath = `${this.dbPath}.restore-${Date.now()}.bak`;
    const hadCurrentDatabase = fs.existsSync(this.dbPath);

    if (hadCurrentDatabase) {
      fs.copyFileSync(this.dbPath, rollbackPath);
    }

    try {
      fs.copyFileSync(filePath, this.dbPath);
      await this.initialize(this.dbPath);
    } catch (error) {
      if (hadCurrentDatabase && fs.existsSync(rollbackPath)) {
        fs.copyFileSync(rollbackPath, this.dbPath);
        await this.initialize(this.dbPath);
      } else {
        removeFileIfExists(this.dbPath);
        this.db = null;
      }
      throw error;
    } finally {
      removeFileIfExists(rollbackPath);
    }
  }

  private async validateBackupDatabase(filePath: string): Promise<void> {
    const SQL = await getSql();
    let candidate: Database | null = null;

    try {
      candidate = new SQL.Database(fs.readFileSync(filePath));
      const integrity = candidate.exec("PRAGMA integrity_check");
      const integrityStatus = clean(integrity[0]?.values[0]?.[0]).toLowerCase();
      if (integrityStatus !== "ok") {
        throw new Error("Backup integrity check failed.");
      }

      const tables = candidate.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('parts', 'import_runs', 'reference_options')");
      const tableNames = new Set((tables[0]?.values ?? []).map((row) => clean(row[0])));
      if (!tableNames.has("parts") || !tableNames.has("import_runs") || !tableNames.has("reference_options")) {
        throw new Error("Backup schema is incomplete.");
      }
    } catch {
      throw new Error("Selected backup is not a valid Parts Manager database.");
    } finally {
      candidate?.close();
    }
  }

  private compareImport(records: PartInput[]): Pick<ImportPreview, "newCount" | "updatedCount" | "unchangedCount"> {
    const duplicateTracker = new Map<string, number>();
    const existingByIdentity = this.getImportIdentityMap();
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const rawRecord of records) {
      const record = normalizeRecord(rawRecord);
      const importKey = buildImportKey(record);
      const duplicateIndex = duplicateTracker.get(importKey) ?? 0;
      duplicateTracker.set(importKey, duplicateIndex + 1);
      const existing = existingByIdentity.get(importIdentityKey(importKey, duplicateIndex));
      if (!existing) {
        newCount += 1;
      } else if (partChanged(existing, record)) {
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }
    }

    return { newCount, updatedCount, unchangedCount };
  }

  private insertImportedRecord(record: PartInput, importKey: string, duplicateIndex: number, timestamp: string): void {
    this.requireDb().run(
      `
      INSERT INTO parts (
        source_sheet, import_key, duplicate_index, plant, location, machine_code,
        machine_name, device, brand, model, quantity, software_support, status_of_parts,
        mt_store, second_hand, action_by_maker, action_by_mt, how_to_solution,
        created_at, updated_at, last_imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        record.sourceSheet,
        importKey,
        duplicateIndex,
        record.plant,
        record.location,
        record.machineCode,
        record.machineName,
        record.device,
        record.brand,
        record.model,
        record.quantity,
        record.softwareSupport,
        record.statusOfParts,
        record.mtStore,
        record.secondHand,
        record.actionByMaker,
        record.actionByMt,
        record.howToSolution,
        timestamp,
        timestamp,
        timestamp
      ]
    );
  }

  private updateImportedRecord(id: number, record: PartInput, importKey: string, timestamp: string): void {
    this.requireDb().run(
      `
      UPDATE parts SET
        source_sheet = ?, import_key = ?, plant = ?, location = ?, machine_code = ?,
        machine_name = ?, device = ?, brand = ?, model = ?, quantity = ?,
        software_support = ?, status_of_parts = ?, mt_store = ?, second_hand = ?,
        action_by_maker = ?, action_by_mt = ?, how_to_solution = ?,
        updated_at = ?, last_imported_at = ?
      WHERE id = ?
    `,
      [
        record.sourceSheet,
        importKey,
        record.plant,
        record.location,
        record.machineCode,
        record.machineName,
        record.device,
        record.brand,
        record.model,
        record.quantity,
        record.softwareSupport,
        record.statusOfParts,
        record.mtStore,
        record.secondHand,
        record.actionByMaker,
        record.actionByMt,
        record.howToSolution,
        timestamp,
        timestamp,
        id
      ]
    );
  }

  private getByImportIdentity(importKey: string, duplicateIndex: number): PartRecord | null {
    const row = this.queryRows("SELECT * FROM parts WHERE import_key = ? AND duplicate_index = ? LIMIT 1", [
      importKey,
      duplicateIndex
    ])[0];
    return row ? rowToPart(row) : null;
  }

  private getImportIdentityMap(): Map<string, PartRecord> {
    const parts = this.getAllParts();
    return new Map(parts.map((part) => [importIdentityKey(part.importKey, part.duplicateIndex), part]));
  }

  private nextDuplicateIndex(importKey: string): number {
    const value = this.queryValue(
      "SELECT COALESCE(MAX(duplicate_index), -1) + 1 AS next_index FROM parts WHERE import_key = ?",
      [importKey]
    );
    return Number(value ?? 0);
  }

  private replaceReferenceOptions(references: ReferenceOptions): void {
    const db = this.requireDb();
    db.run("DELETE FROM reference_options");
    for (const value of references.devices) {
      db.run("INSERT OR IGNORE INTO reference_options(option_type, value) VALUES('device', ?)", [value]);
    }
    for (const value of references.brands) {
      db.run("INSERT OR IGNORE INTO reference_options(option_type, value) VALUES('brand', ?)", [value]);
    }
  }

  private getReferenceOptions(): ReferenceOptions {
    const rows = this.queryRows("SELECT option_type, value FROM reference_options ORDER BY value");
    const devices: string[] = [];
    const brands: string[] = [];

    for (const row of rows) {
      if (row.option_type === "device") {
        devices.push(clean(row.value));
      } else if (row.option_type === "brand") {
        brands.push(clean(row.value));
      }
    }

    return { devices, brands };
  }

  private getLastImport(): ImportRun | null {
    return rowToImportRun(
      this.queryRows("SELECT * FROM import_runs ORDER BY imported_at DESC, id DESC LIMIT 1")[0]
    );
  }

  private calculateStats(parts: PartRecord[]): AppStats {
    let obsoleteParts = 0;
    let mtStoreParts = 0;
    let secondHandParts = 0;
    let machines = 0;
    let previousPart: PartRecord | null = null;

    for (const part of parts) {
      if (
        !previousPart ||
        previousPart.sourceSheet !== part.sourceSheet ||
        previousPart.plant !== part.plant ||
        previousPart.location !== part.location ||
        previousPart.machineCode !== part.machineCode ||
        previousPart.machineName !== part.machineName
      ) {
        machines += 1;
      }
      if (part.statusOfParts.toLowerCase().includes("obsolete")) {
        obsoleteParts += 1;
      }
      if (hasSpareValue(part.mtStore)) {
        mtStoreParts += 1;
      }
      if (hasSpareValue(part.secondHand)) {
        secondHandParts += 1;
      }
      previousPart = part;
    }

    return {
      totalParts: parts.length,
      obsoleteParts,
      mtStoreParts,
      secondHandParts,
      machines
    };
  }

  private queryRows(sql: string, params: Array<string | number> = []): DbRow[] {
    const statement = this.requireDb().prepare(sql);
    try {
      statement.bind(params);
      const rows: DbRow[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private queryValue(sql: string, params: Array<string | number> = []): unknown {
    const row = this.queryRows(sql, params)[0];
    return row ? Object.values(row)[0] : undefined;
  }
}
