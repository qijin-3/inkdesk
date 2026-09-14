const fs = require("node:fs");
const XLSX = require("xlsx");

const HEADERS = [
  "笔记标题",
  "首次发布时间",
  "体裁",
  "曝光",
  "观看量",
  "封面点击率",
  "点赞",
  "评论",
  "收藏",
  "涨粉",
  "分享",
  "人均观看时长",
  "弹幕",
];

/**
 * 规范化标题以便模糊匹配。
 * @param {string} s
 */
function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s\u3000|｜:：]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * 解析小红书导出日期为 YYYY-MM-DD。
 * @param {string} raw
 */
function parsePublishDate(raw) {
  const m = String(raw || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

/**
 * 解析笔记列表明细 xlsx 为结构化行。
 * @param {string|Buffer} input
 */
function parseNoteTable(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  let headerAt = matrix.findIndex((row) => row?.[0] === "笔记标题");
  if (headerAt < 0) headerAt = 1;
  const out = [];
  for (const row of matrix.slice(headerAt + 1)) {
    if (!row?.[0] || String(row[0]).includes("最多导出")) continue;
    const item = { title: String(row[0]).trim() };
    HEADERS.forEach((key, i) => {
      if (key === "笔记标题") return;
      item[key] = row[i] ?? null;
    });
    out.push(item);
  }
  return out;
}

/**
 * 将表格行转为归档 YAML 字段。
 * @param {object} row
 */
function rowToYaml(row) {
  const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    发布时间: parsePublishDate(row["首次发布时间"]),
    体裁: row["体裁"] || null,
    曝光: num(row["曝光"]),
    观看量: num(row["观看量"]),
    封面点击率: num(row["封面点击率"]),
    点赞: num(row["点赞"]),
    评论: num(row["评论"]),
    收藏: num(row["收藏"]),
    涨粉: num(row["涨粉"]),
    分享: num(row["分享"]),
    人均观看时长: num(row["人均观看时长"]),
  };
}

/**
 * 标题相似度 0–1，用于匹配建议排序。
 * @param {string} a
 * @param {string} b
 */
function titleScore(a, b) {
  const x = normalizeTitle(a),
    y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x))
    return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  let hits = 0;
  const shorter = x.length <= y.length ? x : y,
    longer = x.length <= y.length ? y : x;
  for (let i = 0; i < shorter.length; i++)
    if (longer.includes(shorter[i])) hits++;
  const charScore = hits / longer.length;
  let best = 0;
  for (let len = Math.min(6, shorter.length); len >= 2; len--) {
    for (let i = 0; i <= shorter.length - len; i++) {
      if (longer.includes(shorter.slice(i, i + len))) {
        best = Math.max(best, len / longer.length);
        break;
      }
    }
    if (best) break;
  }
  return Math.max(charScore * 0.5, best);
}

/**
 * 在归档列表中为表格行寻找匹配；不唯一时附带排序后的建议。
 * @param {object[]} rows
 * @param {{ title: string, path: string, date?: string|null }[]} archives
 */
function matchNoteRows(rows, archives) {
  const used = new Set();
  const matched = [];
  const unmatched = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = normalizeTitle(row.title);
    const scored = archives
      .filter((a) => !used.has(a.path))
      .map((a) => ({
        ...a,
        score: titleScore(row.title, a.title),
      }))
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score || String(b.date || "").localeCompare(String(a.date || "")));
    const exact = scored.filter((a) => {
      const t = normalizeTitle(a.title);
      return t === key || t.includes(key) || key.includes(t);
    });
    if (exact.length === 1 && exact[0].score >= 0.55) {
      used.add(exact[0].path);
      matched.push({
        index: i,
        path: exact[0].path,
        row,
        auto: true,
        score: exact[0].score,
      });
    } else {
      unmatched.push({
        index: i,
        row,
        suggestions: scored.slice(0, 5).map((a) => ({
          path: a.path,
          title: a.title,
          date: a.date || null,
          score: Math.round(a.score * 100),
        })),
      });
    }
  }
  return { matched, unmatched };
}

module.exports = {
  parseNoteTable,
  rowToYaml,
  matchNoteRows,
  normalizeTitle,
  parsePublishDate,
  titleScore,
};
