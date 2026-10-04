import { $, esc } from "./dom.js";
import {
  providerCatalog,
  catalogProvider,
  connectedHttpProviders,
  setAgentHttp,
  ensureAgentHttpStore,
} from "./agent-store.js";

/**
 * OpenCode 风格「连接提供商」弹窗：热门 / 其他 + 搜索。
 * 目录来自 assets/agents/providers-catalog.json（models.dev）。
 * @returns {Promise<string|null>} 选中的 provider id；取消为 null
 */
export function promptConnectProvider(st) {
  return new Promise((resolve) => {
    $("#provider-connect-modal")?.remove();
    ensureAgentHttpStore(st);
    const connected = new Set(connectedHttpProviders(st).map((p) => p.id));
    const catalog = providerCatalog();
    const m = document.createElement("div");
    m.id = "provider-connect-modal";
    m.className = "modal";
    m.innerHTML = `<div class="dialog provider-connect-dialog" role="dialog" aria-labelledby="provider-connect-title">
  <div class="provider-connect-head">
    <h2 id="provider-connect-title">连接提供商</h2>
    <button type="button" class="ghost provider-connect-close" id="provider-connect-close" aria-label="关闭">×</button>
  </div>
  <div class="provider-connect-search">
    <span class="provider-connect-search-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    </span>
    <input id="provider-connect-filter" type="search" placeholder="搜索提供商" autocomplete="off" aria-label="搜索提供商">
  </div>
  <div class="provider-connect-list" id="provider-connect-list"></div>
</div>`;
    document.body.append(m);

    const listEl = $("#provider-connect-list");
    const filterEl = $("#provider-connect-filter");
    const done = (value) => {
      m.remove();
      resolve(value);
    };

    const render = () => {
      const q = filterEl.value.trim().toLowerCase();
      const available = catalog.providers.filter((p) => !connected.has(p.id));
      const match = (p) =>
        !q || `${p.id} ${p.name}`.toLowerCase().includes(q);
      const popularIds = catalog.popular || [];
      const popular = popularIds
        .map((id) => available.find((p) => p.id === id))
        .filter((p) => p && match(p));
      const other = available
        .filter((p) => !popularIds.includes(p.id) && match(p))
        .sort((a, b) => a.name.localeCompare(b.name));
      const custom = catalog.custom || { id: "_custom", name: "自定义 OpenAI 兼容提供商" };
      const showCustom = !q || `${custom.id} ${custom.name}`.toLowerCase().includes(q);

      const row = (p, badge = "") =>
        `<button type="button" class="provider-connect-row" data-provider-id="${esc(p.id)}">
          <span class="provider-connect-row-main">
            <strong>${esc(p.name)}</strong>
            ${p.blurb ? `<span class="provider-connect-blurb">${esc(p.blurb)}</span>` : ""}
          </span>
          ${badge}
        </button>`;

      const section = (title, items, badgeFn) =>
        items.length
          ? `<div class="provider-connect-section"><div class="provider-connect-section-title">${esc(title)}</div>${items.map((p) => row(p, badgeFn?.(p) || "")).join("")}</div>`
          : "";

      const recommended = `<span class="agent-badge agent-badge-ok">推荐</span>`;
      const customBadge = `<span class="agent-badge">自定义</span>`;
      listEl.innerHTML =
        section("热门", popular, () => recommended) +
        section("其他", [
          ...(showCustom ? [{ id: custom.id, name: custom.name, blurb: "" }] : []),
          ...other,
        ], (p) => (p.id === custom.id ? customBadge : "")) ||
        `<p class="settings-hint provider-connect-empty">没有匹配的提供商</p>`;

      listEl.querySelectorAll("[data-provider-id]").forEach((btn) => {
        btn.onclick = () => done(btn.getAttribute("data-provider-id"));
      });
    };

    $("#provider-connect-close").onclick = () => done(null);
    m.addEventListener("click", (e) => {
      if (e.target === m) done(null);
    });
    filterEl.addEventListener("input", render);
    filterEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    });
    render();
    requestAnimationFrame(() => filterEl.focus());
  });
}

/**
 * 选中目录项后写入 agentHttp；自定义则再要 baseURL。
 * @param {(title: string, opts?: object) => Promise<string|null>} promptText
 * @returns {Promise<string|null>} 新 provider id
 */
export async function addProviderFromCatalog(st, pickId, promptText) {
  if (!pickId) return null;
  if (pickId === "_custom") {
    const name = await promptText("自定义提供商名称", {
      placeholder: "例如 my-llm",
      okLabel: "下一步",
    });
    if (!name) return null;
    const id =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "custom";
    const baseURL = await promptText("Base URL", {
      placeholder: "https://api.example.com/v1",
      okLabel: "添加",
    });
    if (!baseURL) return null;
    setAgentHttp(st, id, {
      label: name.trim(),
      baseURL: baseURL.trim(),
      apiKey: "",
      family: "openai",
    });
    return id;
  }
  const cat = catalogProvider(pickId);
  if (!cat) return null;
  setAgentHttp(st, cat.id, {
    label: cat.name,
    baseURL: cat.api || "",
    apiKey: "",
    family: cat.family || "openai",
    models: cat.models || [],
  });
  return cat.id;
}
