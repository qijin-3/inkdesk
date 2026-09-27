#!/usr/bin/env node
/**
 * 打包 macOS arm64：产出 .app、.zip、.dmg。
 * 用法：npm run package:mac
 *
 * 会做 ad-hoc 深度签名并清除隔离属性，避免「已损坏」误报。
 * DMG 内附带一键修复脚本，供首次从网上下载后双击使用。
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const ver = pkg.version;
const outDir = path.join(root, `dist-${ver}`);
const appPath = path.join(outDir, "AsIde-darwin-arm64", "AsIde.app");
const zipName = `AsIde-mac-arm64-v${ver}.zip`;
const dmgName = `AsIde-mac-arm64-v${ver}.dmg`;
const zipOut = path.join(root, zipName);
const dmgOut = path.join(root, dmgName);
const bundleId = "com.qijin.aside";

function run(cmd, args, opts = {}) {
  console.log(`→ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

/**
 * 清除隔离属性 + ad-hoc 深度签名，减轻 Gatekeeper「已损坏」误报。
 * @param {string} app
 */
function prepareApp(app) {
  run("xattr", ["-cr", app]);
  run("codesign", ["--force", "--deep", "--sign", "-", app]);
  const check = spawnSync("codesign", ["--verify", "--deep", "--strict", app], {
    encoding: "utf8",
  });
  if (check.status !== 0) {
    console.warn("codesign verify warning:", check.stderr || check.stdout);
  }
}

console.log(`Packaging AsIde v${ver}…`);
run("npm", ["run", "build"]);

const ignore = [
  "^/data(/|$)",
  "^/dist",
  "screenshot-",
  "/(vault|development-vault)\\.json$",
  "/(vault|knowledge|model|note-import|update)\\.test\\.cjs$",
  "/test\\.cjs$",
  "/(smoke|review|social|workflow|packaged|real-vault|live-agent|package-mac|agents-ui|heatmap-ui|usage-ui)[^/]*\\.cjs$",
  "^/dist-",
  "/skills(?:\\.test|-ui-test)\\.cjs$",
  "/agent-(?:models|usage|output)\\.test\\.cjs$",
  "/AsIde-mac-arm64-v.*\\.(zip|dmg)$",
];

const packagerArgs = [
  ".",
  "AsIde",
  "--platform=darwin",
  "--arch=arm64",
  `--out=${outDir}`,
  "--overwrite",
  "--icon=assets/AsIde.icns",
  `--app-bundle-id=${bundleId}`,
  `--app-version=${ver}`,
  `--build-version=${ver}`,
  "--extra-resource=assets/reference-reader",
];
for (const p of ignore) packagerArgs.push(`--ignore=${p}`);

run(
  path.join(root, "node_modules", ".bin", "electron-packager"),
  packagerArgs,
);

if (!fs.existsSync(appPath)) {
  console.error(`Missing app: ${appPath}`);
  process.exit(1);
}

prepareApp(appPath);

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipOut]);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "aside-dmg-"));
try {
  const stagedApp = path.join(stage, "AsIde.app");
  run("ditto", [appPath, stagedApp]);
  prepareApp(stagedApp);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));

  // 一键解除隔离：比每次敲终端方便；装好后双击即可
  const helperName = "若提示已损坏请双击这里.command";
  const helperPath = path.join(stage, helperName);
  fs.writeFileSync(
    helperPath,
    `#!/bin/bash
osascript <<'APPLESCRIPT' 2>/dev/null || true
display notification "正在解除隔离并打开 AsIde…" with title "AsIde"
APPLESCRIPT
APP="/Applications/AsIde.app"
if [ ! -d "$APP" ]; then
  APP="$(cd "$(dirname "$0")" && pwd)/AsIde.app"
fi
if [ ! -d "$APP" ]; then
  osascript -e 'display alert "未找到 AsIde.app" message "请先把 AsIde 拖到「应用程序」文件夹，再双击本脚本。" as critical'
  exit 1
fi
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>/dev/null || true
open "$APP"
`,
    { mode: 0o755 },
  );
  // 去掉 quarantine，避免 .command 本身也无法双击
  run("xattr", ["-cr", helperPath]);

  if (fs.existsSync(dmgOut)) fs.unlinkSync(dmgOut);
  run("hdiutil", [
    "create",
    "-volname",
    `AsIde ${ver}`,
    "-srcfolder",
    stage,
    "-ov",
    "-format",
    "UDZO",
    dmgOut,
  ]);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

const zipStat = fs.statSync(zipOut);
const dmgStat = fs.statSync(dmgOut);
console.log(`\nDone:
  ${zipOut}  (${(zipStat.size / 1e6).toFixed(1)} MB)
  ${dmgOut}  (${(dmgStat.size / 1e6).toFixed(1)} MB)
`);
