const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entry = path.join(root, "style.css");
const out = path.join(root, "bundle.css");

const src = fs.readFileSync(entry, "utf8");
const imports = [...src.matchAll(/@import\s+url\(['"]\.(\/styles\/[^'"]+\.css)['"]\);/g)].map(
  (m) => m[1],
);
if (!imports.length) {
  console.error("[css] style.css 中未找到 styles/*.css 引用");
  process.exit(1);
}
const parts = imports.map((rel) => {
  const p = path.join(root, rel);
  const css = fs.readFileSync(p, "utf8");
  return `/* ===== ${rel} ===== */\n${css.trim()}\n`;
});
fs.writeFileSync(out, parts.join("\n") + "");
const bytes = fs.statSync(out).size;
console.log(`[css] bundle.css ${bytes} bytes <- ${imports.join(", ")}`);
