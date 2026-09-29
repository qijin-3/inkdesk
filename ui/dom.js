export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const api = (n, d) => window.desk.call(n, d);
export const esc = (s = "") =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
  return (v / (1024 * 1024)).toFixed(1) + " MB";
};
/** 别名：renderer 历史名称 */
export const formatBytes = fmtBytes;
let toastTimer = 0;
/**
 * 顶部轻提示（语义与 renderer.js 历史实现一致）。
 * @param {string} t 文案
 * @param {{ sticky?: boolean }} [opts] sticky 时不自动消失（拖拽悬停用）
 */
export function toast(t, opts) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toastTimer);
  if (opts?.sticky) return;
  toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
}
/** 立刻收起顶部提示 */
export function hideToast() {
  clearTimeout(toastTimer);
  $("#toast")?.classList.remove("show");
}
export const isWeb = () =>
  typeof window === "undefined" ? false : !!window.desk?.web;
export function assetUrl(src) {
  if (typeof src !== "string") return src;
  if (!isWeb()) return src;
  if (src.startsWith("inkasset://vault/"))
    return "/api/asset/vault/" + src.slice("inkasset://vault/".length);
  if (src.startsWith("inkasset://local/"))
    return "/api/asset/local/" + src.slice("inkasset://local/".length);
  return src;
}
