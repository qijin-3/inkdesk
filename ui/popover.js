import { $, esc } from "./dom.js";

/**
 * 坐标式右键/上下文菜单（与 renderer.js 原实现一致）。
 * @param {number} x
 * @param {number} y
 * @param {{ label: string, danger?: boolean, run?: () => void }[]} items
 */
export function showContextMenu(x, y, items) {
  $("#context-menu")?.remove();
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  menu.style.left = Math.min(x, window.innerWidth - 180) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 80) + "px";
  menu.innerHTML = items
    .map(
      (it, i) =>
        `<button type="button" data-ctx="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`,
    )
    .join("");
  document.body.append(menu);
  const close = () => {
    menu.remove();
    window.removeEventListener("click", close);
    window.removeEventListener("contextmenu", close);
    window.removeEventListener("scroll", close, true);
  };
  [...menu.querySelectorAll("[data-ctx]")].forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const item = items[+b.dataset.ctx];
      close();
      item?.run();
    };
  });
  setTimeout(() => {
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);
  }, 0);
}

/**
 * 锚点式浮层菜单（新代码优先用这个；老调用逐步迁移）。
 */
export function openMenu(anchor, html, { width = 280, onClose } = {}) {
  closeMenu();
  const el = document.createElement("div");
  el.className = "float-menu";
  el.style.cssText = `position:fixed;z-index:900;min-width:${width}px;max-width:min(${width + 80}px,92vw);max-height:min(70vh,560px);overflow:auto`;
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  let left = Math.min(Math.max(8, r.left), window.innerWidth - width - 12);
  let top = r.bottom + 6;
  if (top + 200 > window.innerHeight - 12) top = Math.max(8, r.top - 208);
  el.style.left = left + "px";
  el.style.top = top + "px";
  const close = (e) => {
    if (e && (e.target === anchor || el.contains(e.target))) return;
    destroy();
  };
  const destroy = () => {
    el.remove();
    window.removeEventListener("click", close, true);
    window.removeEventListener("resize", destroy);
    openMenu._el = null;
    onClose?.();
  };
  window.addEventListener("click", close, true);
  window.addEventListener("resize", destroy);
  openMenu._el = el;
  openMenu.close = destroy;
  return el;
}
export function closeMenu() {
  openMenu.close?.();
}
