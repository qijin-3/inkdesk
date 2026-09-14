const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  ClipboardItem,
  protocol,
  net,
} = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DeskCore } = require("./desk-core.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "inkasset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let desk;

/**
 * 创建 Electron 主窗口并加载渲染页。
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1050,
    minHeight: 700,
    title: "Inkdesk",
    backgroundColor: "#f7f6f2",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  const data =
    process.env.INKDESK_DATA ||
    (app.isPackaged
      ? path.join(app.getPath("userData"), "workspace-v2")
      : path.join(__dirname, "data"));
  if (
    app.isPackaged &&
    !process.env.INKDESK_DATA &&
    !fs.existsSync(path.join(data, "workspace.json"))
  ) {
    const old = path.join(app.getPath("userData"), "workspace");
    if (fs.existsSync(path.join(old, "workspace.json"))) {
      fs.mkdirSync(data, { recursive: true });
      fs.copyFileSync(
        path.join(old, "workspace.json"),
        path.join(data, "workspace.json"),
      );
      if (fs.existsSync(path.join(old, "assets")))
        fs.cpSync(path.join(old, "assets"), path.join(data, "assets"), {
          recursive: true,
        });
    }
  }
  desk = new DeskCore();
  desk.init({
    dataDir: data,
    projectDir: __dirname,
    readerPath: app.isPackaged
      ? path.join(process.resourcesPath, "reference-reader")
      : path.join(__dirname, "assets/reference-reader"),
  });
  protocol.handle("inkasset", (request) => {
    try {
      const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const p =
        new URL(request.url).hostname === "vault"
          ? desk.vaultAsset(id)
          : desk.allowedAsset(path.join(desk.data, "assets", id));
      return net.fetch(pathToFileURL(p).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (desk?.active) desk.active.kill();
  app.quit();
});

const passthrough = new Set([
  "load",
  "save",
  "source",
  "scan",
  "recover-refresh",
  "refresh",
  "import",
  "versions",
  "archive-records",
  "material-read",
  "material-add",
  "model-load",
  "model-save",
  "model-decide",
  "model-restore",
  "profile",
  "profile-read",
  "profile-save",
  "profile-simplify",
  "profile-decide",
  "profile-role",
  "project-refs",
  "project-read",
  "project-toggle",
  "metrics",
  "cancel",
  "published-read",
  "vault-reveal",
  "vault-open",
]);

for (const name of passthrough) {
  ipcMain.handle(name, (_, data) => desk.invoke(name, data));
}

ipcMain.handle("project-upload", async (_, id) => {
  const result = await dialog.showOpenDialog({
    title: "为这篇草稿添加参考文件",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return null;
  return desk.projectUpload({ id, filePaths: result.filePaths });
});

ipcMain.handle("finalize", async (_, id) => {
  let step = await desk.invoke("finalize", id);
  if (step?.needsConfirmation) {
    const result = await dialog.showMessageBox({
      type: "question",
      title: "确认定稿并归档",
      message: step.message,
      detail: step.detail,
      buttons: ["取消", "确认定稿"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    step = await desk.invoke("finalize", {
      id,
      confirmed: true,
      contentSnapshot: step.contentSnapshot,
    });
  }
  return step?.needsConfirmation ? null : step;
});

ipcMain.handle("image", async (_, payload = {}) => {
  if (payload.bytes) return desk.image(payload);
  const r = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
    ],
  });
  if (r.canceled) return null;
  return desk.image({ ...payload, filePath: r.filePaths[0] });
});

ipcMain.handle("pick-note-table", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择笔记列表明细表",
    defaultPath: path.join(
      os.homedir(),
      "Downloads",
      "笔记列表明细表.xlsx",
    ),
    properties: ["openFile"],
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("import-notes-preview", (_, data) =>
  desk.importNotesPreview(data),
);
ipcMain.handle("import-notes-apply", (_, data) =>
  desk.importNotesApply(data),
);

ipcMain.handle("copy", async (_, p) => {
  const payload = { "text/plain": p.text };
  if (p.html) payload["text/html"] = p.html;
  await clipboard.write([new ClipboardItem(payload)]);
  return true;
});

ipcMain.handle("agent", async (event, req) =>
  desk.runAgent(req, (text) => event.sender.send("agent-progress", text)),
);

ipcMain.on("save-sync", (event, next) => {
  try {
    event.returnValue = desk.saveSync(next);
  } catch {
    event.returnValue = false;
  }
});
