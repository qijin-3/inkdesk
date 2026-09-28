import { esc } from "./dom.js";
/** 通用对话框：替代 promptText / askText / askConfirm / showSaveConflictDialog 等手写 modal */
export function dialog({ title = "", body = "", okText = "确定", cancelText = "取消", onOk }) {
  overlay().remove?.();
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal" role="dialog"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn cancel">${esc(cancelText)}</button><button class="btn primary ok">${esc(okText)}</button></div></div>`;
  document.body.appendChild(ov);
  const done = (v) => {
    ov.remove();
    onOk?.(v);
  };
  ov.querySelector(".cancel").onclick = () => done(null);
  ov.querySelector(".ok").onclick = () => done(ov.querySelector("input,textarea,select")?.value ?? true);
  ov.addEventListener("mousedown", (e) => {
    if (e.target === ov) done(null);
  });
  ov.querySelector("input,textarea")?.focus();
  return ov;
}
export function askText(title, hint = "", value = "") {
  return new Promise((resolve) => {
    dialog({
      title,
      body: `${hint ? `<p class="muted">${esc(hint)}</p>` : ""}<input class="input ask-input" value="${esc(value)}">`,
      onOk: resolve,
    });
  });
}
export function askConfirm(title, message = "") {
  return new Promise((resolve) => {
    dialog({ title, body: `<p>${esc(message)}</p>`, onOk: (v) => resolve(v === true) });
  });
}
function overlay() {
  return document.querySelector(".modal-overlay") ?? { remove: () => {} };
}
