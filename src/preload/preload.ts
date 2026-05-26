import { contextBridge, ipcRenderer } from "electron";
import type { ElectricalPartsApi, PartInput } from "../shared/types";

const api: ElectricalPartsApi = {
  getSnapshot: () => ipcRenderer.invoke("parts:getSnapshot"),
  chooseAndPreviewImport: () => ipcRenderer.invoke("parts:chooseAndPreviewImport"),
  commitImport: (filePath: string) => ipcRenderer.invoke("parts:commitImport", filePath),
  savePart: (part: PartInput) => ipcRenderer.invoke("parts:savePart", part),
  saveParts: (parts: PartInput[]) => ipcRenderer.invoke("parts:saveParts", parts),
  deletePart: (id: number) => ipcRenderer.invoke("parts:deletePart", id),
  deleteParts: (ids: number[]) => ipcRenderer.invoke("parts:deleteParts", ids),
  exportData: () => ipcRenderer.invoke("parts:exportData"),
  backupDatabase: () => ipcRenderer.invoke("parts:backupDatabase"),
  restoreDatabase: () => ipcRenderer.invoke("parts:restoreDatabase")
};

contextBridge.exposeInMainWorld("electricalAPI", api);

contextBridge.exposeInMainWorld("electronMenuBridge", {
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on("menu-action", (_event, action: string) => callback(action));
  }
});
