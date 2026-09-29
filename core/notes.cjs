const { parseNoteTable, rowToYaml, matchNoteRows } = require("../note-import.cjs");

/**
 * 解析表格并匹配本账号归档。
 * @param {{ account: string, filePath?: string, bytes?: number[] }} payload
 */
function importNotesPreview(core, payload) {
  const account = core.vault.resolveAccountId(payload.account);
  const buf = payload.bytes ? Buffer.from(payload.bytes) : payload.filePath;
  if (!buf || (Buffer.isBuffer(buf) && !buf.length))
    throw Error("请选择笔记数据表");
  const rows = parseNoteTable(buf);
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
  const rows = (core.store.metrics || []).filter((r) =>
    core.sameAccount(r["账号"], account),
  );
  const sum = (k) =>
    rows.reduce((s, r) => s + (r[k] != null ? Number(r[k]) || 0 : 0), 0);
  const byPath = {};
  for (const r of rows) {
    byPath[r.path] = {
      标题: r["标题"],
      阅读: r["阅读"],
      点赞: r["点赞"],
      收藏: r["收藏"],
      涨粉: r["涨粉"],
      评论: r["评论"],
    };
  }
  return {
    followers: core.store.followers?.[account] ?? null,
    阅读: sum("阅读"),
    点赞: sum("点赞"),
    收藏: sum("收藏"),
    评论: sum("评论"),
    涨粉: sum("涨粉"),
    文章: rows.length,
    byPath,
  };
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
      rowToYaml(row),
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
    const d = {
      阅读: delta(prev["阅读"], next["阅读"]),
      点赞: delta(prev["点赞"], next["点赞"]),
      收藏: delta(prev["收藏"], next["收藏"]),
      涨粉: delta(prev["涨粉"], next["涨粉"]),
      评论: delta(prev["评论"], next["评论"]),
    };
    if (Object.values(d).some((n) => n !== 0)) articles[newPath] = d;
  }
  core.store.metricDeltas ||= {};
  core.store.metricDeltas[account] = {
    at: new Date().toISOString(),
    粉丝量: delta(before.followers, after.followers),
    阅读: delta(before.阅读, after.阅读),
    点赞: delta(before.点赞, after.点赞),
    收藏: delta(before.收藏, after.收藏),
    评论: delta(before.评论, after.评论),
    涨粉: delta(before.涨粉, after.涨粉),
    文章: delta(before.文章, after.文章),
    articles,
  };
  core.save();
  return { ...core.reload(), dataPath: core.data, updated };
}
module.exports = {
  importNotesPreview,
  sameAccount,
  snapshotAccountMetrics,
  importNotesApply,
};
