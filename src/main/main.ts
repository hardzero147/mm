import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { ApiResponse, PartInput } from "../shared/types";
import { PartsDatabase } from "./database";

const database = new PartsDatabase();
const allowedDevHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const devServerUrl = getDevServerUrl();
const isDev = Boolean(devServerUrl);
let databaseReady: Promise<void> | null = null;
let mainWindow: BrowserWindow | null = null;
let pendingImportFilePath: string | null = null;

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

function getDevServerUrl(): string | null {
  const rawUrl = process.env.VITE_DEV_SERVER_URL;
  if (!rawUrl || app.isPackaged) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !allowedDevHosts.has(url.hostname)) {
      throw new Error("Invalid development server URL.");
    }
    return url.toString();
  } catch {
    console.warn("Ignoring invalid VITE_DEV_SERVER_URL.");
    return null;
  }
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (devServerUrl) {
      return url.origin === new URL(devServerUrl).origin;
    }

    if (url.protocol !== "file:") {
      return false;
    }

    const rendererIndex = path.resolve(__dirname, "..", "renderer", "index.html").toLowerCase();
    return path.resolve(fileURLToPath(url)).toLowerCase() === rendererIndex;
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error("Blocked IPC call from untrusted renderer.");
  }
}

function resolvePathInput(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid file path.");
  }
  return path.resolve(value);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function resolvePositiveInteger(value: unknown, label: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return numberValue;
}

function resolvePositiveIntegerArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }

  return value.map((item) => resolvePositiveInteger(item, label));
}

function resolvePartInput(value: unknown): PartInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid part payload.");
  }
  return value as PartInput;
}

function resolvePartInputs(value: unknown): PartInput[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid parts payload.");
  }
  return value.map((item) => resolvePartInput(item));
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

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
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
  ipcMain.handle("parts:getSnapshot", async (event) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      return ok(database.getSnapshot());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:chooseAndPreviewImport", async (event) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      pendingImportFilePath = null;
      const result = await dialog.showOpenDialog({
        title: "Import Excel workbook",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx", "xls"] }],
        properties: ["openFile"]
      });
      if (result.canceled || !result.filePaths[0]) {
        return ok(null);
      }
      const preview = await database.previewImport(result.filePaths[0]);
      pendingImportFilePath = preview.filePath;
      return ok(preview);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:commitImport", async (event, filePath: string) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      const requestedPath = resolvePathInput(filePath);
      if (!pendingImportFilePath || !samePath(pendingImportFilePath, requestedPath)) {
        throw new Error("Import file must be previewed before commit.");
      }
      const result = await database.commitImport(pendingImportFilePath);
      pendingImportFilePath = null;
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:savePart", async (event, part: PartInput) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      return ok(database.savePart(resolvePartInput(part)));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:saveParts", async (event, parts: PartInput[]) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      return ok(database.saveParts(resolvePartInputs(parts)));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:deletePart", async (event, id: number) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      const resolvedId = resolvePositiveInteger(id, "part id");
      database.deletePart(resolvedId);
      return ok({ id: resolvedId });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:deleteParts", async (event, ids: number[]) => {
    try {
      assertTrustedSender(event);
      await ensureDatabaseReady();
      const resolvedIds = resolvePositiveIntegerArray(ids, "part ids");
      database.deleteParts(resolvedIds);
      return ok({ ids: resolvedIds });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle("parts:exportData", async (event) => {
    try {
      assertTrustedSender(event);
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
