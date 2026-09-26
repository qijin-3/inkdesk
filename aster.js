/** Aster — AI 写作伙伴拟人化头像（纯 HTML/CSS） */

const ASTER_STATES = new Set([
  "idle",
  "watching",
  "thinking",
  "idea",
  "talking",
  "success",
]);

/**
 * @param {{
 *   size?: number,
 *   state?: string,
 *   label?: string,
 *   id?: string,
 *   button?: boolean,
 * }} [opts]
 */
export function asterHtml({
  size = 40,
  state = "idle",
  label = "写作伙伴",
  id = "toggle-assistant",
  button = true,
} = {}) {
  const s = ASTER_STATES.has(state) ? state : "idle";
  const tag = button ? "button" : "span";
  const attrs = button
    ? `type="button" aria-pressed="false"`
    : `role="img"`;
  return `<${tag} id="${id}" class="aster aster--${s}" style="--aster-size:${size}px" aria-label="${label}" title="${label}" ${attrs}><span class="aster__halo"></span><span class="aster__body"><span class="aster__surface"></span><span class="aster__light"></span><span class="aster__eyes"><span class="aster__eye"></span><span class="aster__eye"></span></span></span><span class="aster__spark" hidden>✦</span></${tag}>`;
}

/**
 * 挂载眼睛跟随与随机眨眼；返回销毁函数。
 * @param {HTMLElement | null} root
 * @param {{ interactive?: boolean }} [opts]
 */
export function mountAster(root, { interactive = true } = {}) {
  if (!root) return () => {};

  let blinkTimer = 0;
  let unblinkTimer = 0;
  const eyes = root.querySelector(".aster__eyes");

  const onMove = (event) => {
    if (!interactive) return;
    const rect = root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxMove = 2.4;
    root.style.setProperty("--eye-x", `${(dx / distance) * maxMove}px`);
    root.style.setProperty("--eye-y", `${(dy / distance) * maxMove}px`);
  };

  const scheduleBlink = () => {
    blinkTimer = window.setTimeout(() => {
      eyes?.classList.add("is-blinking");
      unblinkTimer = window.setTimeout(() => {
        eyes?.classList.remove("is-blinking");
        scheduleBlink();
      }, 140);
    }, 2800 + Math.random() * 4200);
  };

  if (interactive) window.addEventListener("pointermove", onMove);
  scheduleBlink();

  return () => {
    window.removeEventListener("pointermove", onMove);
    window.clearTimeout(blinkTimer);
    window.clearTimeout(unblinkTimer);
  };
}

/**
 * 切换 Aster 状态类。
 * @param {HTMLElement | null} root
 * @param {string} state
 */
export function setAsterState(root, state) {
  if (!root) return;
  const next = ASTER_STATES.has(state) ? state : "idle";
  for (const s of ASTER_STATES) root.classList.toggle(`aster--${s}`, s === next);
  const spark = root.querySelector(".aster__spark");
  if (spark) spark.hidden = next !== "idea";
}
