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
 * 新建账号：名称 + 模式（小红书 / X）。
 * @returns {Promise<{ name: string, mode: "xhs"|"x" }|null>}
 */
export function askCreateAccount() {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog account-create-dialog"><h2>新建账号</h2><label class="account-create-field">账号名称<input id="ask-account-name" type="text" value="" placeholder="例如：金奇_AI" autocomplete="off"></label><div class="account-mode-label">账号模式</div><div class="account-mode-cards" role="radiogroup" aria-label="账号模式"><label class="account-mode-card is-selected"><input type="radio" name="account-mode" value="xhs" checked><img class="account-mode-card-img" src="assets/mode-xhs.png" alt="" draggable="false"><strong>小红书</strong></label><label class="account-mode-card"><input type="radio" name="account-mode" value="x"><img class="account-mode-card-img" src="assets/mode-x.png" alt="" draggable="false"><strong>X</strong></label></div><div class="row"><button type="button" id="ask-account-cancel">取消</button><button type="button" class="primary" id="ask-account-ok">创建</button></div></div>`;
    document.body.append(m);
    const input = $("#ask-account-name");
    input?.focus();
    const syncCards = () => {
      m.querySelectorAll(".account-mode-card").forEach((card) => {
        const on = card.querySelector("input")?.checked;
        card.classList.toggle("is-selected", !!on);
      });
    };
    m.querySelectorAll('input[name="account-mode"]').forEach((r) => {
      r.addEventListener("change", syncCards);
    });
    const done = (v) => {
      m.remove();
      resolve(v);
    };
    $("#ask-account-cancel").onclick = () => done(null);
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      const mode =
        m.querySelector('input[name="account-mode"]:checked')?.value === "x"
          ? "x"
          : "xhs";
      done({ name, mode });
    };
    $("#ask-account-ok").onclick = submit;
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    });
  });
}

/**
 * 仅选择账号模式（注册已有文件夹时用）。
 * @returns {Promise<"xhs"|"x"|null>}
 */
export function askAccountMode() {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog account-create-dialog"><h2>选择账号模式</h2><div class="account-mode-label">账号模式</div><div class="account-mode-cards" role="radiogroup" aria-label="账号模式"><label class="account-mode-card is-selected"><input type="radio" name="account-mode" value="xhs" checked><img class="account-mode-card-img" src="assets/mode-xhs.png" alt="" draggable="false"><strong>小红书</strong></label><label class="account-mode-card"><input type="radio" name="account-mode" value="x"><img class="account-mode-card-img" src="assets/mode-x.png" alt="" draggable="false"><strong>X</strong></label></div><div class="row"><button type="button" id="ask-mode-cancel">取消</button><button type="button" class="primary" id="ask-mode-ok">继续</button></div></div>`;
    document.body.append(m);
    const syncCards = () => {
      m.querySelectorAll(".account-mode-card").forEach((card) => {
        const on = card.querySelector("input")?.checked;
        card.classList.toggle("is-selected", !!on);
      });
    };
    m.querySelectorAll('input[name="account-mode"]').forEach((r) => {
      r.addEventListener("change", syncCards);
    });
    const done = (v) => {
      m.remove();
      resolve(v);
    };
    $("#ask-mode-cancel").onclick = () => done(null);
    $("#ask-mode-ok").onclick = () => {
      const mode =
        m.querySelector('input[name="account-mode"]:checked')?.value === "x"
          ? "x"
          : "xhs";
      done(mode);
    };
    m.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
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
