const fs = require("node:fs");
const path = require("node:path");
const { diffWords } = require("diff");
function within(root, p) {
  const r = fs.realpathSync(root),
    f = fs.realpathSync(p);
  if (f !== r && !f.startsWith(r + path.sep)) throw Error("文件超出授权目录");
  return f;
}
function scan(root) {
  const out = [];
  function walk(dir, depth) {
    if (depth > 6) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        e.name.startsWith(".") ||
        ["node_modules", "04_Publish"].includes(e.name)
      )
        continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.md$/i.test(e.name) && out.length < 3000)
        out.push({
          path: p,
          name: e.name.replace(/\.md$/i, ""),
          account: (() => {
            const rel = path.relative(root, p);
            const top = rel.split(path.sep)[0];
            return top && !["00_wiki", "Attachment", "_system"].includes(top)
              ? top
              : "";
          })(),
        });
    }
  }
  walk(root, 0);
  return out;
}
function proposedApply(current, base, next) {
  if (current !== base)
    throw Error("正文已变化，请重新生成建议，避免覆盖你的修改。");
  return next;
}
function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quote) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (quote) throw Error("CSV 引号未闭合");
  return rows;
}
module.exports = { within, scan, proposedApply, parseCSV, diffWords };
