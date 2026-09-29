import { esc, assetUrl } from "./dom.js";

/**
 * 兼容旧 AI/Dev 与文件夹名的账号比较。
 * @param {string} a
 * @param {string} b
 */
export function sameAccount(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const key = (id) => {
    if (id === "AI" || id.endsWith("_AI")) return "AI";
    if (id === "Dev" || id.endsWith("_Dev")) return "Dev";
    return id;
  };
  return key(a) === key(b);
}

/**
 * 账号展示名首字（无头像时用作占位）。
 * @param {string} label
 */
export function accountInitial(label) {
  const s = String(label || "?").trim();
  return Array.from(s)[0] || "?";
}

/**
 * 账号展示名（列表未知 id 时回退下划线转空格）。
 * @param {Array<{ id: string, label: string }>} list
 * @param {string} id
 */
export function accountLabelOf(list, id) {
  return (
    (list || []).find((a) => a.id === id)?.label ||
    String(id || "").replace(/_/g, " ")
  );
}

/**
 * 账号头像 HTML：有图用图，否则显示首字。
 * @param {{ label?: string, avatar?: string }} a
 * @param {string} [extraClass]
 */
export function accountAvatarHtml(a, extraClass = "") {
  if (a.avatar) {
    const src = assetUrl("inkasset://vault/" + encodeURIComponent(a.avatar));
    return `<img class="account-avatar-img ${extraClass}" src="${esc(src)}" alt="" draggable="false">`;
  }
  return `<span class="account-avatar-fallback ${extraClass}" aria-hidden="true">${esc(accountInitial(a.label))}</span>`;
}
