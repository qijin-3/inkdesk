#!/usr/bin/env node
/**
 * 打包 macOS arm64：产出 .app、.zip、.dmg。
 * 用法：npm run package:mac
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

function run(cmd, args, opts = {}) {
  console.log(`→ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status || 1);
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
  "/agent-(?:models|usage|output)(?:\\.test)?\\.cjs$",
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

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipOut]);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "aside-dmg-"));
try {
  run("ditto", [appPath, path.join(stage, "AsIde.app")]);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
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
