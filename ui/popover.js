/** 通用浮层菜单：定位 + 点击外部关闭，替代 renderer 内多处手写版本 */
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
