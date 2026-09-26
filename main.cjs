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
const updater = require("./update.cjs");

if (process.platform === "darwin") {
  app.setName("AsIde");
}

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
    title: "AsIde",
    icon: path.join(__dirname, "assets", "logo.png"),
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
  protocol.handle("inkasset", async (request) => {
    try {
      const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const p =
        new URL(request.url).hostname === "vault"
          ? desk.vaultAsset(id)
          : desk.allowedAsset(path.join(desk.data, "assets", id));
      const res = await net.fetch(pathToFileURL(p).href);
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(res.body, { status: res.status, headers });
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

ipcMain.handle("app-info", () => updater.appInfo());
ipcMain.handle("update-check", async () => updater.checkForUpdate());
ipcMain.handle("update-install", async (event) => {
  const info = await updater.checkForUpdate();
  if (!info.available) throw Error("已是最新版本");
  if (!info.assetUrl) throw Error("最新 Release 没有 macOS 安装包");
  return updater.downloadAndInstall({
    assetUrl: info.assetUrl,
    onProgress: (text) => event.sender.send("update-progress", text),
  });
});
ipcMain.handle("update-open-releases", () => updater.openReleasesPage());

const passthrough = new Set([
  "skills-list",
  "skills-create",
  "skills-remove",
  "skills-configure",
  "skills-reveal",
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
  "agent-usage",
  "agent-models",
  "agent-test",
  "cancel",
  "published-read",
  "vault-reveal",
  "vault-open",
  "to-draft",
  "published-backup",
  "draft-delete",
  "materials-list",
  "materials-read",
  "materials-delete",
  "materials-link",
  "wechat-draft-push",
  "wechat-test-token",
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
]);

for (const name of passthrough) {
  ipcMain.handle(name, (_, data) => desk.invoke(name, data));
}

ipcMain.handle("skills-import", async (_, data = {}) => {
  const result = await dialog.showOpenDialog({
    title: "选择技能文件夹（含 SKILL.md）",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return desk.invoke("skills-import", {
    ...data,
    sourcePath: result.filePaths[0],
  });
});

ipcMain.handle("wechat-pick-cover", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择公众号默认封面",
    properties: ["openFile"],
    filters: [
      {
        name: "图片",
        extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp"],
      },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0] || null;
});

/**
 * 弹出文件夹选择，切换 Content_OS 内容仓库。
 */
ipcMain.handle("pick-vault", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择内容仓库",
    defaultPath: desk.vault?.root || undefined,
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return desk.setVault(result.filePaths[0]);
});

/**
 * 在当前内容仓库内选择文件夹注册为账号。
 */
ipcMain.handle("pick-account-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择账号文件夹",
    defaultPath: desk.vault?.root || undefined,
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return desk.invoke("account-register", { folder: result.filePaths[0] });
});

/**
 * 为账号选择头像图片并写入仓库。
 */
ipcMain.handle("pick-account-avatar", async (_, data) => {
  const id = typeof data === "string" ? data : data?.id;
  if (!id) throw Error("账号无效");
  const result = await dialog.showOpenDialog({
    title: "选择账号头像",
    properties: ["openFile"],
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
    ],
  });
  if (result.canceled) return null;
  return desk.invoke("account-set-avatar", {
    id,
    filePath: result.filePaths[0],
  });
});

/**
 * 选择已发布文章的本地备份目录。
 */
ipcMain.handle("pick-backup-folder", async (_, data) => {
  const result = await dialog.showOpenDialog({
    title: "选择本地备份目录",
    defaultPath:
      typeof data?.defaultPath === "string" && data.defaultPath
        ? data.defaultPath
        : undefined,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0] || null;
});

ipcMain.handle("project-upload", async (_, data) => {
  // 拖拽 / 网页：直接带路径或 bytes；按钮：弹原生选择框
  if (
    data &&
    typeof data === "object" &&
    (data.filePaths?.length || data.files?.length)
  ) {
    return desk.projectUpload(data);
  }
  const id = typeof data === "string" ? data : data?.id;
  if (!id) return null;
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
      title: "确认发布并归档",
      message: step.message,
      detail: step.detail,
      buttons: ["取消", "确认发布"],
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
    defaultPath: path.join(os.homedir(), "Downloads", "笔记列表明细表.xlsx"),
    properties: ["openFile"],
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("import-notes-preview", (_, data) =>
  desk.importNotesPreview(data),
);
ipcMain.handle("import-notes-apply", (_, data) => desk.importNotesApply(data));

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

ipcMain.handle("export-social", async (_, payload) => {
  if (
    !Array.isArray(payload?.images) ||
    !payload.images.length ||
    payload.images.length > 17
  )
    throw Error("图片数量必须为 1–17 张");
  const buffers = payload.images.map((s) => {
    if (
      typeof s !== "string" ||
      s.length > 24000000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)
    )
      throw Error("无效的 PNG 图片");
    const b = Buffer.from(s.split(",")[1], "base64");
    if (
      b.length < 24 ||
      b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      b.readUInt32BE(16) !== 1200 ||
      b.readUInt32BE(20) !== 1600
    )
      throw Error("图片必须为 1200 × 1600");
    return b;
  });
  const r = await dialog.showOpenDialog({
    title: "选择图文导出目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled) return null;
  const name =
    String(payload.title || "图文")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .slice(0, 60) || "图文";
  const dir = fs.mkdtempSync(path.join(r.filePaths[0], name + "-"));
  try {
    buffers.forEach((b, i) =>
      fs.writeFileSync(
        path.join(dir, String(i + 1).padStart(2, "0") + ".png"),
        b,
        { flag: "wx" },
      ),
    );
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
});
