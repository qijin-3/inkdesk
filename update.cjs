/**
 * 从 GitHub Releases 检测并安装 macOS 更新（electron-packager 打包版）。
 * 公开仓库可直接访问；私有仓库需在设置中填写具有 Contents 读权限的 Token。
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
 * @param {string} url
 * @param {{ token?: string, accept?: string }} [opts]
 * @returns {Promise<{ status: number, headers: Headers, buffer: Buffer, json?: any, text: string }>}
 */
function fetchBuffer(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "AsIde-Updater",
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
      const headers = { "User-Agent": "AsIde-Updater" };
      if (opts.token && /github\.com|githubusercontent\.com/i.test(current)) {
        headers.Authorization = `Bearer ${opts.token}`;
        headers.Accept = "application/octet-stream";
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
 * 从 release JSON 中挑选 mac arm64 zip。
 * @param {any} release
 */
function pickMacAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const scored = assets
    .map((a) => {
      const name = String(a.name || "");
      let score = 0;
      if (/\.zip$/i.test(name)) score += 10;
      if (/mac|darwin|osx/i.test(name)) score += 5;
      if (/arm64|aarch64|apple.?silicon/i.test(name)) score += 3;
      if (/AsIde|Inkdesk/i.test(name)) score += 2;
      if (/\.dmg$/i.test(name)) score += 1;
      return { asset: a, score, name };
    })
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.asset || null;
}

/**
 * @param {string} [token]
 */
async function checkForUpdate(token) {
  const current = app.getVersion();
  const auth =
    token ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "";
  const res = await fetchBuffer(RELEASES_API, { token: auth || undefined });
  if (res.status === 401 || res.status === 403) {
    throw Error(
      "无法读取 GitHub Release（仓库可能为私有）。请在设置中填写具有读权限的 Token。",
    );
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
    assetUrl: asset?.url || "",
    assetSize: asset?.size || 0,
    packaged: app.isPackaged,
  };
}

/**
 * 下载并替换当前 .app，重启。
 * @param {{ token?: string, assetUrl: string, onProgress?: (msg: string) => void }} opts
 */
async function downloadAndInstall(opts) {
  if (!app.isPackaged) throw Error("开发模式请直接重新打包，无需在线更新");
  if (process.platform !== "darwin") throw Error("当前仅支持 macOS 更新");
  if (!opts.assetUrl) throw Error("没有可下载的安装包");

  const auth =
    opts.token ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "";
  opts.onProgress?.("开始下载…");
  const zipBuf = await downloadFile(opts.assetUrl, {
    token: auth || undefined,
    onProgress: opts.onProgress,
  });
  opts.onProgress?.("正在解压…");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "inkdesk-update-"));
  const zipPath = path.join(work, "update.zip");
  fs.writeFileSync(zipPath, zipBuf);

  const extractDir = path.join(work, "extract");
  fs.mkdirSync(extractDir);
  await new Promise((resolve, reject) => {
    const child = spawn("ditto", ["-x", "-k", zipPath, extractDir], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`解压失败（${code}）`)),
    );
  });

  /** @param {string} dir */
  function findApp(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && (e.name === "AsIde.app" || e.name === "Inkdesk.app"))
        return p;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = findApp(path.join(dir, e.name));
      if (found) return found;
    }
    return null;
  }

  const newApp = findApp(extractDir);
  if (!newApp) throw Error("安装包中未找到 AsIde.app");

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
  if ! pgrep -f "AsIde.app/Contents/MacOS/AsIde" >/dev/null 2>&1 && \
     ! pgrep -f "Inkdesk.app/Contents/MacOS/Inkdesk" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null || true
rm -rf "$OLD"
ditto "$NEW" "$OLD"
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
  checkForUpdate,
  downloadAndInstall,
  openReleasesPage,
  appInfo,
};
