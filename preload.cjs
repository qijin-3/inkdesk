const { contextBridge, ipcRenderer } = require("electron");
const channels = [
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
];
contextBridge.exposeInMainWorld("desk", {
  web: false,
  flush: (data) => ipcRenderer.sendSync("save-sync", data),
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
