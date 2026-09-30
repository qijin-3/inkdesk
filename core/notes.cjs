const { parseNoteTable, rowToYaml, matchNoteRows } = require("../note-import.cjs");
const { parseXAnalyticsCsv, xRowToYaml } = require("../x-import.cjs");

const XHS_METRIC_KEYS = ["阅读", "点赞", "收藏", "涨粉", "评论"];
const X_METRIC_KEYS = ["曝光", "互动", "点赞", "回复", "转发"];

/**
 * 解析表格并匹配本账号归档。
 * @param {{ account: string, filePath?: string, bytes?: number[] }} payload
 */
function importNotesPreview(core, payload) {
  const account = core.vault.resolveAccountId(payload.account);
  const buf = payload.bytes ? Buffer.from(payload.bytes) : payload.filePath;
  if (!buf || (Buffer.isBuffer(buf) && !buf.length))
    throw Error("请选择数据文件");
  const mode = core.vault.accountMode(account);
  const rows =
    mode === "x" ? parseXAnalyticsCsv(buf) : parseNoteTable(buf);
  const archives = core.vault
    .load()
    .archives.filter((a) => a.account === account)
    .map((a) => ({
      title: a.title,
      path: a.path,
      date: a.fields?.["发布时间"] || null,
    }));
  const { matched, unmatched } = matchNoteRows(rows, archives);
  return {
    rows,
    matched,
    unmatched,
    archives,
    mode,
  };
}

/**
 * 比较指标/文档账号字段是否同属一个账号（兼容旧 AI/Dev）。
 * @param {string} a
 * @param {string} b
 */
function sameAccount(core, a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return core.vault.resolveAccountId(a) === core.vault.resolveAccountId(b);
  } catch {
    return false;
  }
}

/**
 * 汇总某账号当前仪表盘指标快照，用于计算增减。
 * @param {string} account
 */
function snapshotAccountMetrics(core, account) {
  const mode = core.vault.accountMode(account);
  const keys = mode === "x" ? X_METRIC_KEYS : XHS_METRIC_KEYS;
  const rows = (core.store.metrics || []).filter((r) =>
    core.sameAccount(r["账号"], account),
  );
  const sum = (k) =>
    rows.reduce((s, r) => s + (r[k] != null ? Number(r[k]) || 0 : 0), 0);
  const byPath = {};
  for (const r of rows) {
    const item = { 标题: r["标题"] };
    for (const k of keys) item[k] = r[k];
    byPath[r.path] = item;
  }
  const snap = {
    followers: core.store.followers?.[account] ?? null,
    文章: rows.length,
    byPath,
    mode,
  };
  for (const k of keys) snap[k] = sum(k);
  return snap;
}

/**
 * 写入 YAML、重命名归档，并保存粉丝量与指标增减。
 * @param {{ account: string, followers: number, pairs: { index: number, path: string }[], rows: object[] }} payload
 */
function importNotesApply(core, payload) {
  const account = core.vault.resolveAccountId(payload.account);
  const followers = Number(payload.followers);
  if (!Number.isFinite(followers) || followers < 0)
    throw Error("请填写有效的粉丝量");
  const mode = core.vault.accountMode(account);
  const keys = mode === "x" ? X_METRIC_KEYS : XHS_METRIC_KEYS;
  const toYaml = mode === "x" ? xRowToYaml : rowToYaml;
  const before = core.snapshotAccountMetrics(account);
  core.store.followers ||= {};
  core.store.followers[account] = followers;
  const rows = payload.rows || [];
  const updated = [];
  const pathMap = {};
  for (const pair of payload.pairs || []) {
    const row = rows[pair.index];
    if (!row || !pair.path) continue;
    const rel = core.vault.syncArchiveFromImport(
      pair.path,
      toYaml(row),
      row.title,
    );
    pathMap[pair.path] = rel;
    updated.push(rel);
  }
  core.reload();
  const after = core.snapshotAccountMetrics(account);
  const delta = (a, b) => {
    if (a == null && b == null) return 0;
    return (Number(b) || 0) - (Number(a) || 0);
  };
  const articles = {};
  for (const [oldPath, newPath] of Object.entries(pathMap)) {
    const prev = before.byPath[oldPath] || before.byPath[newPath] || {};
    const next = after.byPath[newPath] || {};
    const d = {};
    for (const k of keys) d[k] = delta(prev[k], next[k]);
    if (Object.values(d).some((n) => n !== 0)) articles[newPath] = d;
  }
  const deltas = {
    at: new Date().toISOString(),
    粉丝量: delta(before.followers, after.followers),
    文章: delta(before.文章, after.文章),
    articles,
  };
  for (const k of keys) deltas[k] = delta(before[k], after[k]);
  core.store.metricDeltas ||= {};
  core.store.metricDeltas[account] = deltas;
  core.save();
  return { ...core.reload(), dataPath: core.data, updated };
}
module.exports = {
  importNotesPreview,
  sameAccount,
  snapshotAccountMetrics,
  importNotesApply,
  XHS_METRIC_KEYS,
  X_METRIC_KEYS,
};
