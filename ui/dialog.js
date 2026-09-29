import { $, esc } from "./dom.js";

/**
 * Electron 无 window.prompt，用本地弹窗收集单行文本。
 * 与 renderer.js 原实现逐行一致：确认返回 trim 后文本（空按取消），取消/遮罩/Escape 返回 null。
 * @param {string} title
 * @param {{ value?: string, placeholder?: string, okLabel?: string }} [opts]
 * @returns {Promise<string|null>}
 */
export function promptText(title, opts = {}) {
  return new Promise((resolve) => {
    $("#text-prompt-modal")?.remove();
    const m = document.createElement("div");
    m.id = "text-prompt-modal";
    m.className = "modal";
    m.innerHTML = `<div class="dialog" style="width:min(420px,92vw)"><h2>${esc(title)}</h2><input id="text-prompt-input" type="text" value="${esc(opts.value || "")}" placeholder="${esc(opts.placeholder || "")}" autocomplete="off"><div class="row"><button type="button" id="text-prompt-cancel">取消</button><button type="button" class="primary" id="text-prompt-ok">${esc(opts.okLabel || "确定")}</button></div></div>`;
    document.body.append(m);
    const input = $("#text-prompt-input");
    const done = (value) => {
      m.remove();
      resolve(value);
    };
    $("#text-prompt-cancel").onclick = () => done(null);
    m.addEventListener("click", (e) => {
      if (e.target === m) done(null);
    });
    const submit = () => {
      const v = input.value.trim();
      done(v || null);
    };
    $("#text-prompt-ok").onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/**
 * 单行文本收集（返回原始值，不 trim；取消返回 null）。
 */
export function askText(title, hint, value = "") {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>${esc(title)}</h2><p>${esc(hint)}</p><input id="ask-text-input" value="${esc(value)}" autocomplete="off"><div class="row"><button type="button" id="ask-text-cancel">取消</button><button type="button" class="primary" id="ask-text-ok">确定</button></div></div>`;
    document.body.append(m);
    const input = $("#ask-text-input");
    input?.focus();
    input?.select();
    const done = (v) => {
      m.remove();
      resolve(v);
    };
    $("#ask-text-cancel").onclick = () => done(null);
    $("#ask-text-ok").onclick = () => done(input.value);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") done(null);
    });
  });
}

/**
 * 确认对话框（替代 confirm，网页端更可靠）。
 * @returns {Promise<boolean>}
 */
export function askConfirm(title, message) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="row"><button type="button" id="ask-confirm-cancel">取消</button><button type="button" class="primary" id="ask-confirm-ok">确定</button></div></div>`;
    document.body.append(m);
    $("#ask-confirm-cancel").onclick = () => {
      m.remove();
      resolve(false);
    };
    $("#ask-confirm-ok").onclick = () => {
      m.remove();
      resolve(true);
    };
  });
}
