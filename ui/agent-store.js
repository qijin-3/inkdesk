import { esc } from "./dom.js";

export const AGENT_PROVIDERS = [
  { id: "cursor", label: "Cursor", blurb: "Cursor Agent CLI" },
  { id: "codex", label: "ChatGPT", blurb: "OpenAI Codex CLI" },
  { id: "claude", label: "Claude Code", blurb: "Anthropic Claude Code" },
  { id: "zcode", label: "ZCode", blurb: "Z.ai ZCode（沿用 CLI 默认模型）" },
  { id: "opencode", label: "OpenCode", blurb: "OpenCode CLI" },
  { id: "antigravity", label: "Antigravity", blurb: "Google Antigravity（agy）" },
];

export function settingsSection({ title, control, className = "" }) {
  const titleHtml = title
    ? `<h3 class="settings-section-title">${esc(title)}</h3>`
    : "";
  return `<section class="settings-section ${className}">${titleHtml}<div class="settings-section-control">${control}</div></section>`;
}

/** 右侧白底面板 */
export function settingsPanel(inner, className = "") {
  return `<div class="settings-panel ${className}">${inner}</div>`;
}

/** 面板内表单字段 */
export function settingsField(label, controlHtml) {
  return `<label class="settings-field"><span class="settings-field-label">${esc(label)}</span>${controlHtml}</label>`;
}

export function agentLogoSvg(id, size = 28) {
  const extensions = {
    cursor: "png",
    codex: "png",
    claude: "ico",
    zcode: "png",
    opencode: "svg",
    antigravity: "ico",
  };
  return extensions[id]
    ? `<img src="assets/agents/${id}.${extensions[id]}" width="${size}" height="${size}" style="object-fit:contain" alt="">`
    : "";
}

export function agentInstalled(st, id) {
  return !!st.agents?.[id];
}

export function ensureAgentsEnabledStore(st) {
  if (!st.agentsEnabled || typeof st.agentsEnabled !== "object")
    st.agentsEnabled = {};
}

/** Agent 是否在对话中可选；缺省视为启用 */
export function agentEnabled(st, id) {
  ensureAgentsEnabledStore(st);
  return st.agentsEnabled[id] !== false;
}

/** 已安装的 Agent 列表 */
export function installedAgentProviders(st) {
  return AGENT_PROVIDERS.filter((p) => agentInstalled(st, p.id));
}

/** 对话中可选的 Agent（已安装且已启用） */
export function selectableAgentProviders(st) {
  return installedAgentProviders(st).filter((p) => agentEnabled(st, p.id));
}

/** 当前侧栏展示用的 provider（优先已安装且已启用） */
export function railProviderId(st) {
  const selectable = selectableAgentProviders(st);
  if (selectable.some((p) => p.id === st.provider)) return st.provider;
  return selectable[0]?.id || st.provider;
}

/** 触发器文案：模型名，未指定时为「默认」 */
export function railModelLabel(st, provider = railProviderId(st)) {
  if (provider === st.provider && st.model) return st.model;
  if (provider === st.provider) return "默认";
  const p = AGENT_PROVIDERS.find((x) => x.id === provider);
  return p?.label || "选择模型";
}

export function ensureAgentModelsStore(st) {
  if (!st.agentModels || typeof st.agentModels !== "object")
    st.agentModels = {};
}

export function getAgentModelList(st, provider) {
  ensureAgentModelsStore(st);
  const list = st.agentModels[provider];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export function setAgentModelList(st, provider, list) {
  ensureAgentModelsStore(st);
  st.agentModels = {
    ...st.agentModels,
    [provider]: [...new Set(list.map((x) => String(x).trim()).filter(Boolean))],
  };
}

export function agentSuggestionIds(st, provider, discovered = []) {
  const saved = getAgentModelList(st, provider);
  return [...new Set([...discovered, ...saved])];
}

export function agentListItemHtml(st, p) {
  const installed = agentInstalled(st, p.id);
  const enabled = agentEnabled(st, p.id);
  const isDefault = st.provider === p.id;
  return `<div class="agent-list-item ${isDefault ? "is-default" : ""} ${installed ? "" : "is-missing"} ${enabled ? "" : "is-off"}" data-open-agent="${p.id}" role="button" tabindex="0">
  <div class="agent-card-logo">${agentLogoSvg(p.id)}</div>
  <span class="agent-list-main">
    <span class="agent-card-title">
      <strong>${esc(p.label)}</strong>
      ${isDefault ? `<span class="agent-badge agent-badge-default">默认</span>` : ""}
      <span class="agent-badge ${installed ? "agent-badge-ok" : "agent-badge-miss"}">${installed ? "已安装" : "未安装"}</span>
      ${enabled ? "" : `<span class="agent-badge agent-badge-off">已关闭</span>`}
    </span>
    <span class="agent-card-blurb">${esc(p.blurb)}</span>
  </span>
  <label class="agent-switch" title="${enabled ? "关闭后对话中不可选" : "启用以在对话中选择"}">
    <input type="checkbox" role="switch" data-agent-enable="${p.id}" ${enabled ? "checked" : ""} aria-label="${enabled ? "关闭" : "启用"} ${esc(p.label)}">
    <span class="agent-switch-track" aria-hidden="true"></span>
  </label>
  <span class="account-list-chevron" aria-hidden="true">›</span>
</div>`;
}

/** 模型目录面板含回填副作用，保留在 renderer.js，本模块不导出 */

export function agentModelsPanelHtml(st, p, info) {
  const installed = agentInstalled(st, p.id);
  if (!installed) {
    return `<p class="settings-hint">安装并登录对应 CLI 后，可添加模型并逐一测试连通。</p>`;
  }
  if (p.id === "zcode" || info?.selectable === false) {
    const current = info?.current || "";
    return `<div class="agent-model-panel">
      <p class="settings-hint">${current ? `CLI 默认模型：<code>${esc(current)}</code>` : esc(info?.error || "未能读取默认模型")}</p>
      <p class="settings-hint">${esc(p.label)} 沿用 CLI 默认模型，连通性请用右上角「测试默认」。</p>
    </div>`;
  }
  const saved = getAgentModelList(st, p.id);
  if (!saved.length && st.provider === p.id && st.model) {
    setAgentModelList(st, p.id, [st.model]);
  }
  const list = getAgentModelList(st, p.id);
  const suggestions = agentSuggestionIds(st, p.id, info?.models || []);
  const rows = list.length
    ? list
        .map((m) => {
          const active = st.provider === p.id && st.model === m;
          return `<li class="agent-model-item ${active ? "is-active" : ""}" data-model-row="${esc(m)}">
            <code class="agent-model-id">${esc(m)}</code>${!(info?.models || []).includes(m) ? `<span class="agent-badge">自定义 · 未核验</span>` : ""}
            ${active ? `<span class="agent-badge agent-badge-default">使用中</span>` : `<button type="button" class="ghost" data-agent-use="${p.id}" data-model="${esc(m)}">使用</button>`}
            <button type="button" class="ghost" data-agent-test-model="${p.id}" data-model="${esc(m)}">测试</button>
            <button type="button" class="ghost" data-agent-remove-model="${p.id}" data-model="${esc(m)}">移除</button>
            <span class="agent-model-row-status" data-model-status="${esc(m)}" role="status"></span>
          </li>`;
        })
        .join("")
    : `<li class="agent-model-empty settings-hint">尚未添加模型。从下方选择模型 ID，或手填后点「添加」。</li>`;

  return `<div class="agent-model-panel">
    <p class="settings-hint" role="status">${esc(info?.source || "尚未读取模型目录")}${info?.checkedAt ? ` · ${new Date(info.checkedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}` : ""}${info?.stale ? " · 上次成功结果" : ""}</p>
    ${info?.error || info?.notice ? `<p class="settings-hint">${esc(info.error || info.notice)}</p>` : ""}
    <div class="agent-card-actions"><button type="button" class="ghost" data-agent-refresh="${p.id}">刷新模型</button><button type="button" class="ghost" data-agent-cli-default="${p.id}">使用 CLI 默认模型</button></div>
    <div class="agent-model-add">
      <select class="agent-model-select" data-agent-preset="${p.id}" aria-label="常用模型">
        <option value="">选择模型 ID</option>
        ${suggestions.map((m) => `<option value="${esc(m)}">${esc(m)}${!(info?.models || []).includes(m) ? " · 已保存，未核验" : ""}</option>`).join("")}
      </select>
      <input class="agent-model-input" data-agent-pick="${p.id}" placeholder="或手动输入模型 ID" autocomplete="off">
      <button type="button" class="primary" data-agent-add-model="${p.id}">添加</button>
    </div>
    <ul class="agent-model-list">${rows}</ul>
  </div>`;
}
