import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { TrainerApi, TrainerEvent, TrainRequest } from "../shared/types";

const api: TrainerApi = {
  authStatus: () => ipcRenderer.invoke("auth:status"),
  authLogin: () => ipcRenderer.invoke("auth:login"),
  listModels: () => ipcRenderer.invoke("models:list"),
  pickSkill: () => ipcRenderer.invoke("dialog:skill"),
  pickSkillDestination: () => ipcRenderer.invoke("dialog:skill-destination"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  listProjectSkills: (workspacePath) => ipcRenderer.invoke("skills:list", workspacePath),
  readSkill: (skillPath) => ipcRenderer.invoke("skill:read", skillPath),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (request: TrainRequest) => ipcRenderer.invoke("settings:save", request),
  start: (request: TrainRequest) => ipcRenderer.invoke("trainer:start", request),
  cancel: () => ipcRenderer.invoke("trainer:cancel"),
  writeBack: () => ipcRenderer.invoke("trainer:writeBack"),
  openPath: (target) => ipcRenderer.invoke("shell:open", target),
  pickCursorRun: (workspacePath) => ipcRenderer.invoke("runs:pick", workspacePath),
  listCursorRuns: (scope) => ipcRenderer.invoke("runs:catalog", scope),
  chooseCursorRun: (prompt) => ipcRenderer.invoke("runs:choose", prompt),
  cancelCursorRun: () => ipcRenderer.invoke("runs:cancel"),
  onEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: TrainerEvent) => cb(payload);
    ipcRenderer.on("trainer:event", listener);
    return () => {
      ipcRenderer.removeListener("trainer:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("trainer", api);
