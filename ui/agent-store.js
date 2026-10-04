import { esc } from "./dom.js";
import providersCatalog from "../assets/agents/providers-catalog.json";

/** CLI 卡片（设置页常驻；不含已下线的 cursor/zcode） */
export const AGENT_PROVIDERS = [
  { id: "codex", label: "ChatGPT", blurb: "OpenAI Codex CLI" },
  { id: "claude", label: "Claude Code", blurb: "Anthropic Claude Code" },
  { id: "opencode", label: "OpenCode", blurb: "OpenCode CLI" },
  { id: "antigravity", label: "Antigravity", blurb: "Google Antigravity（agy）" },
];

/** models.dev 精简目录（自 OpenCode / models.dev） */
export function providerCatalog() {
  return providersCatalog;
}

export function catalogProvider(id) {
  return providersCatalog.providers.find((p) => p.id === id) || null;
}

export function settingsSection({ title, control, className = "", action = "" }) {
  const head =
    title || action
      ? `<div class="settings-section-head">${title ? `<h3 class="settings-section-title">${esc(title)}</h3>` : ""}${action}</div>`
      : "";
  return `<section class="settings-section ${className}">${head}<div class="settings-section-control">${control}</div></section>`;
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
    codex: "png",
    claude: "ico",
    opencode: "svg",
    antigravity: "ico",
  };
  return extensions[id]
    ? `<img src="assets/agents/${id}.${extensions[id]}" width="${size}" height="${size}" style="object-fit:contain" alt="">`
    : "";
}

export function agentInstalled(st, id) {
  if (st.agents?.[id]) return true;
  // HTTP：有 Key 即视为已安装（不单靠后端 agents 快照，避免进程未热更时漏项）
  ensureAgentHttpStore(st);
  const cfg = st.agentHttp?.[id];
  return !!(cfg && String(cfg.apiKey || "").trim());
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

export function ensureAgentHttpStore(st) {
  if (!st.agentHttp || typeof st.agentHttp !== "object") st.agentHttp = {};
}

export function getAgentHttp(st, provider) {
  ensureAgentHttpStore(st);
  return st.agentHttp[provider] || { baseURL: "", apiKey: "" };
}

export function setAgentHttp(st, provider, cfg) {
  ensureAgentHttpStore(st);
  st.agentHttp = { ...st.agentHttp, [provider]: { baseURL: "", apiKey: "", ...cfg } };
}

/** 移除 HTTP 供应商（含模型、安装标记、默认指向的清理） */
export function removeAgentHttp(st, provider) {
  ensureAgentHttpStore(st);
  ensureAgentModelsStore(st);
  ensureAgentsEnabledStore(st);
  delete st.agentHttp[provider];
  if (st.agentModels) delete st.agentModels[provider];
  if (st.agents) delete st.agents[provider];
  if (st.agentsEnabled) delete st.agentsEnabled[provider];
  if (st.provider === provider) {
    const fallback =
      [...AGENT_PROVIDERS, ...connectedHttpProviders(st)].find(
        (p) => agentInstalled(st, p.id) && agentEnabled(st, p.id),
      ) || AGENT_PROVIDERS[0];
    st.provider = fallback?.id || "codex";
    st.model = "";
  }
}

/** 已连接的 HTTP 供应商（出现在 agentHttp 里） */
export function connectedHttpProviders(st) {
  ensureAgentHttpStore(st);
  return Object.keys(st.agentHttp)
    .map((id) => providerMeta(st, id))
    .filter((p) => p?.http);
}

/** 模型连接列表：CLI 常驻 + 已添加的 HTTP */
export function connectedAgentProviders(st) {
  return [...AGENT_PROVIDERS, ...connectedHttpProviders(st)];
}

/** 查找任意 provider 元数据（CLI / catalog / agentHttp） */
export function providerMeta(st, id) {
  const cli = AGENT_PROVIDERS.find((x) => x.id === id);
  if (cli) return cli;
  ensureAgentHttpStore(st);
  const cfg = st.agentHttp?.[id];
  const cat = catalogProvider(id);
  if (!cfg && !cat) return null;
  return {
    id,
    label: cfg?.label || cat?.name || id,
    blurb: "HTTP 直调（需 API Key）",
    http: true,
    family: cfg?.family || cat?.family || "openai",
  };
}

/** 已安装的 Agent 列表 */
export function installedAgentProviders(st) {
  return connectedAgentProviders(st).filter((p) => agentInstalled(st, p.id));
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
  const p = providerMeta(st, provider);
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
  const status = installed ? "已安装" : p.http ? "未配置" : "未安装";
  return `<div class="agent-list-item ${isDefault ? "is-default" : ""} ${installed ? "" : "is-missing"} ${enabled ? "" : "is-off"}" data-open-agent="${p.id}" role="button" tabindex="0">
  <div class="agent-card-logo">${agentLogoSvg(p.id)}</div>
  <span class="agent-list-main">
    <span class="agent-card-title">
      <strong>${esc(p.label)}</strong>
      ${isDefault ? `<span class="agent-badge agent-badge-default">默认</span>` : ""}
      <span class="agent-badge ${installed ? "agent-badge-ok" : "agent-badge-miss"}">${status}</span>
      ${enabled ? "" : `<span class="agent-badge agent-badge-off">已关闭</span>`}
    </span>
    <span class="agent-card-blurb">${esc(installed ? p.blurb : p.http ? `${p.blurb}：填写 API Key 后选择模型` : p.blurb)}</span>
  </span>
  <label class="agent-switch" title="${enabled ? "关闭后对话中不可选" : "启用以在对话中选择"}">
    <input type="checkbox" role="switch" data-agent-enable="${p.id}" ${enabled ? "checked" : ""} aria-label="${enabled ? "关闭" : "启用"} ${esc(p.label)}">
    <span class="agent-switch-track" aria-hidden="true"></span>
  </label>
  ${p.http ? `<button type="button" class="ghost agent-remove-btn" data-agent-remove="${p.id}" title="移除该供应商">移除</button>` : ""}
  <span class="account-list-chevron" aria-hidden="true">›</span>
</div>`;
}

// opencode 式：连接字段 + 模型目录（含手填/选用/测试/移除）
export function agentHttpPanelHtml(st, p, info = null) {
  const cfg = getAgentHttp(st, p.id);
  const cat = catalogProvider(p.id);
  const masked = cfg.apiKey ? "••••" + String(cfg.apiKey).slice(-4) : "";
  const base = cfg.baseURL || cat?.api || "";
  const hasKey = !!String(cfg.apiKey || "").trim();
  const codingHint =
    /zai-coding-plan|zhipuai-coding-plan/.test(p.id) || /coding\/paas/i.test(base)
      ? `<p class="settings-hint">智谱 / Z.AI Coding Plan：国内用 <code>https://open.bigmodel.cn/api/coding/paas/v4</code>，国际用 <code>https://api.z.ai/api/coding/paas/v4</code>；须用编程套餐专用 Key。</p>`
      : "";
  const catalogModels = [...new Set([...(cat?.models || []), ...(info?.models || []), ...(cfg.models || [])])];
  if (st.provider === p.id && st.model) setAgentModelList(st, p.id, [...new Set([st.model, ...getAgentModelList(st, p.id)])]);
  const saved = getAgentModelList(st, p.id);
  const suggestions = [...new Set([...catalogModels, ...saved])];
  const list = saved.length ? saved : (hasKey ? catalogModels.slice(0, 8) : []);
  const rows = list.length
    ? list
        .map((m) => {
          const active = st.provider === p.id && st.model === m;
          const verified = catalogModels.includes(m);
          return `<li class="agent-model-item ${active ? "is-active" : ""}" data-model-row="${esc(m)}">
            <code class="agent-model-id">${esc(m)}</code>${verified ? "" : `<span class="agent-badge">自定义 · 未核验</span>`}
            ${active ? `<span class="agent-badge agent-badge-default">使用中</span>` : `<button type="button" class="ghost" data-agent-use="${p.id}" data-model="${esc(m)}" ${hasKey ? "" : "disabled"}>使用</button>`}
            <button type="button" class="ghost" data-agent-test-model="${p.id}" data-model="${esc(m)}" ${hasKey ? "" : "disabled"}>测试</button>
            <button type="button" class="ghost" data-agent-remove-model="${p.id}" data-model="${esc(m)}">移除</button>
            <span class="agent-model-row-status" data-model-status="${esc(m)}" role="status"></span>
          </li>`;
        })
        .join("")
    : `<li class="agent-model-empty settings-hint">${hasKey ? "尚未添加模型。从下方选择模型 ID，或手填后点「添加」。" : "先在上方填写 API Key 并保存，再添加或选择模型。"}</li>`;
  return `<div class="agent-model-panel">
    <p class="settings-hint">HTTP 直调，无需 CLI。Key 仅存本地，不上传。</p>
    ${codingHint}
    <label class="settings-field"><span class="settings-field-label">Base URL</span><input class="agent-model-input" data-agent-http-base="${p.id}" value="${esc(base)}" placeholder="${esc(cat?.api || "https://api.example.com/v1")}" autocomplete="off"></label>
    <label class="settings-field"><span class="settings-field-label">API Key${masked ? `（已存 ${esc(masked)}）` : ""}</span><input class="agent-model-input" type="password" data-agent-http-key="${p.id}" ${masked ? `value="${esc(masked)}" data-key-saved="1" data-key-mask="${esc(masked)}"` : ""} placeholder="${masked ? "已保存，留空不改动" : "粘贴 API Key"}" autocomplete="off"></label>
    <div class="agent-card-actions"><button type="button" class="primary" data-agent-http-save="${p.id}">保存</button><button type="button" class="ghost" data-agent-test-default="${p.id}" ${hasKey ? "" : "disabled"}>测试连通</button><button type="button" class="ghost agent-danger" data-agent-remove="${p.id}">移除供应商</button></div>
    <span class="agent-model-row-status" data-model-status="__http__" role="status"></span>
    <p class="settings-hint" role="status">${esc(info?.source || (catalogModels.length ? `预置模型 ${catalogModels.length} 个` : "尚未读取模型目录"))}${info?.checkedAt ? ` · ${new Date(info.checkedAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}` : ""}</p>
    ${info?.error || info?.notice ? `<p class="settings-hint">${esc(info.error || info.notice)}</p>` : ""}
    <div class="agent-model-add">
      <select class="agent-model-select" data-agent-preset="${p.id}" aria-label="常用模型">
        <option value="">选择模型 ID</option>
        ${suggestions.map((m) => `<option value="${esc(m)}">${esc(m)}${catalogModels.includes(m) ? "" : " · 已保存，未核验"}</option>`).join("")}
      </select>
      <input class="agent-model-input" data-agent-pick="${p.id}" placeholder="或手动输入模型 ID" autocomplete="off">
      <button type="button" class="primary" data-agent-add-model="${p.id}">添加</button>
    </div>
    <ul class="agent-model-list">${rows}</ul>
  </div>`;
}

/** 模型目录面板含回填副作用，保留在 renderer.js，本模块不导出 */

export function agentModelsPanelHtml(st, p, info) {
  if (p.http) return agentHttpPanelHtml(st, p, info);
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
