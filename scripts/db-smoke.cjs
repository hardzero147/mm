const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const ExcelJS = require("exceljs");

const workbookPath =
  process.argv[2] || "C:\\Users\\preec\\Downloads\\MASTER ELECTRICAL PARTS PACKING MACHINE.xlsx";

app.whenReady().then(async () => {
  const { PartsDatabase } = require("../dist/main/database.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "electrical-parts-db-"));
  const dbPath = path.join(tempDir, "smoke.sqlite");
  const backupPath = path.join(tempDir, "backup.sqlite");
  const exportPath = path.join(tempDir, "export.xlsx");

  const db = new PartsDatabase();
  await db.initialize(dbPath);

  const preview = await db.previewImport(workbookPath);
  if (preview.totalRows !== 1249 || preview.newCount !== 1249) {
    throw new Error(`Unexpected preview counts: ${JSON.stringify(preview)}`);
  }

  const firstImport = await db.commitImport(workbookPath);
  if (firstImport.newCount !== 1249 || db.getSnapshot().parts.length !== 1249) {
    throw new Error(`Unexpected first import: ${JSON.stringify(firstImport)}`);
  }

  const secondImport = await db.commitImport(workbookPath);
  if (secondImport.unchangedCount !== 1249 || secondImport.newCount !== 0) {
    throw new Error(`Unexpected repeat import: ${JSON.stringify(secondImport)}`);
  }

  await db.exportToXlsx(exportPath);
  if (!fs.existsSync(exportPath) || fs.statSync(exportPath).size < 1000) {
    throw new Error("Export file was not created.");
  }

  const exportedWorkbook = new ExcelJS.Workbook();
  await exportedWorkbook.xlsx.readFile(exportPath);
  const expectedSheets = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
  const exportedSheetNames = exportedWorkbook.worksheets.map((sheet) => sheet.name);
  if (JSON.stringify(exportedSheetNames) !== JSON.stringify(expectedSheets)) {
    throw new Error(`Export sheets do not match template: ${JSON.stringify(exportedSheetNames)}`);
  }
  const firstExportSheet = exportedWorkbook.getWorksheet("P100");
  const cellText = (cellRef) => String(firstExportSheet.getCell(cellRef).value ?? "");
  if (
    cellText("A1") !== "No." ||
    cellText("L1") !== "Spare parts" ||
    cellText("L2") !== " MT store" ||
    cellText("N1") !== "Breakdown Recovery" ||
    cellText("O2") !== "Action by MT"
  ) {
    throw new Error(
      `Export header does not match template shape: ${JSON.stringify({
        A1: cellText("A1"),
        L1: cellText("L1"),
        L2: cellText("L2"),
        N1: cellText("N1"),
        O2: cellText("O2")
      })}`
    );
  }
  const mergeRefs = firstExportSheet.model.merges ?? [];
  for (const mergeRef of ["A1:A2", "L1:M1", "N1:O1", "P1:P2", "A3:A8"]) {
    if (!mergeRefs.includes(mergeRef)) {
      throw new Error(`Export missing merge: ${mergeRef}`);
    }
  }

  const added = db.savePart({
    sourceSheet: "Manual",
    plant: "TEST",
    location: "QA",
    machineCode: "QA-001",
    machineName: "Smoke Machine",
    device: "PLC",
    brand: "TEST BRAND",
    model: "MODEL-1",
    quantity: "1",
    softwareSupport: "",
    statusOfParts: "",
    mtStore: "1",
    secondHand: "",
    actionByMaker: "",
    actionByMt: "",
    howToSolution: "Smoke test"
  });

  const edited = db.savePart({ ...added, quantity: "2", howToSolution: "Edited smoke test" });
  if (edited.quantity !== "2") {
    throw new Error("Edit did not persist.");
  }

  const batchTargets = db.getSnapshot().parts.slice(0, 10);
  const batchEdited = db.saveParts(batchTargets.map((part, index) => ({
    ...part,
    quantity: String(index + 10),
    howToSolution: `Batch smoke ${index + 1}`
  })));
  if (
    batchEdited.length !== batchTargets.length ||
    batchEdited.some((part, index) => part.quantity !== String(index + 10) || part.howToSolution !== `Batch smoke ${index + 1}`)
  ) {
    throw new Error(`Batch edit did not persist: ${JSON.stringify(batchEdited.slice(0, 2))}`);
  }

  db.backupTo(backupPath);
  db.deletePart(edited.id);
  if (db.getSnapshot().parts.length !== 1249) {
    throw new Error("Delete did not persist.");
  }

  await db.restoreFrom(backupPath);
  if (db.getSnapshot().parts.length !== 1250) {
    throw new Error("Restore did not bring back backed-up data.");
  }

  console.log(
    JSON.stringify(
      {
        previewRows: preview.totalRows,
        firstImport: {
          newCount: firstImport.newCount,
          updatedCount: firstImport.updatedCount,
          unchangedCount: firstImport.unchangedCount
        },
        repeatImport: {
          newCount: secondImport.newCount,
          updatedCount: secondImport.updatedCount,
          unchangedCount: secondImport.unchangedCount
        },
        finalRows: db.getSnapshot().parts.length,
        exportPath,
        backupPath
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
