/**
 * 从 GitHub Releases 检测并安装 macOS 更新（electron-packager 打包版）。
 * 仓库需为公开，以便无需 Token 检测与下载。
 * 支持 .zip / .dmg；优先 zip（应用内更新），dmg 亦可。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, net, shell } = require("electron");

const GITHUB_OWNER = "qijin-3";
const GITHUB_REPO = "inkdesk";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

/**
 * 比较 semver（忽略前缀 v）。a>b → 1，a<b → -1，相等 → 0。
 * @param {string} a
 * @param {string} b
 */
function cmpVersion(a, b) {
  const pa = String(a || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      resolve({ code: code ?? 1, stdout, stderr }),
    );
  });
}

/**
 * @param {string} url
 * @param {{ token?: string, accept?: string }} [opts]
 * @returns {Promise<{ status: number, headers: Headers, buffer: Buffer, json?: any, text: string }>}
 */
function fetchBuffer(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Aster-Updater",
      Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const request = net.request({ method: "GET", url });
    for (const [k, v] of Object.entries(headers)) request.setHeader(k, v);
    const chunks = [];
    request.on("response", (response) => {
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          buffer,
          json,
          text,
        });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * 跟随重定向下载二进制（GitHub asset 常 302）。
 * @param {string} url
 * @param {{ token?: string, onProgress?: (msg: string) => void }} opts
 */
async function downloadFile(url, opts = {}) {
  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    const res = await new Promise((resolve, reject) => {
      const headers = { "User-Agent": "Aster-Updater" };
      // API asset URL 必须带 octet-stream，否则会返回 JSON 元数据而非文件
      if (/api\.github\.com\/.+\/releases\/assets\//i.test(current)) {
        headers.Accept = "application/octet-stream";
        headers["X-GitHub-Api-Version"] = "2022-11-28";
      }
      if (opts.token && /github\.com|githubusercontent\.com/i.test(current)) {
        headers.Authorization = `Bearer ${opts.token}`;
        if (!headers.Accept) headers.Accept = "application/octet-stream";
      }
      const request = net.request({ method: "GET", url: current });
      for (const [k, v] of Object.entries(headers)) request.setHeader(k, v);
      const chunks = [];
      let received = 0;
      request.on("response", (response) => {
        const loc = response.headers.location;
        const location = Array.isArray(loc) ? loc[0] : loc;
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          location
        ) {
          response.on("data", () => {});
          response.on("end", () =>
            resolve({ redirect: location, status: response.statusCode }),
          );
          return;
        }
        const total = Number(response.headers["content-length"] || 0);
        response.on("data", (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          if (opts.onProgress && total) {
            opts.onProgress(
              `下载中 ${Math.min(99, Math.round((received / total) * 100))}%`,
            );
          }
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            buffer: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
    if (res.redirect) {
      current = res.redirect;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw Error(`下载失败（HTTP ${res.status}）`);
    }
    return res.buffer;
  }
  throw Error("下载重定向过多");
}

/**
 * 确认下载内容是安装包而非 API JSON/HTML。
 * @param {Buffer} buf
 * @param {string} [name]
 */
function assertPackageBuffer(buf, name = "") {
  if (!buf || buf.length < 64) throw Error("下载内容过小，不是有效安装包");
  const head = buf.subarray(0, Math.min(80, buf.length)).toString("utf8");
  const trimmed = head.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("<")) {
    throw Error(
      "下载到的不是安装包（收到了网页/元数据）。请检查网络后重试，或从 Release 页手动下载。",
    );
  }
  const lower = String(name || "").toLowerCase();
  const looksZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (lower.endsWith(".zip") && !looksZip) {
    throw Error("下载的 zip 文件损坏或格式不正确");
  }
}

/**
 * 从 release JSON 中挑选 mac arm64 安装包（优先 zip，其次 dmg）。
 * @param {any} release
 */
function pickMacAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const scored = assets
    .map((a) => {
      const name = String(a.name || "");
      let score = 0;
      if (/\.zip$/i.test(name)) score += 20;
      else if (/\.dmg$/i.test(name)) score += 15;
      else return { asset: a, score: 0, name };
      if (/mac|darwin|osx/i.test(name)) score += 5;
      if (/arm64|aarch64|apple.?silicon/i.test(name)) score += 3;
      if (/Aster|AsIde|Inkdesk/i.test(name)) score += 2;
      return { asset: a, score, name };
    })
    .filter((x) => x.score >= 15)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.asset || null;
}

/**
 * 资源下载 URL：公开仓库优先 browser_download_url，避免 API 鉴权头问题。
 * @param {any} asset
 */
function assetDownloadUrl(asset) {
  if (!asset) return "";
  return (
    String(asset.browser_download_url || "").trim() ||
    String(asset.url || "").trim()
  );
}

/**
 * 检测是否有新版本。
 */
async function checkForUpdate() {
  const current = app.getVersion();
  const res = await fetchBuffer(RELEASES_API);
  if (res.status === 401 || res.status === 403) {
    throw Error("无法读取 GitHub Release，请确认仓库为公开。");
  }
  if (res.status === 404) {
    throw Error("尚未发布 GitHub Release，或仓库地址不正确。");
  }
  if (res.status < 200 || res.status >= 300) {
    throw Error(`检测更新失败（HTTP ${res.status}）`);
  }
  const release = res.json;
  const latest = String(release.tag_name || release.name || "").replace(
    /^v/i,
    "",
  );
  if (!latest) throw Error("Release 缺少版本号");
  const asset = pickMacAsset(release);
  const available = cmpVersion(latest, current) > 0;
  return {
    current,
    latest,
    available,
    tag: release.tag_name || `v${latest}`,
    notes: String(release.body || "").slice(0, 4000),
    publishedAt: release.published_at || "",
    htmlUrl: release.html_url || RELEASES_PAGE,
    assetName: asset?.name || "",
    assetUrl: assetDownloadUrl(asset),
    assetSize: asset?.size || 0,
    packaged: app.isPackaged,
  };
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function findApp(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (
      e.isDirectory() &&
      (e.name === "Aster.app" ||
        e.name === "AsIde.app" ||
        e.name === "Inkdesk.app")
    )
      return p;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "Applications" || e.name.startsWith(".")) continue;
    const found = findApp(path.join(dir, e.name));
    if (found) return found;
  }
  return null;
}

/**
 * 解压 zip 到目录。
 * @param {string} zipPath
 * @param {string} extractDir
 */
async function extractZip(zipPath, extractDir) {
  const r = await run("ditto", ["-x", "-k", zipPath, extractDir]);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout || "").trim().slice(0, 200);
    throw Error(detail ? `解压失败（${r.code}）：${detail}` : `解压失败（${r.code}）`);
  }
}

/**
 * 挂载 dmg，把 .app 拷到 extractDir，再卸载。
 * @param {string} dmgPath
 * @param {string} extractDir
 */
async function extractDmg(dmgPath, extractDir) {
  const mountPoint = path.join(path.dirname(extractDir), "dmg-mount");
  fs.mkdirSync(mountPoint, { recursive: true });
  const attach = await run("hdiutil", [
    "attach",
    dmgPath,
    "-nobrowse",
    "-readonly",
    "-mountpoint",
    mountPoint,
  ]);
  if (attach.code !== 0) {
    const detail = (attach.stderr || attach.stdout || "").trim().slice(0, 200);
    throw Error(
      detail ? `挂载 DMG 失败（${attach.code}）：${detail}` : `挂载 DMG 失败（${attach.code}）`,
    );
  }
  try {
    const appPath = findApp(mountPoint);
    if (!appPath) throw Error("DMG 中未找到 Aster.app");
    const dest = path.join(extractDir, path.basename(appPath));
    const copy = await run("ditto", [appPath, dest]);
    if (copy.code !== 0) throw Error(`从 DMG 复制应用失败（${copy.code}）`);
  } finally {
    await run("hdiutil", ["detach", mountPoint, "-quiet"]).catch(() =>
      run("hdiutil", ["detach", mountPoint, "-force"]),
    );
  }
}

/**
 * 下载并替换当前 .app，重启。
 * @param {{ assetUrl: string, assetName?: string, onProgress?: (msg: string) => void }} opts
 */
async function downloadAndInstall(opts) {
  if (!app.isPackaged) throw Error("开发模式请直接重新打包，无需在线更新");
  if (process.platform !== "darwin") throw Error("当前仅支持 macOS 更新");
  if (!opts.assetUrl) throw Error("没有可下载的安装包");

  const assetName = String(opts.assetName || path.basename(opts.assetUrl) || "");
  const kind = /\.dmg$/i.test(assetName)
    ? "dmg"
    : /\.zip$/i.test(assetName)
      ? "zip"
      : "";

  opts.onProgress?.("开始下载…");
  const buf = await downloadFile(opts.assetUrl, {
    onProgress: opts.onProgress,
  });
  assertPackageBuffer(buf, assetName);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-update-"));
  const packagePath = path.join(
    work,
    kind === "dmg"
      ? "update.dmg"
      : kind === "zip"
        ? "update.zip"
        : buf[0] === 0x50 && buf[1] === 0x4b
          ? "update.zip"
          : "update.dmg",
  );
  fs.writeFileSync(packagePath, buf);

  const extractDir = path.join(work, "extract");
  fs.mkdirSync(extractDir);
  opts.onProgress?.(packagePath.endsWith(".dmg") ? "正在挂载安装包…" : "正在解压…");
  if (packagePath.endsWith(".dmg")) {
    await extractDmg(packagePath, extractDir);
  } else {
    await extractZip(packagePath, extractDir);
  }

  const newApp = findApp(extractDir);
  if (!newApp) throw Error("安装包中未找到 Aster.app");

  const currentApp = path.resolve(process.execPath, "../../..");
  if (!currentApp.endsWith(".app")) {
    throw Error("无法定位当前应用路径");
  }

  const scriptPath = path.join(work, "install.sh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/bash
set -euo pipefail
OLD="$1"
NEW="$2"
WORK="$3"
sleep 1
for i in $(seq 1 60); do
  if ! pgrep -f "Aster.app/Contents/MacOS/Aster" >/dev/null 2>&1 && \\
     ! pgrep -f "AsIde.app/Contents/MacOS/AsIde" >/dev/null 2>&1 && \\
     ! pgrep -f "Inkdesk.app/Contents/MacOS/Inkdesk" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null || true
xattr -cr "$NEW" 2>/dev/null || true
codesign --force --deep --sign - "$NEW" 2>/dev/null || true
rm -rf "$OLD"
ditto "$NEW" "$OLD"
xattr -cr "$OLD" 2>/dev/null || true
open "$OLD"
rm -rf "$WORK"
`,
    { mode: 0o755 },
  );

  opts.onProgress?.("即将重启并完成安装…");
  spawn("/bin/bash", [scriptPath, currentApp, newApp, work], {
    detached: true,
    stdio: "ignore",
  }).unref();

  setTimeout(() => app.quit(), 400);
  return { ok: true };
}

function openReleasesPage() {
  return shell.openExternal(RELEASES_PAGE);
}

function appInfo() {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    releasesUrl: RELEASES_PAGE,
  };
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASES_PAGE,
  cmpVersion,
  pickMacAsset,
  assetDownloadUrl,
  assertPackageBuffer,
  checkForUpdate,
  downloadAndInstall,
  openReleasesPage,
  appInfo,
};
