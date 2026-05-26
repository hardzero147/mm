import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { ApiResponse, PartInput } from "../shared/types";
import { PartsDatabase } from "./database";

const database = new PartsDatabase();
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let databaseReady: Promise<void> | null = null;
let mainWindow: BrowserWindow | null = null;

function ensureDatabaseReady(): Promise<void> {
  databaseReady ??= database.initialize();
  return databaseReady;
}

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): ApiResponse<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#242424",
    title: "Parts Manager PM",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
      spellcheck: false
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  const win = mainWindow;
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Import Excel",
          accelerator: "CmdOrCtrl+I",
          click: () => win.webContents.send("menu-action", "import")
        },
        {
          label: "Export Excel",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => win.webContents.send("menu-action", "export")
        },
        { type: "separator" },
        {
          label: "Backup Database",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => win.webContents.send("menu-action", "backup")
        },
        {
          label: "Restore Database",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => win.webContents.send("menu-action", "restore")
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Add Machine",
          accelerator: "CmdOrCtrl+N",
          click: () => win.webContents.send("menu-action", "add-machine")
        },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => win.webContents.send("menu-action", "focus-search")
        }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: "?",
          click: () => win.webContents.send("menu-action", "show-shortcuts")
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function registerIpc(): void {
  ipcMain.handle("parts:getSnapshot", async () => {
    try {
      await ensureDatabaseReady();
      return ok(database.getSnapshot());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:chooseAndPreviewImport", async () => {
    try {
      await ensureDatabaseReady();
      const result = await dialog.showOpenDialog({
        title: "Import Excel workbook",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx", "xls"] }],
        properties: ["openFile"]
      });
      if (result.canceled || !result.filePaths[0]) {
        return ok(null);
      }
      return ok(await database.previewImport(result.filePaths[0]));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:commitImport", async (_event, filePath: string) => {
    try {
      await ensureDatabaseReady();
      return ok(await database.commitImport(filePath));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:savePart", async (_event, part: PartInput) => {
    try {
      await ensureDatabaseReady();
      return ok(database.savePart(part));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:saveParts", async (_event, parts: PartInput[]) => {
    try {
      await ensureDatabaseReady();
      return ok(database.saveParts(parts));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:deletePart", async (_event, id: number) => {
    try {
      await ensureDatabaseReady();
      database.deletePart(id);
      return ok({ id });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:deleteParts", async (_event, ids: number[]) => {
    try {
      await ensureDatabaseReady();
      database.deleteParts(ids);
      return ok({ ids });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:exportData", async () => {
    try {
      await ensureDatabaseReady();
      const result = await dialog.showSaveDialog({
        title: "Export parts data",
        defaultPath: `Electrical Parts Export ${new Date().toISOString().slice(0, 10)}.xlsx`,
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
      });
      if (result.canceled || !result.filePath) {
        return ok({ canceled: true });
      }
      await database.exportToXlsx(result.filePath);
      shell.showItemInFolder(result.filePath);
      return ok({ canceled: false, filePath: result.filePath });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:backupDatabase", async () => {
    try {
      await ensureDatabaseReady();
      const result = await dialog.showSaveDialog({
        title: "Backup database",
        defaultPath: `electrical-parts-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }]
      });
      if (result.canceled || !result.filePath) {
        return ok({ canceled: true });
      }
      database.backupTo(result.filePath);
      shell.showItemInFolder(result.filePath);
      return ok({ canceled: false, filePath: result.filePath });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:restoreDatabase", async () => {
    try {
      await ensureDatabaseReady();
      const result = await dialog.showOpenDialog({
        title: "Restore database backup",
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }],
        properties: ["openFile"]
      });
      if (result.canceled || !result.filePaths[0]) {
        return ok({ canceled: true });
      }
      await database.restoreFrom(result.filePaths[0]);
      return ok({ canceled: false, filePath: result.filePaths[0] });
    } catch (error) {
      return fail(error);
    }
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  void ensureDatabaseReady().catch((error) => {
    console.error("Database initialization failed", error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
