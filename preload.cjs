const { contextBridge, ipcRenderer, webUtils } = require("electron");
const channels = [
  "skills-list",
  "skills-import",
  "skills-create",
  "skills-remove",
  "skills-configure",
  "skills-reveal",
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
  "to-draft",
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
  "agent-models",
  "agent-test",
  "cancel",
  "pick-note-table",
  "import-notes-preview",
  "import-notes-apply",
  "published-read",
  "published-backup",
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
  "pick-vault",
  "pick-account-folder",
  "pick-account-avatar",
  "pick-backup-folder",
  "set-vault",
  "accounts-list",
  "account-create",
  "account-register",
  "account-unregister",
  "account-folder-candidates",
  "account-set-avatar",
  "account-set-backup-path",
  "group-upsert",
  "group-delete",
  "group-set-backup-path",
  "article-set-group",
  "app-info",
  "update-check",
  "update-install",
  "update-open-releases",
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
  updateProgress: (fn) => {
    const listener = (_, text) => fn(text);
    ipcRenderer.on("update-progress", listener);
    return () => ipcRenderer.removeListener("update-progress", listener);
  },
});
