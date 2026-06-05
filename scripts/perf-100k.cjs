const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const rowCount = Number(process.argv[2] ?? 100000);
const partsPerMachine = Math.max(1, Number(process.argv[3] ?? 1));
const shouldExport = process.argv.includes("--export");

function ms(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
}

function makeRecord(index, now) {
  const sourceSheets = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
  const plants = ["1100", "1200", "1300", "1300", "400", "600"];
  const locations = ["PK", "PK", "BCPK", "NOC", "LD PAKING", "BD"];
  const devices = ["PLC", "HMI", "SERVO DRIVE", "INVERTER", "OPTION CARD", "MAIN MOTOR"];
  const brands = ["OMRON", "PRO-FACE", "REXROTH", "FUJI", "B&R", "MITSUBISHI"];
  const machineIndex = Math.floor(index / partsPerMachine);
  const familyIndex = machineIndex % sourceSheets.length;
  const device = devices[index % devices.length];
  const brand = brands[(index * 2) % brands.length];
  const machineCode = `${sourceSheets[familyIndex].replace(/\s+/g, "")}-${String(machineIndex + 1).padStart(6, "0")}`;
  const machineName = `PERF MACHINE ${String(machineIndex + 1).padStart(6, "0")}`;
  const model = `${brand.replace(/[^A-Z0-9]/gi, "")}-${String(index + 1).padStart(6, "0")}`;
  const importKey = [
    sourceSheets[familyIndex],
    plants[familyIndex],
    locations[familyIndex],
    machineCode,
    machineName,
    device,
    brand,
    model
  ]
    .map((value) => value.toUpperCase())
    .join("|");

  return [
    sourceSheets[familyIndex],
    importKey,
    0,
    plants[familyIndex],
    locations[familyIndex],
    machineCode,
    machineName,
    device,
    brand,
    model,
    String((index % 4) + 1),
    "",
    index % 17 === 0 ? "Obsolete" : "",
    index % 9 === 0 ? "1" : "",
    index % 23 === 0 ? "1" : "",
    "",
    "",
    "",
    now,
    now,
    now
  ];
}

app.whenReady().then(async () => {
  const { PartsDatabase } = require("../dist/main/database.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "electrical-parts-100k-"));
  const dbPath = path.join(tempDir, "perf.sqlite");
  const exportPath = path.join(tempDir, "perf-export.xlsx");
  const db = new PartsDatabase();

  let start = process.hrtime.bigint();
  await db.initialize(dbPath);
  const initializeMs = ms(start);

  const rawDb = db.requireDb();
  const now = new Date().toISOString();
  start = process.hrtime.bigint();
  rawDb.run("BEGIN TRANSACTION");
  const statement = rawDb.prepare(`
    INSERT INTO parts (
      source_sheet, import_key, duplicate_index, plant, location, machine_code,
      machine_name, device, brand, model, quantity, software_support, status_of_parts,
      mt_store, second_hand, action_by_maker, action_by_mt, how_to_solution,
      created_at, updated_at, last_imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    for (let index = 0; index < rowCount; index += 1) {
      statement.run(makeRecord(index, now));
    }
  } finally {
    statement.free();
  }
  rawDb.run("COMMIT");
  const insertMs = ms(start);

  start = process.hrtime.bigint();
  const snapshot = db.getSnapshot();
  const snapshotMs = ms(start);
  const expectedMachines = Math.ceil(rowCount / partsPerMachine);
  if (snapshot.stats.machines !== expectedMachines) {
    throw new Error(`Expected ${expectedMachines} machines, got ${snapshot.stats.machines}`);
  }

  start = process.hrtime.bigint();
  const edited = db.savePart({ ...snapshot.parts[Math.floor(rowCount / 2)], quantity: "9" });
  const savePartMs = ms(start);

  const batchSize = Math.min(1000, Math.max(0, snapshot.parts.length - Math.floor(rowCount / 3)));
  const batchInputs = snapshot.parts
    .slice(Math.floor(rowCount / 3), Math.floor(rowCount / 3) + batchSize)
    .map((part) => ({ ...part, quantity: "7" }));
  start = process.hrtime.bigint();
  const batchEdited = db.saveParts(batchInputs);
  const savePartsBatchMs = ms(start);

  const deleteIds = snapshot.parts.slice(0, Math.min(1000, snapshot.parts.length)).map((part) => part.id);
  start = process.hrtime.bigint();
  db.deleteParts(deleteIds);
  const deletePartsMs = ms(start);

  start = process.hrtime.bigint();
  const afterDelete = db.getSnapshot();
  const snapshotAfterDeleteMs = ms(start);

  let exportMs = null;
  if (shouldExport) {
    start = process.hrtime.bigint();
    await db.exportToXlsx(exportPath);
    exportMs = ms(start);
  }

  console.log(
    JSON.stringify(
      {
        rowCount,
        partsPerMachine,
        expectedMachines,
        initializeMs,
        insertMs,
        snapshotMs,
        savePartMs,
        editedId: edited.id,
        savePartsBatchCount: batchEdited.length,
        savePartsBatchMs,
        deletePartsCount: deleteIds.length,
        deletePartsMs,
        snapshotAfterDeleteMs,
        finalRows: afterDelete.parts.length,
        stats: afterDelete.stats,
        exportMs,
        exportPath: shouldExport ? exportPath : null,
        dbPath
      },
      null,
      2
    )
  );

  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
