import type { Locale } from "../shared/i18n/types";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { SessionEvent, TrainerApi, TrainRequest } from "../shared/types";

const api: TrainerApi = {
  loadLocale: () => ipcRenderer.invoke("locale:load"),
  saveLocale: (locale) => ipcRenderer.invoke("locale:save", locale),
  onLocaleChange: (cb) => {
    const listener = (_event: IpcRendererEvent, locale: Locale) => cb(locale);
    ipcRenderer.on("locale:changed", listener);
    return () => ipcRenderer.removeListener("locale:changed", listener);
  },
  authStatus: (provider) => ipcRenderer.invoke("auth:status", provider),
  authLogin: (provider) => ipcRenderer.invoke("auth:login", provider),
  listModels: (provider) => ipcRenderer.invoke("models:list", provider),
  pickSkill: () => ipcRenderer.invoke("dialog:skill"),
  pickSkillDestination: () => ipcRenderer.invoke("dialog:skill-destination"),
  pickFolder: () => ipcRenderer.invoke("dialog:folder"),
  listProjectSkills: (workspacePath) => ipcRenderer.invoke("skills:list", workspacePath),
  deriveSkillFields: (skillPath, model, provider) => ipcRenderer.invoke("skill:derive", skillPath, model, provider),
  readSkill: (skillPath) => ipcRenderer.invoke("skill:read", skillPath),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (request: TrainRequest) => ipcRenderer.invoke("settings:save", request),
  start: (request: TrainRequest, sessionId: string) => ipcRenderer.invoke("trainer:start", request, sessionId),
  cancel: (sessionId: string) => ipcRenderer.invoke("trainer:cancel", sessionId),
  writeBack: (sessionId: string) => ipcRenderer.invoke("trainer:writeBack", sessionId),
  openPath: (target) => ipcRenderer.invoke("shell:open", target),
  pickCursorRun: (workspacePath) => ipcRenderer.invoke("runs:pick", workspacePath),
  listCursorRuns: (scope) => ipcRenderer.invoke("runs:catalog", scope),
  chooseCursorRun: (prompt) => ipcRenderer.invoke("runs:choose", prompt),
  cancelCursorRun: () => ipcRenderer.invoke("runs:cancel"),
  onEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: SessionEvent) => cb(payload);
    ipcRenderer.on("trainer:event", listener);
    return () => {
      ipcRenderer.removeListener("trainer:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("trainer", api);
