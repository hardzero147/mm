const rowCount = Number(process.argv[2] ?? 100000);

const sourceSheets = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
const plants = ["1100", "1200", "1300", "1300", "400", "600"];
const locations = ["PK", "PK", "BCPK", "NOC", "LD PAKING", "BD"];
const devices = ["PLC", "HMI", "SERVO DRIVE", "INVERTER", "OPTION CARD", "MAIN MOTOR"];
const brands = ["OMRON", "PRO-FACE", "REXROTH", "FUJI", "B&R", "MITSUBISHI"];

function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
}

function hasSpareValue(value) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== "-" && normalized !== "no" && normalized !== "n/a");
}

function compactSearchText(value) {
  return value.toLowerCase().replace(/[\s\\-_/.:|()[\]]+/g, "");
}

function deviceFilterValue(value) {
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

function brandFilterValue(value) {
  return value.toUpperCase().replace(/[^A-Z0-9&]+/g, "");
}

function partSearchText(part) {
  return [
    part.sourceSheet,
    part.plant,
    part.location,
    part.machineCode,
    part.machineName,
    part.device,
    deviceFilterValue(part.device),
    part.brand,
    brandFilterValue(part.brand),
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
}

function getIndexedSearch(indexed) {
  if (!indexed.search) {
    const text = partSearchText(indexed.part);
    indexed.search = {
      lower: text.toLowerCase(),
      compact: compactSearchText(text)
    };
  }
  return indexed.search;
}

function createParts(count) {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => {
    const familyIndex = index % sourceSheets.length;
    const device = devices[index % devices.length];
    const brand = brands[(index * 2) % brands.length];
    const machineCode = `${sourceSheets[familyIndex].replace(/\s+/g, "")}-${String(index + 1).padStart(6, "0")}`;
    const machineName = `PERF MACHINE ${String(index + 1).padStart(6, "0")}`;
    const model = `${brand.replace(/[^A-Z0-9]/gi, "")}-${String(index + 1).padStart(6, "0")}`;

    return {
      id: index + 1,
      sourceSheet: sourceSheets[familyIndex],
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

function indexParts(parts) {
  return parts.map((part) => ({
    part,
    deviceFilter: deviceFilterValue(part.device),
    brandFilter: brandFilterValue(part.brand),
    statusText: part.statusOfParts.toLowerCase(),
    inMtStore: hasSpareValue(part.mtStore),
    isSecondHand: hasSpareValue(part.secondHand)
  }));
}

function machineGroupIdentity(part) {
  return `${part.sourceSheet}\u001f${part.plant}\u001f${part.location}\u001f${part.machineCode}\u001f${part.machineName}`;
}

function groupParts(parts) {
  const groups = new Map();
  for (const part of parts) {
    const key = machineGroupIdentity(part);
    let existing = groups.get(key);
    if (!existing) {
      existing = { key, parts: [] };
      groups.set(key, existing);
    }
    existing.parts.push(part);
  }
  return Array.from(groups.values());
}

function filterParts(indexedParts, query, device = "", brand = "", status = "all", spare = "all") {
  const raw = query.trim();
  const lower = raw.toLowerCase();
  const compact = compactSearchText(raw);
  const nextParts = [];
  for (const indexed of indexedParts) {
    if (device && indexed.deviceFilter !== device) continue;
    if (brand && indexed.brandFilter !== brand) continue;
    if (status === "obsolete" && !indexed.statusText.includes("obsolete")) continue;
    if (spare === "mtStore" && !indexed.inMtStore) continue;
    if (spare === "secondHand" && !indexed.isSecondHand) continue;
    if (raw) {
      const search = getIndexedSearch(indexed);
      if (!search.lower.includes(lower) && !search.compact.includes(compact)) continue;
    }
    nextParts.push(indexed.part);
  }
  return nextParts;
}

let start = process.hrtime.bigint();
const parts = createParts(rowCount);
const createRowsMs = elapsedMs(start);

start = process.hrtime.bigint();
const indexed = indexParts(parts);
const indexRowsMs = elapsedMs(start);

start = process.hrtime.bigint();
const allGroups = groupParts(parts);
const groupAllMs = elapsedMs(start);

start = process.hrtime.bigint();
const omron = filterParts(indexed, "OMRON");
const searchOmronMs = elapsedMs(start);

start = process.hrtime.bigint();
const omronGroups = groupParts(omron);
const groupOmronMs = elapsedMs(start);

start = process.hrtime.bigint();
const noMatch = filterParts(indexed, "NO_MATCH_100K");
const searchNoMatchMs = elapsedMs(start);

start = process.hrtime.bigint();
const mtStore = filterParts(indexed, "", "", "", "all", "mtStore");
const mtStoreMs = elapsedMs(start);

start = process.hrtime.bigint();
const selectedIds = new Set(parts.map((part) => part.id));
const selectAllIdsMs = elapsedMs(start);

console.log(
  JSON.stringify(
    {
      rowCount,
      createRowsMs,
      indexRowsMs,
      groupAllMs,
      totalGroups: allGroups.length,
      searchOmronMs,
      omronRows: omron.length,
      groupOmronMs,
      omronGroups: omronGroups.length,
      searchNoMatchMs,
      noMatchRows: noMatch.length,
      mtStoreMs,
      mtStoreRows: mtStore.length,
      selectAllIdsMs,
      selectedIds: selectedIds.size
    },
    null,
    2
  )
);
