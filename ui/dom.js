export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const api = (n, d) => window.desk.call(n, d);
export const esc = (s = "") =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtBytes = (n) => {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
};
let toastTimer = 0;
export function toast(t, opts = {}) {
  const el = $("#toast") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "toast" }));
  el.textContent = t;
  el.classList.toggle("show", true);
  el.classList.toggle("warn", !!opts.warn);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), opts.ms || 2200);
}
export const isWeb = () => !!window.desk?.web;
export function assetUrl(src) {
  if (typeof src !== "string" || !isWeb()) return src;
  if (src.startsWith("inkasset://vault/")) return "/api/asset/vault/" + src.slice(17);
  if (src.startsWith("inkasset://local/")) return "/api/asset/local/" + src.slice(17);
  return src;
}
