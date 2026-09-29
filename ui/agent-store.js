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
