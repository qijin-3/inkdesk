const { contextBridge, ipcRenderer, webUtils } = require("electron");
const channels = [
  "export-social",
  "load",
  "model-load",
  "model-save",
  "model-decide",
  "model-restore",
  "save",
  "source",
  "scan",
  "import",
  "image",
  "refresh",
  "recover-refresh",
  "finalize",
  "material-read",
  "material-add",
  "versions",
  "archive-records",
  "profile",
  "profile-save",
  "profile-read",
  "profile-role",
  "profile-simplify",
  "profile-decide",
  "project-refs",
  "project-upload",
  "project-read",
  "project-toggle",
  "copy",
  "metrics",
  "agent",
  "cancel",
  "pick-note-table",
  "import-notes-preview",
  "import-notes-apply",
  "published-read",
  "vault-reveal",
  "vault-open",
  "draft-delete",
  "materials-list",
  "materials-read",
  "materials-delete",
  "materials-link",
  "wechat-draft-push",
  "wechat-test-token",
  "wechat-pick-cover",
];
contextBridge.exposeInMainWorld("desk", {
  web: false,
  flush: (data) => ipcRenderer.sendSync("save-sync", data),
  /** 拖拽 File 对象解析本地绝对路径（Electron） */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  call: (name, data) => {
    if (!channels.includes(name)) throw Error("Invalid channel");
    return ipcRenderer.invoke(name, data);
  },
  progress: (fn) => {
    const listener = (_, text) => fn(text);
    ipcRenderer.on("agent-progress", listener);
    return () => ipcRenderer.removeListener("agent-progress", listener);
  },
});
