import { esc } from "./dom.js";

/**
 * 分组名（中文排序）。state 参数化以便单测，原实现读全局 state。
 * @param {{ groups?: Record<string, unknown> }} st
 */
export function groupNames(st) {
  return Object.keys(st.groups || {}).sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}

/**
 * 按分组名稳定映射到色板序号。
 * @param {string} name
 */
export function groupChipTone(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

/**
 * 分组圆角标签 HTML。
 * @param {string} name
 */
export function groupChipHtml(name) {
  return `<span class="group-chip group-chip-${groupChipTone(name)}">${esc(name)}</span>`;
}

/**
 * 读取已发布文章的分组标签。
 * @param {{ metrics?: Array<Record<string, unknown>>, archives?: Array<{ path?: string, group?: string }> }} st
 * @param {string} rel
 * @returns {string|null}
 */
export function publishedGroup(st, rel) {
  const row = (st.metrics || []).find((r) => r.path === rel);
  const fromMetrics =
    typeof row?.["分组"] === "string" && row["分组"].trim()
      ? row["分组"].trim()
      : null;
  if (fromMetrics) return fromMetrics;
  const arch = (st.archives || []).find((a) => a.path === rel);
  return arch?.group || null;
}

/**
 * 按分组解析本地同步默认路径；无分组路径时回退到账号路径。
 * @param {{ groups?: Record<string, { backupPath?: string }>, backupPaths?: Record<string, string> }} st
 * @param {string|null|undefined} group
 * @param {string} accountId
 */
export function backupPathFor(st, group, accountId) {
  const g = typeof group === "string" ? group.trim() : "";
  if (g && st.groups?.[g]?.backupPath) return st.groups[g].backupPath;
  return st.backupPaths?.[accountId] || "";
}

/**
 * 已发布且带分组标签的文章路径列表（设置页「本地同步」用）。
 * @param {{ archives?: Array<{ path?: string, group?: string }>, metrics?: Array<Record<string, unknown>> }} st
 * @returns {string[]}
 */
export function groupedArchivePaths(st) {
  const seen = new Set();
  const out = [];
  for (const a of st.archives || []) {
    const rel = a?.path;
    if (!rel || seen.has(rel) || !publishedGroup(st, rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

/**
 * 分组下拉选项 HTML。
 * @param {object} st
 * @param {string|null|undefined} selected
 * @param {{ allowEmpty?: boolean, emptyLabel?: string }} [opts]
 */
export function groupOptionsHtml(st, selected, opts = {}) {
  const allowEmpty = opts.allowEmpty !== false;
  const emptyLabel = opts.emptyLabel || "无分组";
  const cur = typeof selected === "string" ? selected.trim() : "";
  const names = new Set(groupNames(st));
  if (cur) names.add(cur);
  return `${allowEmpty ? `<option value="">${esc(emptyLabel)}</option>` : ""}${[
    ...names,
  ]
    .sort((a, b) => a.localeCompare(b, "zh"))
    .map(
      (n) =>
        `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)}</option>`,
    )
    .join("")}`;
}
