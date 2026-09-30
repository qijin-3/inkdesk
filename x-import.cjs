const fs = require("node:fs");

/**
 * 规范化 CSV 表头键（小写、去空白）。
 * @param {string} s
 */
function normHeader(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
}

/**
 * 将一行 CSV 拆成字段（支持引号包裹与转义引号）。
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * 解析 X Analytics 导出日期为 YYYY-MM-DD。
 * @param {string} raw
 */
function parseXDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy)
    return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

/**
 * 从表头名映射到标准字段。
 * @param {string[]} headers
 */
function mapHeaders(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const k = normHeader(h);
    if (
      k === "tweet text" ||
      k === "post text" ||
      k === "text" ||
      k === "tweet"
    )
      idx.title = i;
    else if (k === "time" || k === "date" || k === "timestamp") idx.time = i;
    else if (k === "impressions" || k === "impression") idx.impressions = i;
    else if (k === "engagements" || k === "engagement") idx.engagements = i;
    else if (k === "likes" || k === "like" || k === "favorites") idx.likes = i;
    else if (k === "replies" || k === "reply") idx.replies = i;
    else if (
      k === "retweets" ||
      k === "retweet" ||
      k === "reposts" ||
      k === "repost"
    )
      idx.retweets = i;
  });
  return idx;
}

/**
 * 解析 X Analytics CSV 为结构化行（与小红书 import 行结构兼容：含 title）。
 * @param {string|Buffer} input
 */
function parseXAnalyticsCsv(input) {
  const text = Buffer.isBuffer(input)
    ? input.toString("utf8")
    : fs.readFileSync(input, "utf8");
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const idx = mapHeaders(headers);
  if (idx.title == null) throw Error("无法识别 X Analytics CSV（缺少 Tweet text 列）");
  const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const title = String(cols[idx.title] ?? "").trim();
    if (!title) continue;
    const item = {
      title,
      impressions: idx.impressions != null ? num(cols[idx.impressions]) : null,
      engagements: idx.engagements != null ? num(cols[idx.engagements]) : null,
      likes: idx.likes != null ? num(cols[idx.likes]) : null,
      replies: idx.replies != null ? num(cols[idx.replies]) : null,
      retweets: idx.retweets != null ? num(cols[idx.retweets]) : null,
      time: idx.time != null ? cols[idx.time] : null,
    };
    out.push(item);
  }
  return out;
}

/**
 * 将 X Analytics 行转为归档 YAML 字段。
 * @param {object} row
 */
function xRowToYaml(row) {
  return {
    发布时间: parseXDate(row.time),
    曝光: row.impressions ?? null,
    互动: row.engagements ?? null,
    点赞: row.likes ?? null,
    回复: row.replies ?? null,
    转发: row.retweets ?? null,
  };
}

module.exports = {
  parseXAnalyticsCsv,
  xRowToYaml,
  parseXDate,
  splitCsvLine,
  normHeader,
};
