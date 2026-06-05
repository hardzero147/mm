export type SpareFilter = "all" | "mtStore" | "secondHand" | "any" | "none";

export interface PartRecord {
  id: number;
  sourceSheet: string;
  importKey: string;
  duplicateIndex: number;
  plant: string;
  location: string;
  machineCode: string;
  machineName: string;
  device: string;
  brand: string;
  model: string;
  quantity: string;
  softwareSupport: string;
  statusOfParts: string;
  mtStore: string;
  secondHand: string;
  actionByMaker: string;
  actionByMt: string;
  howToSolution: string;
  createdAt: string;
  updatedAt: string;
  lastImportedAt: string;
}

export type PartInput = Omit<
  PartRecord,
  "id" | "importKey" | "duplicateIndex" | "createdAt" | "updatedAt" | "lastImportedAt"
> & {
  id?: number;
};

export interface ReferenceOptions {
  devices: string[];
  brands: string[];
}

export interface AppStats {
  totalParts: number;
  obsoleteParts: number;
  mtStoreParts: number;
  secondHandParts: number;
  machines: number;
}

export interface ImportRun {
  id: number;
  filePath: string;
  importedAt: string;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  totalRows: number;
}

export interface ImportPreview {
  filePath: string;
  totalRows: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  sheetCounts: Record<string, number>;
  duplicateGroups: number;
  sampleRows: PartInput[];
  skippedRows: string[];
}

export interface ImportCommitResult extends ImportPreview {
  importedAt: string;
}

export interface AppDataSnapshot {
  parts: PartRecord[];
  stats: AppStats;
  lastImport: ImportRun | null;
  references: ReferenceOptions;
  databasePath: string;
}

export interface ExportResult {
  canceled: boolean;
  filePath?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ElectricalPartsApi {
  getSnapshot(): Promise<ApiResponse<AppDataSnapshot>>;
  chooseAndPreviewImport(): Promise<ApiResponse<ImportPreview | null>>;
  commitImport(filePath: string): Promise<ApiResponse<ImportCommitResult>>;
  savePart(part: PartInput): Promise<ApiResponse<PartRecord>>;
  saveParts(parts: PartInput[]): Promise<ApiResponse<PartRecord[]>>;
  deletePart(id: number): Promise<ApiResponse<{ id: number }>>;
  deleteParts(ids: number[]): Promise<ApiResponse<{ ids: number[] }>>;
  exportData(): Promise<ApiResponse<ExportResult>>;
}

declare global {
  interface Window {
    electricalAPI?: ElectricalPartsApi;
  }
}
