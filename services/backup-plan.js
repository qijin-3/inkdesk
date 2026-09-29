import { publishedGroup, backupPathFor } from "../ui/groups.js";

/**
 * 本地同步决策（原 backupPublishedArticle 前半段，原样抽出）。
 * 纯函数：把“按哪些路径/分组/默认目录同步”的分支逻辑与弹窗 DOM 解耦，便于单测。
 *
 * @param {object} st state（archives/groups/backupPaths）
 * @param {{ paths: string|string[], account: string, preview?: { path?: string, title?: string }|null }} opts
 * @returns {null | { list, accountId, groups, singleGroup, mixedGroups, defaultPath,
 *   perPathDefaults, allHaveDefault, label, rememberTarget, defaultHint }}
 */
export function resolveBackupPlan(st, { paths, account, preview }) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return null;
  const first = list[0];
  const accountId =
    (st.archives || []).find((a) => a.path === first)?.account ||
    first.split("/")[0] ||
    account;
  const groups = [...new Set(list.map((rel) => publishedGroup(st, rel) || ""))];
  const singleGroup = groups.length === 1 ? groups[0] || null : null;
  const mixedGroups = groups.length > 1;
  const defaultPath = singleGroup
    ? backupPathFor(st, singleGroup, accountId)
    : "";
  const perPathDefaults = list.map((rel) => ({
    rel,
    group: publishedGroup(st, rel),
    dest: backupPathFor(st, publishedGroup(st, rel), accountId),
  }));
  const allHaveDefault = perPathDefaults.every((x) => x.dest);
  const titleOf = (rel) =>
    preview?.path === rel
      ? preview.title
      : (st.archives || []).find((a) => a.path === rel)?.title ||
        rel.split("/").pop().replace(/\.md$/, "") ||
        "文章";
  const label =
    list.length === 1 ? `「${titleOf(first)}」` : `选中的 ${list.length} 篇文章`;
  const rememberTarget = singleGroup
    ? `分组「${singleGroup}」`
    : mixedGroups
      ? "（多分组时请分别设置）"
      : "该账号";
  const defaultHint = mixedGroups
    ? allHaveDefault
      ? "各分组已配置默认路径，可按分组分别同步"
      : "选中文章分组不同或未配置路径，请选择统一路径，或先设置分组"
    : defaultPath
      ? defaultPath
      : singleGroup
        ? `分组「${singleGroup}」未设置（可在设置 · 分组中配置）`
        : "未设置（可先为文章指定分组，或在设置 · 账号中配置）";
  return {
    list,
    accountId,
    groups,
    singleGroup,
    mixedGroups,
    defaultPath,
    perPathDefaults,
    allHaveDefault,
    label,
    rememberTarget,
    defaultHint,
  };
}
