import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkbook } from "../src/main/importer";
import { createTestWorkbook } from "./test-workbook.cjs";

async function main() {
  const requestedWorkbookPath = process.argv[2];
  const workbookPath =
    requestedWorkbookPath ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "electrical-parts-import-")), "test.xlsx");
  if (!requestedWorkbookPath) {
    await createTestWorkbook(workbookPath);
  }
  const result = await parseWorkbook(path.resolve(workbookPath));

  console.log(`Workbook: ${workbookPath}`);
  console.log(`Normalized records: ${result.records.length}`);
  console.log(`Skipped rows: ${result.skippedRows.length}`);
  console.table(result.sheetCounts);

  if (result.records.length < 1200) {
    throw new Error(`Expected at least 1,200 normalized records, got ${result.records.length}.`);
  }

  const expectedSheets = ["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"];
  for (const sheet of expectedSheets) {
    if (!result.sheetCounts[sheet]) {
      throw new Error(`Missing imported records for sheet ${sheet}.`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
