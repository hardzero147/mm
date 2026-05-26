import {
  ArchiveRestore,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircuitBoard,
  Cpu,
  DatabaseBackup,
  FileDown,
  FileSpreadsheet,
  HelpCircle,
  Keyboard,
  Recycle,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Upload,
  X
} from "lucide-react";

declare global {
  interface Window {
    electronMenuBridge?: {
      onMenuAction: (callback: (action: string) => void) => void;
    };
  }
}
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode, UIEvent } from "react";
import type {
  ApiResponse,
  AppDataSnapshot,
  AppStats,
  ElectricalPartsApi,
  ImportRun,
  ImportPreview,
  PartInput,
  PartRecord,
  SpareFilter
} from "../shared/types";
import { hasSpareValue } from "../shared/spare";

type StatusFilter = "all" | "obsolete";

type FilterState = {
  query: string;
  plant: string[];
  device: string[];
  brand: string[];
  spare: SpareFilter;
  status: StatusFilter;
};

type MachineGroup = {
  key: string;
  sourceSheet: string;
  plant: string;
  location: string;
  machineCode: string;
  machineName: string;
  parts: PartRecord[];
};

type IndexedPart = {
  part: PartRecord;
  deviceFilter: string;
  brandFilter: string;
  statusText: string;
  inMtStore: boolean;
  isSecondHand: boolean;
  search?: {
    lower: string;
    compact: string;
  };
};

type VirtualItem<T> = {
  item: T;
  index: number;
};

type EditMode = "add-machine" | "edit-machine" | "add-group-part" | "edit-group-part" | "add-part" | "edit-part";

type FieldSection = "machine" | "partGroup" | "part";

type PartCluster = {
  key: string;
  label: string;
  brandSummary: string;
  quantityLabel: string;
  parts: PartRecord[];
};

type PartClusterBuilder = {
  cluster: PartCluster;
  brands: Set<string>;
  hasNumericQuantity: boolean;
  quantityTotal: number;
};

const MACHINE_ROW_ESTIMATE = 128;
const PART_ROW_ESTIMATE = 58;
const VIRTUAL_OVERSCAN = 8;

const thaiDateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short"
});

type Toast = {
  tone: "success" | "error" | "info";
  message: string;
};

const emptyFilters: FilterState = {
  query: "",
  plant: [],
  device: [],
  brand: [],
  spare: "all",
  status: "all"
};

const plantFilterOptions = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
const sourceSheetFormOptions = ["Manual", ...plantFilterOptions];

const plantCodeOptions = [
  { value: "1100", label: "1100 - P100" },
  { value: "1200", label: "1200 - P200" },
  { value: "1300", label: "1300 - P300 BC" },
  { value: "NOC", label: "NOC - P300 NOC" },
  { value: "400", label: "400 - P400" },
  { value: "P600", label: "P600 - P600" }
] as const;

const plantCodeOptionValues = plantCodeOptions.map((option) => option.value);
const plantCodeOptionLabels = Object.fromEntries(plantCodeOptions.map((option) => [option.value, option.label]));

const spareFilterLabels: Record<SpareFilter, string> = {
  all: "All spare",
  mtStore: "MT store",
  secondHand: "Second hand",
  any: "Any spare",
  none: "No spare"
};

const plantGroupByCode: Record<string, string> = {
  "100": "P100",
  "0100": "P100",
  "1100": "P100",
  "1200": "P200",
  "1300": "P300",
  "NOC": "P300",
  "400": "P400",
  "0400": "P400",
  "600": "P600",
  "0600": "P600"
};

const deviceFilterOptions = ["PLC", "HMI", "SERVO MOTOR", "SERVO DRIVE", "INVERTER", "MAIN MOTOR", "OPTION CARD"];

const brandFilterOptions = [
  "MITSUBISHI",
  "SIEMENS",
  "ALLEN BRADLEY",
  "SCHNEIDER",
  "FUJI",
  "PROFACE",
  "EASY VIEW",
  "PANASONIC",
  "OMRON",
  "ABB",
  "BECKHOFF",
  "REXROTH",
  "YASKAWA",
  "PARKER",
  "FESTO",
  "ORIENTAL",
  "KEYENCE",
  "B&R",
  "DELTA",
  "OTHER"
];

const brandAliases: Array<{ option: string; aliases: string[] }> = [
  { option: "MITSUBISHI", aliases: ["MITSUBISHI", "MISUBISHI", "MISTSUBISHI"] },
  { option: "SIEMENS", aliases: ["SIEMENS"] },
  { option: "ALLEN BRADLEY", aliases: ["ALLEN BRADLEY", "ALLEN-BRADLEY", "ALLENBRADLEY"] },
  { option: "SCHNEIDER", aliases: ["SCHNEIDER", "SCHNEIDER ELECTRIC"] },
  { option: "FUJI", aliases: ["FUJI"] },
  { option: "PROFACE", aliases: ["PROFACE", "PRO-FACE", "PRO FACE"] },
  { option: "EASY VIEW", aliases: ["EASY VIEW", "EASYVIEW", "WEINTEK", "WIENTEK"] },
  { option: "PANASONIC", aliases: ["PANASOINC", "PANASONIC"] },
  { option: "OMRON", aliases: ["OMRON"] },
  { option: "ABB", aliases: ["ABB"] },
  { option: "BECKHOFF", aliases: ["BECKHOFF", "BECKOFF"] },
  { option: "REXROTH", aliases: ["REXROTH", "REXRROTH"] },
  { option: "YASKAWA", aliases: ["YASKAWA"] },
  { option: "PARKER", aliases: ["PARKER", "PRAKER"] },
  { option: "FESTO", aliases: ["FESTO"] },
  { option: "ORIENTAL", aliases: ["ORIENTAL"] },
  { option: "KEYENCE", aliases: ["KEYENCE"] },
  { option: "B&R", aliases: ["B&R"] },
  { option: "DELTA", aliases: ["DELTA"] }
];

const softwareCatalog = [
  { brand: "Siemens", plcSoftware: "Siemens TIA Portal", hmiSoftware: "WinCC" },
  { brand: "Siemens", plcSoftware: "STEP 7", hmiSoftware: "WinCC" },
  { brand: "ALLEN BRADLEY", plcSoftware: "Studio 5000 Logix Designer", hmiSoftware: "FactoryTalk View" },
  { brand: "ALLEN BRADLEY", plcSoftware: "RSLogix 500", hmiSoftware: "FactoryTalk View" },
  {
    brand: "Schneider Electric",
    plcSoftware: "EcoStruxure Control Expert",
    hmiSoftware: "EcoStruxure Machine SCADA Expert"
  },
  { brand: "Mitsubishi Electric", plcSoftware: "GX Works2", hmiSoftware: "GT Designer3" },
  { brand: "Mitsubishi Electric", plcSoftware: "GX Works3", hmiSoftware: "GT Designer3" },
  { brand: "Mitsubishi Electric", plcSoftware: "GX Developer", hmiSoftware: "GT Designer3" },
  { brand: "Omron", plcSoftware: "CX-One", hmiSoftware: "" },
  { brand: "Omron", plcSoftware: "Sysmac Studio", hmiSoftware: "NB-Designer" },
  { brand: "Beckhoff", plcSoftware: "TwinCAT 3", hmiSoftware: "TwinCAT HMI" },
  { brand: "Panasonic", plcSoftware: "FPWIN Pro", hmiSoftware: "GTWIN" },
  { brand: "Delta", plcSoftware: "ISPSoft", hmiSoftware: "DOPSoft" },
  { brand: "Weintek (Wientek)", plcSoftware: "-", hmiSoftware: "EasyBuilder Pro" },
  { brand: "Pro-face", plcSoftware: "-", hmiSoftware: "GP-Pro EX" },
  { brand: "Fuji Electric", plcSoftware: "SX-Programmer Expert", hmiSoftware: "Tellus HMI" },
  { brand: "Parker", plcSoftware: "Automation Builder", hmiSoftware: "Parker HMI Runtime" },
  { brand: "ABB", plcSoftware: "Control Builder Plus", hmiSoftware: "ABB Panel Builder" },
  { brand: "Keyence", plcSoftware: "KV Studio", hmiSoftware: "VT Studio" }
] as const;

const softwareBrandOptions = [
  "Siemens",
  "ALLEN BRADLEY",
  "Schneider Electric",
  "Mitsubishi Electric",
  "Omron",
  "Beckhoff",
  "Panasonic",
  "Delta",
  "Weintek (Wientek)",
  "Pro-face",
  "Fuji Electric",
  "Parker",
  "ABB",
  "Keyence"
];

const plcSoftwareOptions = [
  "Siemens TIA Portal",
  "STEP 7",
  "Studio 5000 Logix Designer",
  "RSLogix 500",
  "EcoStruxure Control Expert",
  "GX Works2",
  "GX Works3",
  "GX Developer",
  "CX-One",
  "Sysmac Studio",
  "TwinCAT 3",
  "FPWIN Pro",
  "ISPSoft",
  "-",
  "SX-Programmer Expert",
  "Automation Builder",
  "Control Builder Plus",
  "KV Studio"
];

const hmiSoftwareOptions = [
  "WinCC",
  "FactoryTalk View",
  "EcoStruxure Machine SCADA Expert",
  "GT Designer3",
  "NB-Designer",
  "TwinCAT HMI",
  "GTWIN",
  "DOPSoft",
  "EasyBuilder Pro",
  "GP-Pro EX",
  "Tellus HMI",
  "Parker HMI Runtime",
  "ABB Panel Builder",
  "VT Studio"
];

const emptyPart: PartInput = {
  sourceSheet: "Manual",
  plant: "",
  location: "",
  machineCode: "",
  machineName: "",
  device: "",
  brand: "",
  model: "",
  quantity: "",
  softwareSupport: "",
  statusOfParts: "",
  mtStore: "",
  secondHand: "",
  actionByMaker: "",
  actionByMt: "",
  howToSolution: ""
};

const fieldGroups: Array<{
  section: FieldSection;
  title: string;
  fields: Array<{ key: keyof PartInput; label: string; placeholder?: string }>;
}> = [
  {
    section: "machine",
    title: "Machine / เครื่อง",
    fields: [
      { key: "sourceSheet", label: "Plant Group / กลุ่ม Plant" },
      { key: "plant", label: "Plant Code / รหัส Plant", placeholder: "เลือก Plant" },
      { key: "location", label: "Location / พื้นที่" },
      { key: "machineCode", label: "Machine Code / รหัสเครื่อง" },
      { key: "machineName", label: "Machine Name / ชื่อเครื่อง" }
    ]
  },
  {
    section: "partGroup",
    title: "Part Group / กลุ่มอะไหล่",
    fields: [
      { key: "device", label: "Device / อุปกรณ์" },
      { key: "brand", label: "Brand / ยี่ห้อ" }
    ]
  },
  {
    section: "part",
    title: "Part Model / รุ่นและสต็อก",
    fields: [
      { key: "model", label: "Model / รุ่น" },
      { key: "quantity", label: "Quantity / จำนวน" },
      { key: "softwareSupport", label: "PLC/HMI Software" },
      { key: "statusOfParts", label: "Status of parts / สถานะ" },
      { key: "mtStore", label: "MT Store" },
      { key: "secondHand", label: "Second hand" },
      { key: "actionByMaker", label: "Action by Maker" },
      { key: "actionByMt", label: "Action by MT" },
      { key: "howToSolution", label: "How to solution / วิธีแก้" }
    ]
  }
];

const baseMockParts: PartRecord[] = [
  {
    id: 1,
    sourceSheet: "P200",
    importKey: "P200|1200|PK|2FAPPF01|TOYO NO.2|PLC|OMRON|SYSMAC CS1G-CPU42H",
    duplicateIndex: 0,
    plant: "1200",
    location: "PK",
    machineCode: "2FAPPF01",
    machineName: "TOYO No.2",
    device: "PLC",
    brand: "OMRON",
    model: "SYSMAC CS1G-CPU42H",
    quantity: "1",
    softwareSupport: "",
    statusOfParts: "Obsolete",
    mtStore: "",
    secondHand: "",
    actionByMaker: "",
    actionByMt: "",
    howToSolution: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastImportedAt: new Date().toISOString()
  },
  {
    id: 2,
    sourceSheet: "P400",
    importKey: "P400|400|LD PAKING|4LDPKP01000-000|PREMADE POUCH FILLING NO.1|HMI|PRO-FACE|PFXGP4410TAD",
    duplicateIndex: 0,
    plant: "400",
    location: "LD PAKING",
    machineCode: "4LDPKP01000-000",
    machineName: "Premade Pouch Filling No.1",
    device: "HMI",
    brand: "PRO-FACE",
    model: "PFXGP4410TAD",
    quantity: "1",
    softwareSupport: "",
    statusOfParts: "",
    mtStore: "1",
    secondHand: "",
    actionByMaker: "",
    actionByMt: "",
    howToSolution: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastImportedAt: new Date().toISOString()
  },
  {
    id: 3,
    sourceSheet: "P200",
    importKey: "P200|1200|PK|2FAPPF01|TOYO NO.2|PLC|OMRON|CJ1M-CPU13",
    duplicateIndex: 0,
    plant: "1200",
    location: "PK",
    machineCode: "2FAPPF01",
    machineName: "TOYO No.2",
    device: "PLC",
    brand: "OMRON",
    model: "CJ1M-CPU13",
    quantity: "1",
    softwareSupport: "",
    statusOfParts: "",
    mtStore: "1",
    secondHand: "",
    actionByMaker: "",
    actionByMt: "",
    howToSolution: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastImportedAt: new Date().toISOString()
  },
  {
    id: 4,
    sourceSheet: "P200",
    importKey: "P200|1200|PK|2FAPPF01|TOYO NO.2|HMI|PRO-FACE|GP2500-TC41-24V",
    duplicateIndex: 0,
    plant: "1200",
    location: "PK",
    machineCode: "2FAPPF01",
    machineName: "TOYO No.2",
    device: "HMI",
    brand: "PRO-FACE",
    model: "GP2500-TC41-24V",
    quantity: "1",
    softwareSupport: "",
    statusOfParts: "",
    mtStore: "",
    secondHand: "1",
    actionByMaker: "",
    actionByMt: "",
    howToSolution: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastImportedAt: new Date().toISOString()
  }
];

const editModeSections: Record<EditMode, FieldSection[]> = {
  "add-machine": ["machine", "partGroup", "part"],
  "edit-machine": ["machine"],
  "add-group-part": ["partGroup", "part"],
  "edit-group-part": ["partGroup"],
  "add-part": ["part"],
  "edit-part": ["part"]
};

const editModeText: Record<EditMode, { title: string; subtitle: string }> = {
  "add-machine": { title: "Add Machine", subtitle: "Add Machine / เพิ่มเครื่อง" },
  "edit-machine": { title: "Edit Machine", subtitle: "Machine / แก้ข้อมูลเครื่อง" },
  "add-group-part": { title: "Add Group Part", subtitle: "Part Group / เพิ่มกลุ่มอะไหล่" },
  "edit-group-part": { title: "Edit Group Part", subtitle: "Part Group / แก้กลุ่มอะไหล่" },
  "add-part": { title: "Add Part", subtitle: "Part Model / เพิ่มรุ่นอะไหล่" },
  "edit-part": { title: "Edit Part", subtitle: "Part Model / แก้รุ่นอะไหล่" }
};

function getMockPerfCount(): number {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("perfRows") ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(150000, Math.floor(value));
}

function getMockPartsPerMachine(): number {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("perfPartsPerMachine") ?? 1);
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(50, Math.floor(value));
}

function createMockParts(): PartRecord[] {
  const perfCount = getMockPerfCount();
  if (!perfCount) {
    return [...baseMockParts];
  }

  const now = new Date().toISOString();
  const sourceSheets = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
  const plants = ["1100", "1200", "1300", "1300", "400", "600"];
  const locations = ["PK", "PK", "BCPK", "NOC", "LD PAKING", "BD"];
  const devices = ["PLC", "HMI", "SERVO DRIVE", "INVERTER", "OPTION CARD", "MAIN MOTOR"];
  const brands = ["OMRON", "PRO-FACE", "REXROTH", "FUJI", "B&R", "MITSUBISHI"];
  const partsPerMachine = getMockPartsPerMachine();

  return Array.from({ length: perfCount }, (_, index) => {
    const machineIndex = Math.floor(index / partsPerMachine);
    const partIndex = index % partsPerMachine;
    const familyIndex = machineIndex % sourceSheets.length;
    const device = devices[(machineIndex + partIndex) % devices.length];
    const brand = brands[(machineIndex + partIndex * 2) % brands.length];
    const machineCode = `${sourceSheets[familyIndex].replace(/\s+/g, "")}-${String(machineIndex + 1).padStart(6, "0")}`;
    const machineName = `PERF MACHINE ${String(machineIndex + 1).padStart(6, "0")}`;
    const model = `${brand.replace(/[^A-Z0-9]/gi, "")}-${String(index + 1).padStart(6, "0")}`;

    return {
      id: index + 1,
      sourceSheet: sourceSheets[familyIndex],
      importKey: `${sourceSheets[familyIndex]}|${plants[familyIndex]}|${locations[familyIndex]}|${machineCode}|${machineName}|${device}|${brand}|${model}`,
      duplicateIndex: 0,
      plant: plants[familyIndex],
      location: locations[familyIndex],
      machineCode,
      machineName,
      device,
      brand,
      model,
      quantity: String((index % 4) + 1),
      softwareSupport: "",
      statusOfParts: index % 17 === 0 ? "Obsolete" : "",
      mtStore: index % 9 === 0 ? "1" : "",
      secondHand: index % 23 === 0 ? "1" : "",
      actionByMaker: "",
      actionByMt: "",
      howToSolution: "",
      createdAt: now,
      updatedAt: now,
      lastImportedAt: now
    };
  });
}

const startupStartedAt = Date.now();
let mockStore: PartRecord[] | null = null;
let mockNextId = 1;

function getMockStore(): PartRecord[] {
  if (!mockStore) {
    mockStore = createMockParts();
    mockNextId = mockStore.length + 1;
  }

  return mockStore;
}

function replaceMockStore(nextStore: PartRecord[]): PartRecord[] {
  mockStore = nextStore;
  return mockStore;
}

function saveMockPart(part: PartInput, now = new Date().toISOString()): PartRecord {
  const store = getMockStore();

  if (part.id) {
    const nextStore = replaceMockStore(store.map((existing) =>
      existing.id === part.id
        ? {
            ...existing,
            ...part,
            id: existing.id,
            importKey: existing.importKey,
            duplicateIndex: existing.duplicateIndex,
            updatedAt: now
          }
        : existing
    ));
    const saved = nextStore.find((existing) => existing.id === part.id);
    if (saved) {
      return saved;
    }
  }

  const created: PartRecord = {
    ...part,
    id: mockNextId,
    importKey: "MANUAL",
    duplicateIndex: 0,
    createdAt: now,
    updatedAt: now,
    lastImportedAt: ""
  };
  mockNextId += 1;
  replaceMockStore([created, ...store]);
  return created;
}

function markStartupStep(name: string) {
  document.documentElement.setAttribute(`data-startup-${name}-ms`, String(Date.now() - startupStartedAt));
  window.performance?.mark?.(`electrical-parts:${name}`);
}

function createMockApi(): ElectricalPartsApi {
  const snapshot = (): AppDataSnapshot => {
    const store = getMockStore();

    return {
      parts: store,
      stats: calculateClientStats(store),
      references: { devices: ["PLC", "HMI", "INVERTER"], brands: ["OMRON", "PRO-FACE", "FUJI"] },
      lastImport: {
        id: 1,
        filePath: "Mock workbook",
        importedAt: new Date().toISOString(),
        newCount: store.length,
        updatedCount: 0,
        unchangedCount: 0,
        skippedCount: 0,
        totalRows: store.length
      },
      databasePath: "Browser preview"
    };
  };

  return {
    getSnapshot: async () => ({ ok: true, data: snapshot() }),
    chooseAndPreviewImport: async () => ({
      ok: true,
      data: {
        filePath: "Browser preview workbook",
        totalRows: 1249,
        newCount: 1249,
        updatedCount: 0,
        unchangedCount: 0,
        skippedCount: 3,
        sheetCounts: { P100: 97, P200: 256, "P300 BC": 105, "P300 NOC": 263, P400: 275, P600: 253 },
        duplicateGroups: 1,
        sampleRows: getMockStore(),
        skippedRows: []
      }
    }),
    commitImport: async () => ({ ok: true, data: undefined as never }),
    savePart: async (part) => ({ ok: true, data: saveMockPart(part) }),
    saveParts: async (parts) => {
      const now = new Date().toISOString();
      return { ok: true, data: parts.map((part) => saveMockPart(part, now)) };
    },
    deletePart: async (id) => {
      replaceMockStore(getMockStore().filter((part) => part.id !== id));
      return { ok: true, data: { id } };
    },
    deleteParts: async (ids) => {
      const selectedIds = new Set(ids);
      replaceMockStore(getMockStore().filter((part) => !selectedIds.has(part.id)));
      return { ok: true, data: { ids } };
    },
    exportData: async () => ({ ok: true, data: { canceled: false, filePath: "Browser preview export.xlsx" } }),
    backupDatabase: async () => ({ ok: true, data: { canceled: false, filePath: "Browser preview backup.sqlite" } }),
    restoreDatabase: async () => ({ ok: true, data: { canceled: false, filePath: "Browser preview backup.sqlite" } })
  };
}

const api = window.electricalAPI ?? createMockApi();

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.ok) {
    throw new Error(response.error ?? "Unknown error");
  }
  return response.data as T;
}

function asPartInput(part: PartRecord): PartInput {
  return {
    id: part.id,
    sourceSheet: part.sourceSheet,
    plant: part.plant,
    location: part.location,
    machineCode: part.machineCode,
    machineName: part.machineName,
    device: part.device,
    brand: part.brand,
    model: part.model,
    quantity: part.quantity,
    softwareSupport: part.softwareSupport,
    statusOfParts: part.statusOfParts,
    mtStore: part.mtStore,
    secondHand: part.secondHand,
    actionByMaker: part.actionByMaker,
    actionByMt: part.actionByMt,
    howToSolution: part.howToSolution
  };
}

function filterKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9&]+/g, "");
}

const brandAliasKeys = brandAliases.map((group) => ({
  option: group.option,
  aliases: group.aliases.map(filterKey)
}));

function compactLowerSearchText(value: string): string {
  return value.replace(/[\s\-_/.:|()[\]]+/g, "");
}

function compactSearchText(value: string): string {
  return compactLowerSearchText(value.toLowerCase());
}

function deviceFilterValue(value: string): string {
  const text = value.toUpperCase();
  if (!text.trim()) return "";
  if (text.includes("PLC")) return "PLC";
  if (text.includes("HMI")) return "HMI";
  if (text.includes("SERVO") && text.includes("DRIVE")) return "SERVO DRIVE";
  if (text.includes("SERVO") && (text.includes("MOTOR") || !text.includes("DRIVE"))) return "SERVO MOTOR";
  if (text.includes("OPTION") || text.includes("CARD")) return "OPTION CARD";
  if (text.includes("INVERTER") || text === "DRIVE" || text.includes("AC DRIVE")) return "INVERTER";
  if (text.includes("MOTOR")) return "MAIN MOTOR";
  return text.trim();
}

function brandFilterValue(value: string): string {
  const key = filterKey(value);
  if (!key || key === "-") return "";

  const matched = brandAliasKeys.find((group) => group.aliases.some((alias) => key.includes(alias)));
  return matched?.option ?? "OTHER";
}

function uniqueByFilterKey(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = filterKey(trimmed) || trimmed;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function sameCatalogBrand(catalogBrand: string, value: string): boolean {
  const catalogKey = filterKey(catalogBrand);
  const valueKey = filterKey(value);

  if (!catalogKey || !valueKey) {
    return false;
  }

  if (catalogKey === valueKey || catalogKey.includes(valueKey) || valueKey.includes(catalogKey)) {
    return true;
  }

  const catalogFilter = brandFilterValue(catalogBrand);
  const valueFilter = brandFilterValue(value);
  return Boolean(catalogFilter && valueFilter && catalogFilter === valueFilter && catalogFilter !== "OTHER");
}

function catalogRowsForBrand(brand: string): typeof softwareCatalog[number][] {
  const valueKey = filterKey(brand);
  if (!valueKey) {
    return [];
  }

  const valueFilter = brandFilterValue(brand);
  return softwareCatalog.filter((row) => {
    const rowKey = filterKey(row.brand);
    if (rowKey === valueKey) {
      return true;
    }

    const rowFilter = brandFilterValue(row.brand);
    return Boolean(rowFilter && valueFilter && rowFilter === valueFilter && rowFilter !== "OTHER");
  });
}

function softwareOptionsForPart(part: PartInput): string[] {
  const device = deviceFilterValue(part.device);
  const brandMatches = part.brand.trim() ? softwareCatalog.filter((row) => sameCatalogBrand(row.brand, part.brand)) : [];
  const rows = brandMatches.length ? brandMatches : softwareCatalog;

  if (device === "PLC") {
    return uniqueByFilterKey(rows.map((row) => row.plcSoftware));
  }

  if (device === "HMI") {
    return uniqueByFilterKey(rows.map((row) => row.hmiSoftware));
  }

  return uniqueByFilterKey([
    ...rows.map((row) => row.plcSoftware),
    ...rows.map((row) => row.hmiSoftware),
    ...plcSoftwareOptions,
    ...hmiSoftwareOptions
  ]);
}

function defaultSoftwareForPart(part: PartInput): string {
  const rows = catalogRowsForBrand(part.brand);
  if (!rows.length) {
    return "";
  }

  const device = deviceFilterValue(part.device);
  if (device === "HMI") {
    return uniqueByFilterKey(rows.map((row) => row.hmiSoftware))[0] ?? "";
  }

  if (device === "PLC") {
    return uniqueByFilterKey(rows.map((row) => row.plcSoftware))[0] ?? "";
  }

  return uniqueByFilterKey([...rows.map((row) => row.plcSoftware), ...rows.map((row) => row.hmiSoftware)])[0] ?? "";
}

function softwareValueKey(value: string): string {
  return filterKey(value) || value.trim().toLowerCase();
}

function isKnownSoftwareValue(value: string, part: PartInput): boolean {
  const key = softwareValueKey(value);
  return Boolean(key && softwareOptionsForPart(part).some((option) => softwareValueKey(option) === key));
}

function normalizedPlantCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function plantGroupFromSourceSheet(sourceSheet: string): string {
  const match = sourceSheet.toUpperCase().match(/P\d+/);
  return match?.[0] ?? "";
}

function plantGroupFromCode(plant: string): string {
  const code = normalizedPlantCode(plant);
  if (!code) return "";
  if (code.startsWith("P")) return code.match(/P\d+/)?.[0] ?? "";
  return plantGroupByCode[code] ?? "";
}

function inferPlantGroup(sourceSheet: string, plant: string): string {
  return plantGroupFromSourceSheet(sourceSheet) || plantGroupFromCode(plant);
}

function inferSourceSheetFromPlant(plant: string, location = ""): string {
  if (normalizedPlantCode(plant) === "NOC") {
    return "P300 NOC";
  }

  const group = plantGroupFromCode(plant);
  if (group === "P300") {
    return location.toUpperCase().includes("NOC") ? "P300 NOC" : "P300 BC";
  }
  return group;
}

function formatPlantLabel(sourceSheet: string, plant: string): string {
  const plantValue = plant.trim();
  const group = inferPlantGroup(sourceSheet, plant);
  if (group && plantValue && normalizedPlantCode(plantValue) !== group) {
    return `${group} / ${plantValue}`;
  }
  return plantValue || group || "-";
}

function plantMeta(sourceSheet: string, plant: string, location: string) {
  return {
    group: inferPlantGroup(sourceSheet, plant) || "-",
    code: plant.trim() || "-",
    location: location.trim() || "-"
  };
}

function matchesSpareFilter(inMtStore: boolean, isSecondHand: boolean, spare: SpareFilter): boolean {
  if (spare === "mtStore") return inMtStore;
  if (spare === "secondHand") return isSecondHand;
  if (spare === "any") return inMtStore || isSecondHand;
  if (spare === "none") return !inMtStore && !isSecondHand;
  return true;
}

function partClusterIdentity(part: PartRecord): string {
  const device = deviceFilterValue(part.device) || part.device.trim().toUpperCase();
  if (device) {
    return device;
  }

  const brand = brandFilterValue(part.brand);
  if (brand) {
    return `BRAND:${brand}`;
  }

  return `MODEL:${part.model.trim().toUpperCase() || part.id}`;
}

function summarizeBrandValues(brands: Iterable<string>): string {
  const uniqueBrands = Array.from(brands);
  if (!uniqueBrands.length) {
    return "-";
  }

  return uniqueBrands.length > 2 ? `${uniqueBrands.slice(0, 2).join(", ")} +${uniqueBrands.length - 2}` : uniqueBrands.join(", ");
}

function groupPartClusters(parts: PartRecord[]): PartCluster[] {
  const builders = new Map<string, PartClusterBuilder>();

  for (const part of parts) {
    const key = partClusterIdentity(part);
    let builder = builders.get(key);

    if (!builder) {
      builder = {
        cluster: {
          key,
          label: deviceFilterValue(part.device) || part.device.trim() || part.brand.trim() || "Part",
          brandSummary: "-",
          quantityLabel: "0",
          parts: []
        },
        brands: new Set<string>(),
        hasNumericQuantity: false,
        quantityTotal: 0
      };
      builders.set(key, builder);
    }

    builder.cluster.parts.push(part);

    const brand = part.brand.trim();
    if (brand) {
      builder.brands.add(brand);
    }

    const quantity = Number(part.quantity);
    if (Number.isFinite(quantity)) {
      builder.hasNumericQuantity = true;
      builder.quantityTotal += quantity;
    }
  }

  return Array.from(builders.values(), (builder) => {
    builder.cluster.brandSummary = summarizeBrandValues(builder.brands);
    builder.cluster.quantityLabel = builder.hasNumericQuantity ? String(builder.quantityTotal) : String(builder.cluster.parts.length);
    return builder.cluster;
  });
}

function machineGroupIdentity(part: PartRecord): string {
  return `${part.sourceSheet}\u001f${part.plant}\u001f${part.location}\u001f${part.machineCode}\u001f${part.machineName}`;
}

function groupParts(parts: PartRecord[]): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();

  for (const part of parts) {
    const key = machineGroupIdentity(part);
    const existing = groups.get(key);

    if (existing) {
      existing.parts.push(part);
    } else {
      groups.set(key, {
        key,
        sourceSheet: part.sourceSheet,
        plant: part.plant,
        location: part.location,
        machineCode: part.machineCode,
        machineName: part.machineName,
        parts: [part]
      });
    }
  }

  return Array.from(groups.values());
}

function calculateClientStats(parts: PartRecord[]): AppStats {
  const machineKeys = new Set<string>();
  let obsoleteParts = 0;
  let mtStoreParts = 0;
  let secondHandParts = 0;

  for (const part of parts) {
    machineKeys.add(machineGroupIdentity(part));
    if (part.statusOfParts.toLowerCase().includes("obsolete")) {
      obsoleteParts += 1;
    }
    if (hasSpareValue(part.mtStore)) {
      mtStoreParts += 1;
    }
    if (hasSpareValue(part.secondHand)) {
      secondHandParts += 1;
    }
  }

  return {
    totalParts: parts.length,
    obsoleteParts,
    mtStoreParts,
    secondHandParts,
    machines: machineKeys.size
  };
}

function withParts(snapshot: AppDataSnapshot, parts: PartRecord[]): AppDataSnapshot {
  return {
    ...snapshot,
    parts,
    stats: calculateClientStats(parts)
  };
}

function upsertPart(snapshot: AppDataSnapshot, saved: PartRecord): AppDataSnapshot {
  let found = false;
  const nextParts = snapshot.parts.map((part) => {
    if (part.id !== saved.id) {
      return part;
    }
    found = true;
    return saved;
  });

  if (!found) {
    nextParts.unshift(saved);
  }

  return withParts(snapshot, nextParts);
}

function upsertParts(snapshot: AppDataSnapshot, savedParts: PartRecord[]): AppDataSnapshot {
  if (!savedParts.length) {
    return snapshot;
  }

  const savedById = new Map(savedParts.map((part) => [part.id, part]));
  const seenIds = new Set<number>();
  const nextParts = snapshot.parts.map((part) => {
    const saved = savedById.get(part.id);
    if (!saved) {
      return part;
    }

    seenIds.add(saved.id);
    return saved;
  });

  for (const saved of savedParts) {
    if (!seenIds.has(saved.id)) {
      nextParts.unshift(saved);
    }
  }

  return withParts(snapshot, nextParts);
}

function removeParts(snapshot: AppDataSnapshot, ids: Set<number>): AppDataSnapshot {
  return withParts(
    snapshot,
    snapshot.parts.filter((part) => !ids.has(part.id))
  );
}

function getIndexedSearch(indexed: IndexedPart): { lower: string; compact: string } {
  if (!indexed.search) {
    const part = indexed.part;
    const text = [
      part.sourceSheet,
      inferPlantGroup(part.sourceSheet, part.plant),
      part.plant,
      part.location,
      part.machineCode,
      part.machineName,
      part.device,
      indexed.deviceFilter,
      part.brand,
      indexed.brandFilter,
      part.model,
      part.quantity,
      part.softwareSupport,
      part.statusOfParts,
      part.mtStore,
      part.secondHand,
      part.actionByMaker,
      part.actionByMt,
      part.howToSolution
    ].join(" ");
    const lower = text.toLowerCase();
    indexed.search = {
      lower,
      compact: compactLowerSearchText(lower)
    };
  }

  return indexed.search;
}

function useVirtualWindow<T>(items: T[], rowHeight: number) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollTop = useRef(0);
  const animationFrame = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = element.clientHeight || 640;
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    pendingScrollTop.current = 0;
    setScrollTop((current) => (current === 0 ? current : 0));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [items]);

  useEffect(() => {
    return () => {
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight) + VIRTUAL_OVERSCAN * 2);
  const maxStart = Math.max(0, items.length - visibleCount);
  const startIndex = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN));
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const virtualItems = useMemo<VirtualItem<T>[]>(
    () => items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
    [endIndex, items, startIndex]
  );
  const paddingTop = startIndex * rowHeight;
  const paddingBottom = Math.max(0, (items.length - endIndex) * rowHeight);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingScrollTop.current = event.currentTarget.scrollTop;
    if (animationFrame.current !== null) {
      return;
    }

    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = null;
      setScrollTop((current) => (current === pendingScrollTop.current ? current : pendingScrollTop.current));
    });
  }, []);

  return {
    scrollRef,
    virtualItems,
    paddingTop,
    paddingBottom,
    onScroll
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);

  return debounced;
}

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }

  return thaiDateTimeFormatter.format(new Date(value));
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppDataSnapshot | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<Set<number>>(() => new Set());
  const [editingPart, setEditingPart] = useState<PartInput | null>(null);
  const [editingMode, setEditingMode] = useState<EditMode>("add-part");
  const [editingTargetIds, setEditingTargetIds] = useState<number[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollToMachineGroupRef = useRef<((index: number) => void) | null>(null);
  const didRequestInitialSnapshot = useRef(false);

  const showToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const clearEditing = useCallback(() => {
    setEditingPart(null);
    setEditingMode("add-part");
    setEditingTargetIds([]);
  }, []);

  const refresh = useCallback(async () => {
    markStartupStep("snapshot-request-start");
    const nextSnapshot = unwrap(await api.getSnapshot());
    setSnapshot(nextSnapshot);
    markStartupStep("snapshot-request-end");
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() => markStartupStep("shell-rendered"));
  }, []);

  useEffect(() => {
    if (didRequestInitialSnapshot.current) {
      return;
    }

    didRequestInitialSnapshot.current = true;
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        refresh()
          .catch((error) => showToast(error.message, "error"))
          .finally(() => setLoading(false));
      }, 0);
    });
  }, [refresh, showToast]);

  useEffect(() => {
    if (!loading && snapshot) {
      markStartupStep("data-rendered");
    }
  }, [loading, snapshot]);

  const parts = snapshot?.parts ?? [];
  const formDeviceOptions = useMemo(
    () => uniqueByFilterKey([...deviceFilterOptions, ...(snapshot?.references.devices ?? [])]),
    [snapshot?.references.devices]
  );
  const formBrandOptions = useMemo(
    () => uniqueByFilterKey([...softwareBrandOptions, ...(snapshot?.references.brands ?? []), ...brandFilterOptions]),
    [snapshot?.references.brands]
  );
  const indexedParts = useMemo<IndexedPart[]>(
    () =>
      parts.map((part) => ({
        part,
        deviceFilter: deviceFilterValue(part.device),
        brandFilter: brandFilterValue(part.brand),
        statusText: part.statusOfParts.toLowerCase(),
        inMtStore: hasSpareValue(part.mtStore),
        isSecondHand: hasSpareValue(part.secondHand)
      })),
    [parts]
  );
  const debouncedQuery = useDebouncedValue(filters.query, 260);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const normalizedQuery = useMemo(() => {
    const raw = deferredQuery.trim();
    return {
      raw,
      lower: raw.toLowerCase(),
      compact: compactSearchText(raw)
    };
  }, [deferredQuery]);

  const filteredParts = useMemo(() => {
    const nextParts: PartRecord[] = [];

    for (const indexed of indexedParts) {
      if (filters.plant.length) {
        const matchesPlant = filters.plant.some((p) =>
          p === "P300 BC" || p === "P300 NOC"
            ? indexed.part.sourceSheet === p
            : inferPlantGroup(indexed.part.sourceSheet, indexed.part.plant) === p
        );
        if (!matchesPlant) continue;
      }
      if (filters.device.length && !filters.device.includes(indexed.deviceFilter)) continue;
      if (filters.brand.length && !filters.brand.includes(indexed.brandFilter)) continue;
      if (filters.status === "obsolete" && !indexed.statusText.includes("obsolete")) continue;
      if (!matchesSpareFilter(indexed.inMtStore, indexed.isSecondHand, filters.spare)) continue;
      if (normalizedQuery.raw) {
        const search = getIndexedSearch(indexed);
        if (!search.lower.includes(normalizedQuery.lower) && !search.compact.includes(normalizedQuery.compact)) {
          continue;
        }
      }

      nextParts.push(indexed.part);
    }

    return nextParts;
  }, [filters.brand, filters.device, filters.plant, filters.spare, filters.status, indexedParts, normalizedQuery]);

  const groups = useMemo(() => groupParts(filteredParts), [filteredParts]);
  const visiblePartIds = useMemo(() => filteredParts.map((part) => part.id), [filteredParts]);
  const selectedVisibleCount = useMemo(
    () => {
      if (!selectedPartIds.size) {
        return 0;
      }

      let count = 0;
      for (const id of visiblePartIds) {
        if (selectedPartIds.has(id)) {
          count += 1;
        }
      }
      return count;
    },
    [selectedPartIds, visiblePartIds]
  );
  const allVisibleSelected = visiblePartIds.length > 0 && selectedVisibleCount === visiblePartIds.length;
  const activeFilterCount = [
    filters.query.trim() ? 1 : 0,
    filters.plant.length ? 1 : 0,
    filters.device.length ? 1 : 0,
    filters.brand.length ? 1 : 0,
    filters.status !== "all" ? 1 : 0,
    filters.spare !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);
  const filterSummary = loading
    ? "Loading data"
    : activeFilterCount
      ? [
        filters.query.trim() ? `"${filters.query.trim()}"` : "",
        filters.plant.length ? `Plant ${filters.plant.join(", ")}` : "",
        filters.device.length ? `Device ${filters.device.join(", ")}` : "",
        filters.brand.length ? `Brand ${filters.brand.join(", ")}` : "",
        filters.status === "obsolete" ? "Obsolete" : "",
        filters.spare !== "all" ? spareFilterLabels[filters.spare] : ""
      ]
        .filter(Boolean)
        .join(" / ")
      : "Showing all machines";

  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupKey("");
      setSelectedPartId(null);
      return;
    }

    const group = groups.find((candidate) => candidate.key === selectedGroupKey) ?? groups[0];
    if (group.key !== selectedGroupKey) {
      setSelectedGroupKey(group.key);
    }
    if (!selectedPartId || !group.parts.some((part) => part.id === selectedPartId)) {
      setSelectedPartId(group.parts[0]?.id ?? null);
    }
  }, [groups, selectedGroupKey, selectedPartId]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.key === selectedGroupKey) ?? groups[0],
    [groups, selectedGroupKey]
  );
  const selectedPart = useMemo(
    () => selectedGroup?.parts.find((part) => part.id === selectedPartId) ?? selectedGroup?.parts[0] ?? null,
    [selectedGroup, selectedPartId]
  );

  useEffect(() => {
    setSelectedPartIds((current) => {
      if (!current.size) {
        return current;
      }

      const availableIds = new Set(parts.map((part) => part.id));
      const next = new Set(Array.from(current).filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [parts]);

  const handleAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    try {
      await action();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyAction("");
    }
  };

  const chooseImport = () =>
    handleAction("import", async () => {
      const preview = unwrap(await api.chooseAndPreviewImport());
      if (preview) {
        setImportPreview(preview);
      }
    });

  const commitImport = () =>
    handleAction("commit-import", async () => {
      if (!importPreview) return;
      const result = unwrap(await api.commitImport(importPreview.filePath));
      setImportPreview(null);
      await refresh();
      showToast(`Import complete: ${result.newCount} new, ${result.updatedCount} updated`, "success");
    });

  const saveEditing = () =>
    handleAction("save-part", async () => {
      if (!editingPart) return;
      const activeSections = editModeSections[editingMode];
      const editsMachine = activeSections.includes("machine");
      const editsPartData = activeSections.includes("partGroup") || activeSections.includes("part");

      if (editsMachine && !editingPart.machineName.trim() && !editingPart.machineCode.trim()) {
        showToast("กรุณากรอก Machine Name หรือ Machine Code", "error");
        return;
      }
      if (editsPartData && !editingPart.device.trim() && !editingPart.brand.trim() && !editingPart.model.trim()) {
        showToast("กรุณากรอก Device, Brand หรือ Model อย่างน้อยหนึ่งช่อง", "error");
        return;
      }

      const inferredSourceSheet = inferSourceSheetFromPlant(editingPart.plant, editingPart.location);
      const normalizedEditing =
        inferredSourceSheet && (!editingPart.sourceSheet.trim() || editingPart.sourceSheet === "Manual")
          ? { ...editingPart, sourceSheet: inferredSourceSheet }
          : editingPart;

      if (editingMode === "edit-machine" || editingMode === "edit-group-part") {
        const targetIds = new Set(editingTargetIds);
        const targetParts = parts.filter((part) => targetIds.has(part.id));

        if (!targetParts.length) {
          showToast("ไม่พบข้อมูลที่จะบันทึก", "error");
          return;
        }

        const nextInputs = targetParts.map((targetPart) => {
          const baseInput = asPartInput(targetPart);
          return editingMode === "edit-machine"
            ? {
                ...baseInput,
                sourceSheet: normalizedEditing.sourceSheet,
                plant: normalizedEditing.plant,
                location: normalizedEditing.location,
                machineCode: normalizedEditing.machineCode,
                machineName: normalizedEditing.machineName
              }
            : {
                ...baseInput,
                device: normalizedEditing.device,
                brand: normalizedEditing.brand
              };
        });

        const savedParts = unwrap(await api.saveParts(nextInputs));

        setSnapshot((current) => (current ? upsertParts(current, savedParts) : current));
        clearEditing();
        const anchorPart = savedParts.find((part) => part.id === selectedPartId) ?? savedParts[0];
        if (anchorPart) {
          setSelectedGroupKey(machineGroupIdentity(anchorPart));
          setSelectedPartId(anchorPart.id);
        }
        showToast(editingMode === "edit-machine" ? "Machine updated" : "Part group updated", "success");
        return;
      }

      const saved = unwrap(await api.savePart(normalizedEditing));
      setSnapshot((current) => (current ? upsertPart(current, saved) : current));
      clearEditing();
      setSelectedGroupKey(machineGroupIdentity(saved));
      setSelectedPartId(saved.id);
      showToast("Saved", "success");
    });

  const deleteSelectedPart = () =>
    handleAction("delete-part", async () => {
      if (!selectedPart) return;
      const confirmed = window.confirm(`Delete ${selectedPart.device || selectedPart.model || "selected part"}?`);
      if (!confirmed) return;
      const deletedId = selectedPart.id;
      unwrap(await api.deletePart(deletedId));
      setSnapshot((current) => (current ? removeParts(current, new Set([deletedId])) : current));
      setSelectedPartId(null);
      clearEditing();
      showToast("Deleted", "success");
    });

  const deleteSelectedParts = () =>
    handleAction("delete-selected", async () => {
      const ids = Array.from(selectedPartIds);
      if (!ids.length) return;

      const confirmed = window.confirm(`Delete ${ids.length} selected part${ids.length > 1 ? "s" : ""}?`);
      if (!confirmed) return;

      unwrap(await api.deleteParts(ids));

      setSnapshot((current) => (current ? removeParts(current, new Set(ids)) : current));
      setSelectedPartIds(new Set());
      setSelectedPartId(null);
      clearEditing();
      showToast(`Deleted ${ids.length} selected item${ids.length > 1 ? "s" : ""}`, "success");
    });

  const deleteSelectedMachine = () =>
    handleAction("delete-machine", async () => {
      if (!selectedGroup) return;
      const confirmed = window.confirm(
        `Delete machine ${selectedGroup.machineName || selectedGroup.machineCode || "selected machine"} and ${selectedGroup.parts.length} part${selectedGroup.parts.length > 1 ? "s" : ""}?`
      );
      if (!confirmed) return;

      const ids = selectedGroup.parts.map((part) => part.id);
      unwrap(await api.deleteParts(ids));
      setSnapshot((current) => (current ? removeParts(current, new Set(ids)) : current));
      setSelectedPartIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setSelectedGroupKey("");
      setSelectedPartId(null);
      clearEditing();
      showToast("Machine deleted", "success");
    });

  const deletePartGroup = (partsToDelete: PartRecord[]) =>
    handleAction("delete-part-group", async () => {
      if (!partsToDelete.length) return;
      const firstPart = partsToDelete[0];
      const label = deviceFilterValue(firstPart.device) || firstPart.device || firstPart.brand || "part group";
      const confirmed = window.confirm(
        `Delete ${label} group and ${partsToDelete.length} model${partsToDelete.length > 1 ? "s" : ""}?`
      );
      if (!confirmed) return;

      const ids = partsToDelete.map((part) => part.id);
      unwrap(await api.deleteParts(ids));
      setSnapshot((current) => (current ? removeParts(current, new Set(ids)) : current));
      setSelectedPartIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedPartId && ids.includes(selectedPartId)) {
        setSelectedPartId(null);
      }
      clearEditing();
      showToast("Part group deleted", "success");
    });

  const exportData = () =>
    handleAction("export", async () => {
      const result = unwrap(await api.exportData());
      if (!result.canceled) {
        showToast("Exported Excel file", "success");
      }
    });

  const backup = () =>
    handleAction("backup", async () => {
      const result = unwrap(await api.backupDatabase());
      if (!result.canceled) {
        showToast("Backup saved", "success");
      }
    });

  const restore = () =>
    handleAction("restore", async () => {
      const result = unwrap(await api.restoreDatabase());
      if (!result.canceled) {
        await refresh();
        showToast("Database restored", "success");
      }
    });

  const startAddMachine = () => {
    setEditingMode("add-machine");
    setEditingTargetIds([]);
    setEditingPart({ ...emptyPart });
  };

  const selectedMachineInput = (basePart?: PartRecord): PartInput => {
    const source = basePart ?? selectedGroup?.parts[0];
    return source
      ? {
          ...emptyPart,
          sourceSheet: source.sourceSheet || "Manual",
          plant: source.plant,
          location: source.location,
          machineCode: source.machineCode,
          machineName: source.machineName
        }
      : { ...emptyPart };
  };

  const startAddGroupPart = () => {
    if (!selectedGroup) {
      startAddMachine();
      return;
    }

    setEditingMode("add-group-part");
    setEditingTargetIds([]);
    setEditingPart(selectedMachineInput());
  };

  const startAddPart = () => {
    const sourcePart = selectedPart ?? selectedGroup?.parts[0];
    if (!sourcePart) {
      startAddMachine();
      return;
    }

    const base = selectedMachineInput(sourcePart);
    setEditingMode("add-part");
    setEditingTargetIds([]);
    setEditingPart({
      ...base,
      device: sourcePart.device,
      brand: sourcePart.brand,
      model: "",
      quantity: "",
      softwareSupport: "",
      statusOfParts: "",
      mtStore: "",
      secondHand: "",
      actionByMaker: "",
      actionByMt: "",
      howToSolution: ""
    });
  };

  const startEditMachine = () => {
    if (!selectedGroup?.parts.length) {
      return;
    }

    setEditingMode("edit-machine");
    setEditingTargetIds(selectedGroup.parts.map((part) => part.id));
    setEditingPart(asPartInput(selectedGroup.parts[0]));
  };

  const startEditPartGroup = (groupParts: PartRecord[]) => {
    const [firstPart] = groupParts;
    if (!firstPart) {
      return;
    }

    setEditingMode("edit-group-part");
    setEditingTargetIds(groupParts.map((part) => part.id));
    setEditingPart(asPartInput(firstPart));
    setSelectedPartId(firstPart.id);
  };

  const startEditPart = (part = selectedPart) => {
    if (part) {
      setEditingMode("edit-part");
      setEditingTargetIds([part.id]);
      setEditingPart(asPartInput(part));
    }
  };

  const updateEditing = (key: keyof PartInput, value: string) => {
    setEditingPart((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };

      if (key === "plant" || key === "location") {
        const currentInferred = inferSourceSheetFromPlant(current.plant, current.location);
        const nextInferred = inferSourceSheetFromPlant(next.plant, next.location);
        const canAutoUpdateSource =
          nextInferred &&
          (!next.sourceSheet.trim() || next.sourceSheet === "Manual" || next.sourceSheet === currentInferred);

        if (canAutoUpdateSource) {
          next.sourceSheet = nextInferred;
        }
      }

      if (key === "brand" || key === "device") {
        const hasCustomSoftware =
          current.softwareSupport.trim() && !isKnownSoftwareValue(current.softwareSupport, current);
        const nextDefaultSoftware = defaultSoftwareForPart(next);

        if (!hasCustomSoftware && nextDefaultSoftware) {
          next.softwareSupport = nextDefaultSoftware;
        }
      }

      return next;
    });
  };

  const togglePartSelection = (id: number) => {
    setSelectedPartIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const togglePartsSelection = (ids: number[]) => {
    setSelectedPartIds((current) => {
      const next = new Set(current);
      const normalizedIds = Array.from(new Set(ids));
      const allSelected = normalizedIds.length > 0 && normalizedIds.every((id) => next.has(id));

      for (const id of normalizedIds) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  };

  const toggleGroupSelection = (group: MachineGroup) => {
    setSelectedPartIds((current) => {
      const next = new Set(current);
      const groupIds = group.parts.map((part) => part.id);
      const allSelected = groupIds.every((id) => next.has(id));

      for (const id of groupIds) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedPartIds((current) => {
      const next = new Set(current);

      if (allVisibleSelected) {
        for (const id of visiblePartIds) {
          next.delete(id);
        }
      } else {
        for (const id of visiblePartIds) {
          next.add(id);
        }
      }

      return next;
    });
  };

  const showQuickView = (nextFilters: Pick<FilterState, "spare" | "status">, active = false) => {
    setFilters(active ? emptyFilters : { ...emptyFilters, ...nextFilters });
    setSelectedPartIds(new Set());
    clearEditing();
  };

  // Stable ref for keyboard/menu handler params to avoid stale closures
  const handlersRef = useRef({
    chooseImport,
    exportData,
    backup,
    restore,
    startAddMachine,
    startEditPart,
    deleteSelectedPart,
    clearEditing,
    setImportPreview,
    busyAction,
    loading,
    groups,
    selectedGroupKey,
    selectedPart,
    editingPart,
    setSelectedGroupKey,
    setSelectedPartId,
    setShowShortcuts
  });
  useEffect(() => {
    handlersRef.current = {
      chooseImport,
      exportData,
      backup,
      restore,
      startAddMachine,
      startEditPart,
      deleteSelectedPart,
      clearEditing,
      setImportPreview,
      busyAction,
      loading,
      groups,
      selectedGroupKey,
      selectedPart,
      editingPart,
      setSelectedGroupKey,
      setSelectedPartId,
      setShowShortcuts
    };
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      const h = handlersRef.current;

      // Ctrl+F or "/" → focus + select search
      if ((event.ctrlKey && event.key === "f") || (!inInput && event.key === "/")) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Ctrl+N → Add Machine
      if (event.ctrlKey && event.key === "n") {
        event.preventDefault();
        if (!h.busyAction && !h.loading) {
          h.startAddMachine();
        }
        return;
      }

      // Ctrl+E → Edit selected part
      if (event.ctrlKey && !event.shiftKey && event.key === "e") {
        event.preventDefault();
        if (!h.busyAction && h.selectedPart) {
          h.startEditPart(h.selectedPart);
        }
        return;
      }

      // Escape (when not in input) → clear editing + import preview
      if (!inInput && event.key === "Escape") {
        event.preventDefault();
        h.clearEditing();
        h.setImportPreview(null);
        return;
      }

      // ? → show shortcuts overlay
      if (!inInput && event.key === "?") {
        event.preventDefault();
        h.setShowShortcuts(true);
        return;
      }

      // Delete → delete selected part (not in edit mode, not busy)
      if (!inInput && event.key === "Delete") {
        if (!h.busyAction && h.selectedPart && !h.editingPart) {
          event.preventDefault();
          h.deleteSelectedPart();
        }
        return;
      }

      // ArrowDown → navigate to next group in machine list
      if (!inInput && event.key === "ArrowDown") {
        event.preventDefault();
        const currentIdx = h.groups.findIndex((g) => g.key === h.selectedGroupKey);
        const nextIdx = Math.min(currentIdx + 1, h.groups.length - 1);
        const nextGroup = h.groups[nextIdx];
        if (nextGroup && nextGroup.key !== h.selectedGroupKey) {
          h.setSelectedGroupKey(nextGroup.key);
          h.setSelectedPartId(nextGroup.parts[0]?.id ?? null);
          h.clearEditing();
          scrollToMachineGroupRef.current?.(nextIdx);
        }
        return;
      }

      // ArrowUp → navigate to previous group in machine list
      if (!inInput && event.key === "ArrowUp") {
        event.preventDefault();
        const currentIdx = h.groups.findIndex((g) => g.key === h.selectedGroupKey);
        const prevIdx = Math.max(currentIdx - 1, 0);
        const prevGroup = h.groups[prevIdx];
        if (prevGroup && prevGroup.key !== h.selectedGroupKey) {
          h.setSelectedGroupKey(prevGroup.key);
          h.setSelectedPartId(prevGroup.parts[0]?.id ?? null);
          h.clearEditing();
          scrollToMachineGroupRef.current?.(prevIdx);
        }
        return;
      }

      // Ctrl+Shift+E → Export
      if (event.ctrlKey && event.shiftKey && event.key === "E") {
        event.preventDefault();
        h.exportData();
        return;
      }

      // Ctrl+Shift+B → Backup
      if (event.ctrlKey && event.shiftKey && event.key === "B") {
        event.preventDefault();
        h.backup();
        return;
      }

      // Ctrl+Shift+R → Restore
      if (event.ctrlKey && event.shiftKey && event.key === "R") {
        event.preventDefault();
        h.restore();
        return;
      }

      // Ctrl+I → Import
      if (event.ctrlKey && !event.shiftKey && event.key === "i") {
        event.preventDefault();
        h.chooseImport();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Electron menu bridge
  useEffect(() => {
    if (!window.electronMenuBridge) return;
    window.electronMenuBridge.onMenuAction((action) => {
      const h = handlersRef.current;
      if (action === "import") h.chooseImport();
      if (action === "export") h.exportData();
      if (action === "backup") h.backup();
      if (action === "restore") h.restore();
      if (action === "add-machine") {
        if (!h.busyAction && !h.loading) h.startAddMachine();
      }
      if (action === "focus-search") {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (action === "show-shortcuts") h.setShowShortcuts(true);
    });
  }, []); // intentionally only run once

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div className="brand-block">
            <span className="brand-mark" aria-hidden="true">
              <CircuitBoard size={21} />
            </span>
            <div>
              <p>Inventory / Packing Machine</p>
              <h1>Parts Manager PM</h1>
            </div>
          </div>
          <div className="toolbar">
            <button className="ghost-button" onClick={exportData} disabled={Boolean(busyAction) || loading} title="Export Excel  Ctrl+Shift+E">
              <FileDown size={18} />
              Export
            </button>
            <button className="ghost-button" onClick={backup} disabled={Boolean(busyAction) || loading} title="Backup database  Ctrl+Shift+B">
              <DatabaseBackup size={18} />
              Backup
            </button>
            <button className="ghost-button" onClick={restore} disabled={Boolean(busyAction) || loading} title="Restore database  Ctrl+Shift+R">
              <ArchiveRestore size={18} />
              Restore
            </button>
            <span className="toolbar-sep" aria-hidden="true" />
            <button className="primary-button" onClick={chooseImport} disabled={Boolean(busyAction) || loading} title="Import Excel file  Ctrl+I">
              {busyAction === "import" ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
              Import Excel
            </button>
            <button className="ghost-button" onClick={startAddMachine} disabled={Boolean(busyAction) || loading} title="Add new machine  Ctrl+N">
              <Plus size={18} />
              Add Machine
            </button>
            <span className="toolbar-sep" aria-hidden="true" />
            <button className="ghost-button" onClick={() => setShowShortcuts(true)} title="Help & Shortcuts  ?">
              <HelpCircle size={18} />
              Help
            </button>
          </div>
        </header>

        <section className="command-bar" aria-label="Search and filters">
          <label className="global-search">
            <Search size={18} />
            <input
              ref={searchInputRef}
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="ค้นหา: เครื่อง / Code / Plant / Location / Device / Brand / Model"
            />
          </label>
          <div className="quick-filters">
            <MultiFilterSelect
              label="Plant"
              value={filters.plant}
              options={plantFilterOptions}
              onChange={(value) => setFilters((current) => ({ ...current, plant: value }))}
            />
            <MultiFilterSelect
              label="Device"
              value={filters.device}
              options={deviceFilterOptions}
              onChange={(value) => setFilters((current) => ({ ...current, device: value }))}
            />
            <MultiFilterSelect
              label="Brand"
              value={filters.brand}
              options={brandFilterOptions}
              onChange={(value) => setFilters((current) => ({ ...current, brand: value }))}
              searchable
            />
            <button className="reset-button" onClick={() => setFilters(emptyFilters)} disabled={!activeFilterCount}>
              <RotateCcw size={17} />
              Reset
            </button>
          </div>
        </section>

        <section className="summary-strip" aria-label="Summary quick views">
          <SummaryMetricGroup
            items={[
              { label: "Total parts", value: snapshot?.stats.totalParts ?? 0, icon: <Boxes size={16} />, accent: "blue" },
              { label: "Machines", value: snapshot?.stats.machines ?? 0, icon: <Cpu size={16} />, accent: "teal" }
            ]}
            active={!activeFilterCount}
            onClick={() => showQuickView({ spare: "all", status: "all" })}
          />
          <Metric
            label="MT store"
            value={snapshot?.stats.mtStoreParts ?? 0}
            tone="orange"
            icon={<PackagePlus size={16} />}
            active={filters.spare === "mtStore"}
            onClick={() => showQuickView({ spare: "mtStore", status: "all" }, filters.spare === "mtStore")}
          />
          <Metric
            label="Second hand"
            value={snapshot?.stats.secondHandParts ?? 0}
            tone="blue"
            icon={<Recycle size={16} />}
            active={filters.spare === "secondHand"}
            onClick={() => showQuickView({ spare: "secondHand", status: "all" }, filters.spare === "secondHand")}
          />
          <ImportStatusCard lastImport={snapshot?.lastImport ?? null} />
        </section>

        <section className="content-grid">
          <MachineResultsPanel
            scrollToGroupRef={scrollToMachineGroupRef}
            loading={loading}
            hasSnapshot={Boolean(snapshot)}
            groups={groups}
            filteredPartCount={filteredParts.length}
            filterSummary={filterSummary}
            selectedPartIds={selectedPartIds}
            visiblePartIds={visiblePartIds}
            allVisibleSelected={allVisibleSelected}
            selectedGroupKey={selectedGroupKey}
            busy={Boolean(busyAction)}
            onToggleVisibleSelection={toggleVisibleSelection}
            onClearSelected={() => setSelectedPartIds(new Set())}
            onDeleteSelectedParts={deleteSelectedParts}
            onToggleGroupSelection={toggleGroupSelection}
            onSelectGroup={(group) => {
              setSelectedGroupKey(group.key);
              setSelectedPartId(group.parts[0]?.id ?? null);
              clearEditing();
            }}
          />

          {editingPart?.id ? (
            <aside className="detail-panel edit-panel">
              <EditForm
                part={editingPart}
                mode={editingMode}
                deviceOptions={formDeviceOptions}
                brandOptions={formBrandOptions}
                onChange={updateEditing}
                onCancel={clearEditing}
                onSave={saveEditing}
                busy={busyAction === "save-part"}
              />
            </aside>
          ) : selectedGroup && selectedPart ? (
            <DetailView
              group={selectedGroup}
              selectedPart={selectedPart}
              selectedPartId={selectedPartId}
              selectedPartIds={selectedPartIds}
              onSelectPart={setSelectedPartId}
              onTogglePartSelection={togglePartSelection}
              onTogglePartsSelection={togglePartsSelection}
              onEditMachine={startEditMachine}
              onDeleteMachine={deleteSelectedMachine}
              onAddPartGroup={startAddGroupPart}
              onAddPart={startAddPart}
              onEditPartGroup={startEditPartGroup}
              onEditPart={startEditPart}
              onEditSelected={() => startEditPart()}
              onDeletePartGroup={deletePartGroup}
              onDelete={deleteSelectedPart}
              busy={Boolean(busyAction)}
            />
          ) : (
            <aside className="detail-panel empty-detail-panel">
              <div className="empty-detail">
                <div className="empty-detail-icon">
                  {loading ? <Loader2 className="spin" size={32} /> : <CircuitBoard size={32} />}
                </div>
                <strong className="empty-detail-title">
                  {loading ? "Loading data" : "Parts Manager PM"}
                </strong>
                <span className="empty-detail-desc">
                  {loading
                    ? <TypewriterText key="loading" text="กำลังเตรียมรายการเครื่องและอะไหล่ กรุณารอสักครู่..." speed={55} />
                    : <TypewriterText key="ready" text="เลือกเครื่องจากรายการด้านซ้ายเพื่อดูรายละเอียดข้อมูลอะไหล่และ spare parts ของเครื่องนั้น" speed={42} delay={250} />
                  }
                </span>
                {loading ? null : (
                  <button className="primary-button" onClick={startAddMachine}>
                    <Plus size={18} />
                    Add Machine
                  </button>
                )}
              </div>
            </aside>
          )}
        </section>
      </section>

      {importPreview ? (
        <ImportModal
          preview={importPreview}
          busy={busyAction === "commit-import"}
          onCancel={() => setImportPreview(null)}
          onCommit={commitImport}
        />
      ) : null}

      {editingPart && !editingPart.id ? (
        <div className="modal-backdrop">
          <section className="part-modal" role="dialog" aria-modal="true" aria-label={editModeText[editingMode].title}>
            <EditForm
              part={editingPart}
              mode={editingMode}
              deviceOptions={formDeviceOptions}
              brandOptions={formBrandOptions}
              onChange={updateEditing}
              onCancel={clearEditing}
              onSave={saveEditing}
              busy={busyAction === "save-part"}
            />
          </section>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} aria-live={toast.tone === "error" ? "assertive" : "polite"}>{toast.message}</div> : null}

      {showShortcuts ? (
        <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      ) : null}
    </main>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const tips: Array<{ icon: ReactNode; title: string; desc: string }> = [
    { icon: <Search size={14} />, title: "ค้นหาและกรอง", desc: "พิมพ์ชื่อเครื่อง, รหัส, Plant, Location, อุปกรณ์ หรือแบรนด์ในช่องค้นหา แล้วคลิกการ์ด KPI เพื่อกรองเร็ว" },
    { icon: <Plus size={14} />, title: "เพิ่มเครื่องและชิ้นส่วน", desc: "กด Add Machine (Ctrl+N) เพื่อสร้างเครื่องใหม่ จากนั้นเพิ่มชิ้นส่วนภายในเครื่องนั้น" },
    { icon: <Pencil size={14} />, title: "แก้ไขและลบ", desc: "เลือกชิ้นส่วนแล้วกด Ctrl+E เพื่อแก้ไข หรือ Del เพื่อลบ สามารถเลือกหลายรายการแล้วลบพร้อมกันได้" },
    { icon: <Upload size={14} />, title: "นำเข้าจาก Excel", desc: "กด Import Excel (Ctrl+I) เพื่อโหลดข้อมูลจากสเปรดชีต ระบบจะแสดงตัวอย่างก่อนยืนยัน" },
    { icon: <FileDown size={14} />, title: "ส่งออกและสำรองข้อมูล", desc: "Export ข้อมูลเป็น Excel (Ctrl+Shift+E) หรือ Backup ฐานข้อมูล SQLite (Ctrl+Shift+B) เพื่อเก็บสำรอง" }
  ];

  const rows: Array<{ label: string; keys: string[] }> = [
    { label: "Focus Search", keys: ["Ctrl+F", "/"] },
    { label: "Add Machine", keys: ["Ctrl+N"] },
    { label: "Edit Part", keys: ["Ctrl+E"] },
    { label: "Delete Part", keys: ["Del"] },
    { label: "Navigate List", keys: ["↑", "↓"] },
    { label: "Close / Cancel", keys: ["Esc"] },
    { label: "Show Help", keys: ["?"] },
    { label: "Export Excel", keys: ["Ctrl+Shift+E"] },
    { label: "Backup DB", keys: ["Ctrl+Shift+B"] },
    { label: "Restore DB", keys: ["Ctrl+Shift+R"] },
    { label: "Import Excel", keys: ["Ctrl+I"] }
  ];

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-overlay-title">
          <h3>
            <HelpCircle size={16} style={{ marginRight: 8, verticalAlign: "middle", color: "var(--teal)" }} />
            Help
          </h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="help-section">
          <p className="help-section-title">การใช้งาน</p>
          <div className="usage-tips">
            {tips.map((tip) => (
              <div key={tip.title} className="usage-tip">
                <span className="usage-tip-icon">{tip.icon}</span>
                <div className="usage-tip-body">
                  <strong>{tip.title}</strong>
                  <span>{tip.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="help-section">
          <p className="help-section-title">
            <Keyboard size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />
            Keyboard Shortcuts
          </p>
          <div className="shortcuts-table">
            {rows.map((row) => (
              <div key={row.label} className="shortcuts-row">
                <span className="shortcuts-row-label">{row.label}</span>
                <span className="shortcuts-row-keys">
                  {row.keys.map((k, i) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {i > 0 ? <span style={{ color: "var(--faint)", fontSize: 11 }}>or</span> : null}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryMetricGroup({
  items,
  active,
  onClick
}: {
  items: Array<{ label: string; value: number; icon: ReactNode; accent: "blue" | "teal" }>;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`metric metric-button metric-combo ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {items.map((item) => (
        <span className={`metric-segment ${item.accent}`} key={item.label}>
          <span className="metric-kicker">
            <span className="metric-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </span>
          <strong>{item.value.toLocaleString()}</strong>
        </span>
      ))}
    </button>
  );
}

function Metric({
  label,
  value,
  tone,
  icon,
  active,
  onClick
}: {
  label: string;
  value: number;
  tone: string;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="metric-label">
        {icon ? (
          <span className="metric-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </span>
      <strong>{value.toLocaleString()}</strong>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`metric metric-button ${tone} ${active ? "active" : ""}`}
        onClick={onClick}
        aria-pressed={active}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`metric ${tone}`}>
      {content}
    </div>
  );
}

function ImportStatusCard({ lastImport }: { lastImport: ImportRun | null }) {
  return (
    <div className="import-status">
      <span className="status-icon" aria-hidden="true">
        <FileSpreadsheet size={16} />
      </span>
      <div>
        <span>Last import</span>
        <strong>{lastImport ? formatDate(lastImport.importedAt) : "No import yet"}</strong>
        <small>
          New {lastImport?.newCount ?? 0} / Updated {lastImport?.updatedCount ?? 0}
        </small>
      </div>
    </div>
  );
}

function countSelectedParts(parts: PartRecord[], selectedPartIds: Set<number>): number {
  if (!selectedPartIds.size) {
    return 0;
  }

  let selectedCount = 0;
  for (const part of parts) {
    if (selectedPartIds.has(part.id)) {
      selectedCount += 1;
    }
  }
  return selectedCount;
}

function MachineResultsPanel({
  scrollToGroupRef,
  loading,
  hasSnapshot,
  groups,
  filteredPartCount,
  filterSummary,
  selectedPartIds,
  visiblePartIds,
  allVisibleSelected,
  selectedGroupKey,
  busy,
  onToggleVisibleSelection,
  onClearSelected,
  onDeleteSelectedParts,
  onToggleGroupSelection,
  onSelectGroup
}: {
  scrollToGroupRef?: MutableRefObject<((index: number) => void) | null>;
  loading: boolean;
  hasSnapshot: boolean;
  groups: MachineGroup[];
  filteredPartCount: number;
  filterSummary: string;
  selectedPartIds: Set<number>;
  visiblePartIds: number[];
  allVisibleSelected: boolean;
  selectedGroupKey: string;
  busy: boolean;
  onToggleVisibleSelection: () => void;
  onClearSelected: () => void;
  onDeleteSelectedParts: () => void;
  onToggleGroupSelection: (group: MachineGroup) => void;
  onSelectGroup: (group: MachineGroup) => void;
}) {
  const machineWindow = useVirtualWindow(groups, MACHINE_ROW_ESTIMATE);

  useEffect(() => {
    if (!scrollToGroupRef) return;
    scrollToGroupRef.current = (index: number) => {
      const el = machineWindow.scrollRef.current;
      if (!el) return;
      const targetTop = index * MACHINE_ROW_ESTIMATE;
      const elHeight = el.clientHeight;
      const currentTop = el.scrollTop;
      const itemBottom = targetTop + MACHINE_ROW_ESTIMATE;
      if (targetTop < currentTop + 16) {
        el.scrollTop = Math.max(0, targetTop - MACHINE_ROW_ESTIMATE * 0.5);
      } else if (itemBottom > currentTop + elHeight - 16) {
        el.scrollTop = itemBottom - elHeight + MACHINE_ROW_ESTIMATE * 0.5;
      }
    };
    return () => {
      if (scrollToGroupRef) scrollToGroupRef.current = null;
    };
  });

  return (
    <section className="result-panel">
      <div className="result-header">
        <div className="result-title">
          <span>
            <SlidersHorizontal size={14} />
            Machines
          </span>
          <strong>{loading && !hasSnapshot ? "Loading parts..." : `${groups.length} machines / ${filteredPartCount} parts`}</strong>
          <small>{filterSummary}</small>
        </div>
        <div className="result-actions">
          <div className="selection-toolbar" aria-live="polite">
            <strong>{selectedPartIds.size} selected</strong>
            <button
              type="button"
              className="select-visible"
              onClick={onToggleVisibleSelection}
              disabled={!visiblePartIds.length}
            >
              <CheckCircle2 size={15} />
              {allVisibleSelected ? "Unselect visible" : "Select visible"}
            </button>
            <button type="button" className="clear-selected" onClick={onClearSelected} disabled={!selectedPartIds.size}>
              <X size={15} />
              Clear
            </button>
            <button type="button" className="delete-selected" onClick={onDeleteSelectedParts} disabled={!selectedPartIds.size || busy}>
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="machine-list" ref={machineWindow.scrollRef} onScroll={machineWindow.onScroll}>
        {machineWindow.paddingTop ? <div className="virtual-spacer" style={{ height: machineWindow.paddingTop }} /> : null}
        {machineWindow.virtualItems.map(({ item: group }) => {
          const selectedCount = countSelectedParts(group.parts, selectedPartIds);
          const selectionClass =
            selectedCount === 0 ? "" : selectedCount === group.parts.length ? "selection-full" : "selection-partial";

          return (
            <div key={group.key} className={`machine-row ${group.key === selectedGroupKey ? "selected" : ""} ${selectionClass}`}>
              <GroupCheckbox group={group} selectedPartIds={selectedPartIds} onToggle={() => onToggleGroupSelection(group)} />
              <button type="button" className="machine-content" onClick={() => onSelectGroup(group)}>
                <div className="machine-row-top">
                  <div className="machine-title">
                    <div>
                      <strong>{group.machineName || "Unnamed machine"}</strong>
                      <span>{group.machineCode || "No machine code"}</span>
                    </div>
                  </div>
                  <em>{group.parts.length} part{group.parts.length > 1 ? "s" : ""}</em>
                </div>
                <div className="machine-meta">
                  <span>Plant {formatPlantLabel(group.sourceSheet, group.plant)}</span>
                </div>
                <div className="part-chip-row">
                  {group.parts.slice(0, 4).map((part) => (
                    <span key={part.id} className={part.statusOfParts.toLowerCase().includes("obsolete") ? "danger" : ""}>
                      {part.device || "Part"} · {part.brand || "-"} · {part.quantity || "0"}
                    </span>
                  ))}
                  {group.parts.length > 4 ? <span>+{group.parts.length - 4}</span> : null}
                </div>
              </button>
            </div>
          );
        })}
        {machineWindow.paddingBottom ? <div className="virtual-spacer" style={{ height: machineWindow.paddingBottom }} /> : null}
        {loading && !groups.length ? (
          <div className="empty-state">
            <Loader2 className="spin" size={34} />
            <strong>Loading data</strong>
            <span><TypewriterText key="list-loading" text="กำลังโหลดข้อมูลจากฐานข้อมูล..." speed={55} /></span>
          </div>
        ) : null}
        {!loading && !groups.length ? (
          <div className="empty-state">
            <FileSpreadsheet size={34} />
            <strong>No matching parts</strong>
            <span><TypewriterText key="list-empty" text="ปรับ filter หรือ import Excel เพื่อเริ่มใช้งาน" speed={48} delay={150} /></span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GroupCheckbox({
  group,
  selectedPartIds,
  onToggle
}: {
  group: MachineGroup;
  selectedPartIds: Set<number>;
  onToggle: () => void;
}) {
  const selectedCount = countSelectedParts(group.parts, selectedPartIds);
  const checked = group.parts.length > 0 && selectedCount === group.parts.length;
  const indeterminate = selectedCount > 0 && selectedCount < group.parts.length;

  return (
    <label
      className="select-box group-select"
      title={`Select ${group.parts.length} parts`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        ref={(input) => {
          if (input) {
            input.indeterminate = indeterminate;
          }
        }}
        aria-label={`Select parts for ${group.machineName || "machine"}`}
        onChange={onToggle}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function MachineOverview({
  group,
  busy,
  onEdit,
  onDelete
}: {
  group: MachineGroup;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const plantInfo = plantMeta(group.sourceSheet, group.plant, group.location);
  const partClusters = useMemo(() => groupPartClusters(group.parts), [group.parts]);
  const partSummary = `${partClusters.length} group${partClusters.length > 1 ? "s" : ""} / ${group.parts.length} model${
    group.parts.length > 1 ? "s" : ""
  }`;

  return (
    <section className="machine-overview" aria-label="Selected machine details">
      <div className="machine-overview-title">
        <div>
          <span>Selected machine</span>
          <div className="machine-name-line">
            <strong>{group.machineName || "Unnamed machine"}</strong>
            <em>{partSummary}</em>
          </div>
        </div>
        <div className="machine-overview-actions">
          <button type="button" onClick={onEdit} disabled={busy} title="Edit machine" aria-label="Edit machine">
            <Pencil size={15} />
            Edit
          </button>
          <button
            type="button"
            className="danger-action"
            onClick={onDelete}
            disabled={busy}
            title="Delete machine"
            aria-label="Delete machine"
          >
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </div>
      <div className="machine-overview-grid">
        <span><b>Code</b>{group.machineCode || "-"}</span>
        <span><b>Plant</b>{formatPlantLabel(group.sourceSheet, group.plant)}</span>
        <span><b>Location</b>{plantInfo.location}</span>
      </div>
    </section>
  );
}

function MultiFilterSelect({
  label,
  value,
  options,
  onChange,
  searchable = false
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visibleOptions = useMemo(() => {
    if (!searchable || !term.trim()) return options;
    const q = filterKey(term);
    return options.filter((o) => filterKey(o).includes(q));
  }, [options, searchable, term]);

  const toggle = (option: string) => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };

  const displayLabel =
    value.length === 0 ? label : value.length === 1 ? value[0] : `${label} (${value.length})`;

  useEffect(() => {
    if (!open) {
      setTerm("");
    } else {
      window.setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className={`field multi-filter-field ${value.length ? "has-value" : ""}`} ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="multi-filter-trigger"
        onClick={() => setOpen((c) => !c)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="multi-filter-label">{displayLabel}</span>
        <ChevronDown size={14} className={`multi-filter-chevron ${open ? "open" : ""}`} />
      </button>
      {open ? (
        <div className="combo-options multi-filter-options" role="listbox" aria-multiselectable="true">
          {searchable ? (
            <div className="multi-filter-search">
              <Search size={13} />
              <input
                ref={searchRef}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                placeholder={`ค้นหา ${label}...`}
              />
            </div>
          ) : null}
          {value.length > 0 ? (
            <button
              type="button"
              className="multi-filter-clear"
              onMouseDown={(e) => { e.preventDefault(); onChange([]); setOpen(false); }}
            >
              <X size={12} />
              Clear {label}
            </button>
          ) : null}
          {visibleOptions.map((option) => {
            const checked = value.includes(option);
            return (
              <label
                key={option}
                className={`multi-filter-option ${checked ? "checked" : ""}`}
                role="option"
                aria-selected={checked}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option)}
                />
                <span>{option}</span>
              </label>
            );
          })}
          {!visibleOptions.length ? <div className="combo-empty">No {label} found</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchableFilterSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionsId = `${label.toLowerCase()}-filter-options`;
  const visibleOptions = useMemo(() => {
    const query = filterKey(term);
    if (!query) {
      return options;
    }
    return options.filter((option) => filterKey(option).includes(query));
  }, [options, term]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setTerm(nextValue);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      setTerm(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="field searchable-field">
      <span>{label}</span>
      <div className="combobox" ref={rootRef}>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={optionsId}
          value={open ? term : value}
          onFocus={() => {
            setTerm(value);
            setOpen(true);
          }}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
            if (event.key === "Enter" && visibleOptions[0]) {
              event.preventDefault();
              choose(visibleOptions[0]);
            }
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={label}
          data-filter="brand-combobox"
        />
        <button
          type="button"
          className="combo-trigger"
          aria-label={`Open ${label} options`}
          aria-expanded={open}
          aria-controls={optionsId}
          aria-haspopup="listbox"
          onMouseDown={(event) => {
            event.preventDefault();
            setTerm(value);
            setOpen((current) => !current);
          }}
        >
          <ChevronDown size={16} />
        </button>
        {open ? (
          <div className="combo-options" id={optionsId} role="listbox">
            <button
              type="button"
              className={!value ? "selected" : ""}
              data-value=""
              onMouseDown={(event) => {
                event.preventDefault();
                choose("");
              }}
            >
              All
            </button>
            {visibleOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={option === value ? "selected" : ""}
                data-value={option}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option}
              </button>
            ))}
            {!visibleOptions.length ? <div className="combo-empty">No {label} found</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailView({
  group,
  selectedPart,
  selectedPartId,
  selectedPartIds,
  onSelectPart,
  onTogglePartSelection,
  onTogglePartsSelection,
  onEditMachine,
  onDeleteMachine,
  onAddPartGroup,
  onAddPart,
  onEditPartGroup,
  onEditPart,
  onEditSelected,
  onDeletePartGroup,
  onDelete,
  busy
}: {
  group: MachineGroup;
  selectedPart: PartRecord;
  selectedPartId: number | null;
  selectedPartIds: Set<number>;
  onSelectPart: (id: number) => void;
  onTogglePartSelection: (id: number) => void;
  onTogglePartsSelection: (ids: number[]) => void;
  onEditMachine: () => void;
  onDeleteMachine: () => void;
  onAddPartGroup: () => void;
  onAddPart: () => void;
  onEditPartGroup: (parts: PartRecord[]) => void;
  onEditPart: (part: PartRecord) => void;
  onEditSelected: () => void;
  onDeletePartGroup: (parts: PartRecord[]) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const partClusters = useMemo(() => groupPartClusters(group.parts), [group.parts]);
  const [expandedClusterKeysByGroup, setExpandedClusterKeysByGroup] = useState<Record<string, string[]>>({});
  const activeClusterKeys = useMemo(
    () => new Set(expandedClusterKeysByGroup[group.key] ?? []),
    [expandedClusterKeysByGroup, group.key]
  );

  useEffect(() => {
    setExpandedClusterKeysByGroup((current) => {
      const currentKeys = current[group.key];
      if (!currentKeys?.length) {
        return current;
      }

      const availableKeys = new Set(partClusters.map((cluster) => cluster.key));
      const nextKeys = currentKeys.filter((key) => availableKeys.has(key));

      if (nextKeys.length === currentKeys.length) {
        return current;
      }

      const next = { ...current };
      if (nextKeys.length) {
        next[group.key] = nextKeys;
      } else {
        delete next[group.key];
      }
      return next;
    });
  }, [group.key, partClusters]);

  const toggleCluster = (cluster: PartCluster) => {
    setExpandedClusterKeysByGroup((current) => {
      const nextKeys = new Set(current[group.key] ?? []);
      if (nextKeys.has(cluster.key)) {
        nextKeys.delete(cluster.key);
      } else {
        nextKeys.add(cluster.key);
      }

      const next = { ...current };
      if (nextKeys.size) {
        next[group.key] = Array.from(nextKeys);
      } else {
        delete next[group.key];
      }
      return next;
    });
    onSelectPart(cluster.parts[0]?.id ?? selectedPart.id);
  };

  return (
    <>
      <aside className="parts-panel">
        <MachineOverview group={group} busy={busy} onEdit={onEditMachine} onDelete={onDeleteMachine} />

        <div className="part-section-heading parts-action-heading">
          <div>
            <span>Parts</span>
            <strong>
              {partClusters.length} group{partClusters.length > 1 ? "s" : ""} / {group.parts.length} item{group.parts.length > 1 ? "s" : ""}
            </strong>
          </div>
          <div className="part-panel-actions">
            <button className="compact-button" onClick={onAddPartGroup} disabled={busy}>
              <Plus size={17} />
              Add group part
            </button>
            <button className="accent-button compact-accent" onClick={onAddPart} disabled={busy}>
              <PackagePlus size={17} />
              Add part
            </button>
          </div>
        </div>

        <div className="part-stack">
          {partClusters.map((cluster) => {
            const expanded = activeClusterKeys.has(cluster.key);
            const selectedInCluster = cluster.parts.some((part) => part.id === selectedPartId);
            const selectedCount = cluster.parts.filter((part) => selectedPartIds.has(part.id)).length;
            const allSelected = selectedCount > 0 && selectedCount === cluster.parts.length;
            const indeterminate = selectedCount > 0 && selectedCount < cluster.parts.length;
            const clusterBodyId = `part-cluster-items-${cluster.key.replace(/[^a-z0-9_-]/gi, "-")}`;

            return (
              <div
                key={cluster.key}
                className={`part-cluster part-row ${expanded ? "is-expanded" : ""} ${selectedInCluster ? "selected" : ""} ${
                  allSelected ? "selection-full" : ""
                }`}
              >
                <div className="part-cluster-summary">
                  <label className="select-box part-select" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(input) => {
                        if (input) {
                          input.indeterminate = indeterminate;
                        }
                      }}
                      aria-label={`Select ${cluster.label} parts`}
                      onChange={() => onTogglePartsSelection(cluster.parts.map((part) => part.id))}
                    />
                    <span aria-hidden="true" />
                  </label>
                  <button
                    type="button"
                    className="part-content part-cluster-main"
                    onClick={() => toggleCluster(cluster)}
                    aria-expanded={expanded}
                    aria-controls={clusterBodyId}
                  >
                    <strong>{cluster.label}</strong>
                    <span>{cluster.brandSummary}</span>
                    <em>
                      {cluster.parts.length} model{cluster.parts.length > 1 ? "s" : ""}
                    </em>
                  </button>
                  <button
                    type="button"
                    className={`part-cluster-toggle ${expanded ? "expanded" : ""}`}
                    onClick={() => toggleCluster(cluster)}
                    aria-expanded={expanded}
                    aria-controls={clusterBodyId}
                    aria-label={`${expanded ? "Hide" : "Show"} ${cluster.label} parts`}
                  >
                    <ChevronDown size={17} strokeWidth={2.6} />
                  </button>
                </div>
                {expanded ? (
                  <div className="part-cluster-items" id={clusterBodyId}>
                    <div className="part-cluster-toolbar">
                      <div className="part-cluster-model-title">
                        <Boxes size={14} />
                        <span>
                          {cluster.parts.length} model{cluster.parts.length > 1 ? "s" : ""}
                        </span>
                        <strong>Qty {cluster.quantityLabel}</strong>
                      </div>
                      <div className="part-cluster-actions">
                        <button
                          type="button"
                          className="cluster-action-button"
                          onClick={() => onEditPartGroup(cluster.parts)}
                          disabled={busy}
                          title={`Edit ${cluster.label} group`}
                          aria-label={`Edit ${cluster.label} group`}
                        >
                          <Pencil size={14} />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className="cluster-action-button danger-cluster"
                          onClick={() => onDeletePartGroup(cluster.parts)}
                          disabled={busy}
                          title={`Delete ${cluster.label} group`}
                          aria-label={`Delete ${cluster.label} group`}
                        >
                          <Trash2 size={14} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                    <div className="part-model-list" role="list" aria-label={`${cluster.label} models`}>
                      <div className="part-model-list-head" aria-hidden="true">
                        <span>Model</span>
                        <span>Brand</span>
                        <span>Qty</span>
                      </div>
                      {cluster.parts.map((part) => {
                        const checkedForDelete = selectedPartIds.has(part.id);
                        const partLabel = part.model || part.device || "Part";
                        const supportLine = part.device && part.device !== partLabel ? part.device : part.statusOfParts || "Part detail";

                        return (
                          <div
                            key={part.id}
                            role="listitem"
                            className={`part-child-row ${part.id === selectedPartId ? "selected" : ""} ${
                              checkedForDelete ? "selection-full" : ""
                            }`}
                          >
                            <label className="select-box child-select" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checkedForDelete}
                                aria-label={`Select ${part.model || part.device || "part"}`}
                                onChange={() => onTogglePartSelection(part.id)}
                              />
                              <span aria-hidden="true" />
                            </label>
                            <button
                              type="button"
                              className="part-child-content"
                              onClick={() => onSelectPart(part.id)}
                              aria-current={part.id === selectedPartId ? "true" : undefined}
                            >
                              <strong>{partLabel}</strong>
                              <small>{supportLine}</small>
                              <span>{part.brand || "-"}</span>
                              <em>{part.quantity || "0"}</em>
                            </button>
                            <button
                              type="button"
                              className="part-child-edit"
                              onClick={() => onEditPart(part)}
                              disabled={busy}
                              title={`Edit ${partLabel}`}
                              aria-label={`Edit ${partLabel}`}
                            >
                              <Pencil size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      <aside className="detail-panel selected-detail-panel">
        <div className="selected-card">
          <div className="part-card-header">
            <div className="part-card-identity">
              <span className="part-card-type">Selected part</span>
              <h3 className="part-card-name">{selectedPart.device || selectedPart.model || "Part detail"}</h3>
            </div>
            <div className="part-card-actions">
              <button type="button" className="primary-button compact-accent" onClick={onEditSelected} disabled={busy}>
                <Pencil size={15} />
                Edit
              </button>
              <button type="button" className="ghost-button compact-accent danger-action" onClick={onDelete} disabled={busy}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </div>

          <dl className="detail-list">
            <Info label="Brand" value={selectedPart.brand} />
            <Info label="Model" value={selectedPart.model} />
            <Info label="Quantity" value={selectedPart.quantity || "0"} />
            <Info label="Status" value={selectedPart.statusOfParts || "-"} danger={selectedPart.statusOfParts.toLowerCase().includes("obsolete")} />
            <Info label="Software Support" value={selectedPart.softwareSupport || "-"} wide />
          </dl>

          <div className="spare-section">
            <div className="spare-section-title">
              <PackagePlus size={14} />
              Spare parts
            </div>
            <div className="spare-grid">
              <SparePart label="MT Store" value={selectedPart.mtStore} icon={<Boxes size={20} />} />
              <SparePart label="Second hand" value={selectedPart.secondHand} icon={<Recycle size={20} />} />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Info({ label, value, wide, danger }: { label: string; value: string; wide?: boolean; danger?: boolean }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd className={danger ? "danger-text" : ""}>{value}</dd>
    </div>
  );
}

function SparePart({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  const available = !!value && value !== "-";
  return (
    <div className={`spare-card ${available ? "spare-on" : "spare-off"}`}>
      <div className="spare-card-top">
        <div className="spare-card-icon">{icon}</div>
        <div className={`spare-badge ${available ? "available" : ""}`}>
          {available ? <><CheckCircle2 size={11} />Available</> : "—"}
        </div>
      </div>
      <span className="spare-card-label">{label}</span>
      <strong className="spare-card-value">{available ? value : "Not available"}</strong>
    </div>
  );
}

function TypewriterText({ text, speed = 45, delay = 0 }: { text: string; speed?: number; delay?: number }) {
  const [len, setLen] = useState(0);
  const [active, setActive] = useState(delay === 0);

  useEffect(() => {
    setLen(0);
    setActive(false);
    if (delay === 0) { setActive(true); return; }
    const t = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(t);
  }, [text, delay]);

  useEffect(() => {
    if (!active || len >= text.length) return;
    const t = setTimeout(() => setLen(l => l + 1), speed);
    return () => clearTimeout(t);
  }, [active, len, text, speed]);

  const done = len >= text.length;
  return (
    <>
      {text.slice(0, len)}
      <span className={`tw-cursor${done ? " done" : ""}`} aria-hidden="true" />
    </>
  );
}

function FormSelectField({
  label,
  value,
  options,
  optionLabels = {},
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const hasKnownValue = !value || options.includes(value);

  return (
    <label className="field text-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {!hasKnownValue ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function EditableComboField({
  label,
  value,
  options,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(value);
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionsId = `${filterKey(label) || "editable"}-form-options`;
  const mergedOptions = useMemo(() => uniqueByFilterKey([value, ...options]), [options, value]);
  const visibleOptions = useMemo(() => {
    if (showAll) {
      return mergedOptions;
    }

    const query = filterKey(term);
    if (!query) {
      return mergedOptions;
    }

    return mergedOptions.filter((option) => filterKey(option).includes(query));
  }, [mergedOptions, showAll, term]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setTerm(nextValue);
    setShowAll(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      setTerm(value);
      setShowAll(false);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="field text-field searchable-field">
      <span>{label}</span>
      <div className="combobox" ref={rootRef}>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={optionsId}
          value={open ? term : value}
          onFocus={() => {
            setTerm(value);
            setOpen(true);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setTerm(nextValue);
            setShowAll(false);
            setOpen(true);
            onChange(nextValue);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
            if (event.key === "Enter" && visibleOptions[0]) {
              event.preventDefault();
              choose(visibleOptions[0]);
            }
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="combo-trigger"
          aria-label={`Open ${label} options`}
          aria-expanded={open}
          aria-controls={optionsId}
          aria-haspopup="listbox"
          onMouseDown={(event) => {
            event.preventDefault();
            setTerm(value);
            setShowAll(true);
            setOpen((current) => !current);
          }}
        >
          <ChevronDown size={16} />
        </button>
        {open ? (
          <div className="combo-options" id={optionsId} role="listbox">
            {visibleOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={option === value ? "selected" : ""}
                data-value={option}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option}
              </button>
            ))}
            {!visibleOptions.length ? <div className="combo-empty">No options found</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EditForm({
  part,
  mode,
  deviceOptions,
  brandOptions,
  onChange,
  onCancel,
  onSave,
  busy
}: {
  part: PartInput;
  mode: EditMode;
  deviceOptions: string[];
  brandOptions: string[];
  onChange: (key: keyof PartInput, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const modeText = editModeText[mode];
  const visibleSections = editModeSections[mode];
  const visibleFieldGroups = fieldGroups.filter((group) => visibleSections.includes(group.section));
  const showsMachineFields = visibleSections.includes("machine");
  const softwareOptions = useMemo(() => softwareOptionsForPart(part), [part.brand, part.device]);
  const machineDescription = [part.machineName, part.machineCode].filter(Boolean).join(" / ");
  const description = showsMachineFields ? machineDescription || "New machine" : machineDescription || "Selected machine";

  return (
    <form
      className="edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="detail-header">
        <div>
          <span>{modeText.subtitle}</span>
          <h2>{modeText.title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancel">
          <X size={19} />
        </button>
      </div>

      <div className="form-scroll">
        {!showsMachineFields ? (
          <div className="form-context">
            <span>Machine</span>
            <strong>{part.machineName || "Unnamed machine"}</strong>
            <small>{part.machineCode || part.location || part.sourceSheet || "-"}</small>
          </div>
        ) : null}
        {visibleFieldGroups.map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.fields.map((field) => {
              const fieldValue = String(part[field.key] ?? "");

              if (field.key === "sourceSheet") {
                return (
                  <FormSelectField
                    key={String(field.key)}
                    label={field.label}
                    value={fieldValue}
                    options={sourceSheetFormOptions}
                    placeholder="เลือก Plant Group"
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              }

              if (field.key === "plant") {
                return (
                  <FormSelectField
                    key={String(field.key)}
                    label={field.label}
                    value={fieldValue}
                    options={plantCodeOptionValues}
                    optionLabels={plantCodeOptionLabels}
                    placeholder="เลือก Plant"
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              }

              if (field.key === "device") {
                return (
                  <EditableComboField
                    key={String(field.key)}
                    label={field.label}
                    value={fieldValue}
                    options={deviceOptions}
                    placeholder="เลือกหรือพิมพ์ Device"
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              }

              if (field.key === "brand") {
                return (
                  <EditableComboField
                    key={String(field.key)}
                    label={field.label}
                    value={fieldValue}
                    options={brandOptions}
                    placeholder="เลือกหรือพิมพ์ Brand"
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              }

              if (field.key === "softwareSupport") {
                return (
                  <EditableComboField
                    key={String(field.key)}
                    label={field.label}
                    value={fieldValue}
                    options={softwareOptions}
                    placeholder="เลือกหรือพิมพ์ Software"
                    onChange={(value) => onChange(field.key, value)}
                  />
                );
              }

              return (
                <label key={String(field.key)} className="field text-field">
                  <span>{field.label}</span>
                  {field.key === "howToSolution" ? (
                    <textarea
                      value={fieldValue}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      rows={4}
                    />
                  ) : (
                    <input
                      value={fieldValue}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      placeholder={field.placeholder}
                    />
                  )}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>

      <div className="form-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          <X size={17} />
          Cancel
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
          Save
        </button>
      </div>
    </form>
  );
}

function ImportModal({
  preview,
  busy,
  onCancel,
  onCommit
}: {
  preview: ImportPreview;
  busy: boolean;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="import-modal" role="dialog" aria-modal="true" aria-label="Import preview">
        <div className="modal-title">
          <div>
            <span>Import preview</span>
            <h2>ตรวจสอบก่อนบันทึกข้อมูล</h2>
            <p>{preview.filePath}</p>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={19} />
          </button>
        </div>

        <div className="preview-metrics">
          <Metric label="Rows" value={preview.totalRows} tone="blue" />
          <Metric label="New" value={preview.newCount} tone="teal" />
          <Metric label="Updated" value={preview.updatedCount} tone="orange" />
          <Metric label="Unchanged" value={preview.unchangedCount} tone="blue" />
          <Metric label="Skipped" value={preview.skippedCount} tone="coral" />
        </div>

        <div className="sheet-counts">
          {Object.entries(preview.sheetCounts).map(([sheet, count]) => (
            <span key={sheet}>
              {sheet}: <strong>{count}</strong>
            </span>
          ))}
        </div>

        <div className="import-preview-section">
          <div className="import-preview-title">
            <div>
              <span>Sample rows</span>
              <strong>{preview.sampleRows.length} rows shown</strong>
            </div>
            <small>
              Duplicate groups {preview.duplicateGroups} / Skipped rows {preview.skippedRows.length}
            </small>
          </div>
          <div className="sample-table" role="table" aria-label="Sample imported rows">
            <div className="sample-row sample-head" role="row">
              <span role="columnheader">Machine</span>
              <span role="columnheader">Device</span>
              <span role="columnheader">Brand</span>
              <span role="columnheader">Model</span>
            </div>
            {preview.sampleRows.slice(0, 5).map((row, index) => (
              <div className="sample-row" role="row" key={`${row.machineCode}-${row.device}-${row.model}-${index}`}>
                <span role="cell">{row.machineName || row.machineCode || "-"}</span>
                <span role="cell">{row.device || "-"}</span>
                <span role="cell">{row.brand || "-"}</span>
                <span role="cell">{row.model || "-"}</span>
              </div>
            ))}
          </div>
          {preview.skippedRows.length ? (
            <div className="skip-list">
              <strong>Skipped</strong>
              {preview.skippedRows.slice(0, 3).map((row) => (
                <span key={row}>{row}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onCommit} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
            Commit import
          </button>
        </div>
      </section>
    </div>
  );
}
