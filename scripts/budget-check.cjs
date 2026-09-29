// 体积/规模预算门禁：node scripts/budget-check.cjs
// 超预算即非零退出，用于 CI 与本地 PR 自检。
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
// 棘轮预算：以当前实测为基线 +5% 余量，只防回潮不追理想值。
// 想压体积/行数时先降数字再改代码，让 CI 红在 Frequency 之前。
const BUDGET = {
  "bundle.js": 1450 * 1024,
  "bundle.js.gz": 345 * 1024,
  "renderer.js_lines": 5480,
  "style.css_total_lines": 6160,
};
const MODE = process.argv.includes("--warn") ? "warn" : "strict";
const failures = [];
const warnings = [];
function check(name, actual, budget) {
  const row = `${name}: 实际 ${actual} / 预算 ${budget}`;
  if (actual > budget * 1.05) {
    (MODE === "strict" ? failures : warnings).push(row);
  }
}
const bundle = path.join(root, "bundle.js");
if (fs.existsSync(bundle)) {
  const bytes = fs.statSync(bundle).st_size;
  check("bundle.js bytes", bytes, BUDGET["bundle.js"]);
  try {
    const gz = require("zlib").gzipSync(fs.readFileSync(bundle)).length;
    check("bundle.js gzip bytes", gz, BUDGET["bundle.js.gz"]);
  } catch {}
}
const renderer = path.join(root, "renderer.js");
if (fs.existsSync(renderer))
  check(
    "renderer.js lines",
    fs.readFileSync(renderer, "utf8").split("\n").length,
    BUDGET["renderer.js_lines"],
  );
let cssLines = 0;
for (const f of ["style.css", ...fs.readdirSync(path.join(root, "styles")).map((x) => "styles/" + x)]) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) cssLines += fs.readFileSync(p, "utf8").split("\n").length;
}
check("css total lines", cssLines, BUDGET["style.css_total_lines"]);
for (const f of fs.readdirSync(path.join(root, "ui"))) {
  const n = fs.readFileSync(path.join(root, "ui", f), "utf8").split("\n").length;
  if (n > 600) warnings.push(`ui/${f} ${n} 行 > 600 行目标`);
}
console.log(`[budget] mode=${MODE}`);
[...failures, ...warnings].forEach((w) => console.log(" - " + w));
if (!failures.length && !warnings.length) console.log(" - 全部在预算内");
if (failures.length) {
  console.error(`[budget] ${failures.length} 项超预算`);
  process.exit(1);
}
if (warnings.length && MODE === "warn")
  console.log("[budget] warning 模式：只提示不阻塞");
