// @extracted from renderer.js 4467-5190 — 后续改为 export 函数后由 renderer import
function settingsSection({ title, control, className = "" }) {
  const titleHtml = title
    ? `<h3 class="settings-section-title">${esc(title)}</h3>`
    : "";
  return `<section class="settings-section ${className}">${titleHtml}<div class="settings-section-control">${control}</div></section>`;
}

/** 右侧白底面板 */
function settingsPanel(inner, className = "") {
  return `<div class="settings-panel ${className}">${inner}</div>`;
}

/** 面板内表单字段 */
function settingsField(label, controlHtml) {
  return `<label class="settings-field"><span class="settings-field-label">${esc(label)}</span>${controlHtml}</label>`;
}

const AGENT_PROVIDERS = [
  { id: "cursor", label: "Cursor", blurb: "Cursor Agent CLI" },
  { id: "codex", label: "ChatGPT", blurb: "OpenAI Codex CLI" },
  { id: "claude", label: "Claude Code", blurb: "Anthropic Claude Code" },
  { id: "zcode", label: "ZCode", blurb: "Z.ai ZCode（沿用 CLI 默认模型）" },
  { id: "opencode", label: "OpenCode", blurb: "OpenCode CLI" },
  { id: "antigravity", label: "Antigravity", blurb: "Google Antigravity（agy）" },
];

function agentLogoSvg(id, size = 28) {
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

function agentInstalled(id) {
  return !!state.agents?.[id];
}

function ensureAgentsEnabledStore() {
  if (!state.agentsEnabled || typeof state.agentsEnabled !== "object")
    state.agentsEnabled = {};
}

/** Agent 是否在对话中可选；缺省视为启用 */
function agentEnabled(id) {
  ensureAgentsEnabledStore();
  return state.agentsEnabled[id] !== false;
}

async function setAgentEnabled(id, on) {
  ensureAgentsEnabledStore();
  state.agentsEnabled = { ...state.agentsEnabled, [id]: !!on };
  if (!on && state.provider === id) {
    const fallback = selectableAgentProviders()[0];
    if (fallback) {
      state.provider = fallback.id;
      state.model = "";
    }
  }
  await persist();
}

/** 已安装的 Agent 列表 */
function installedAgentProviders() {
  return AGENT_PROVIDERS.filter((p) => agentInstalled(p.id));
}

/** 对话中可选的 Agent（已安装且已启用） */
function selectableAgentProviders() {
  return installedAgentProviders().filter((p) => agentEnabled(p.id));
}

/** 当前侧栏展示用的 provider（优先已安装且已启用） */
function railProviderId() {
  const selectable = selectableAgentProviders();
  if (selectable.some((p) => p.id === state.provider)) return state.provider;
  return selectable[0]?.id || state.provider;
}

/** 触发器文案：模型名，未指定时为「默认」 */
function railModelLabel(provider = railProviderId()) {
  if (provider === state.provider && state.model) return state.model;
  if (provider === state.provider) return "默认";
  const p = AGENT_PROVIDERS.find((x) => x.id === provider);
  return p?.label || "选择模型";
}

/**
 * 侧栏 Agent / 模型联级选择器 HTML。
 */
function modelPickerHTML() {
  const provider = railProviderId();
  const p = AGENT_PROVIDERS.find((x) => x.id === provider);
  const label = railModelLabel(provider);
  const agents = selectableAgentProviders();
  const agentRows = agents.length
    ? agents
        .map((agent) => {
          const models =
            agent.id === "zcode" ? [] : getAgentModelList(agent.id);
          const usingAgent = state.provider === agent.id;
          const modelBtns = [
            `<button type="button" role="menuitemradio" class="model-picker-option" data-provider="${agent.id}" data-model="" aria-checked="${usingAgent && !state.model}">${usingAgent && !state.model ? "✓ " : ""}默认</button>`,
            ...models.map(
              (m) =>
                `<button type="button" role="menuitemradio" class="model-picker-option" data-provider="${agent.id}" data-model="${esc(m)}" aria-checked="${usingAgent && state.model === m}">${usingAgent && state.model === m ? "✓ " : ""}${esc(m)}</button>`,
            ),
          ].join("");
          return `<div class="model-picker-agent" data-agent="${agent.id}">
            <button type="button" class="model-picker-agent-btn" role="menuitem" aria-haspopup="menu" aria-expanded="false">
              <span class="model-picker-logo">${agentLogoSvg(agent.id, 16)}</span>
              <span class="model-picker-agent-name">${esc(agent.label)}</span>
              ${usingAgent ? `<span class="model-picker-current">使用中</span>` : ""}
              ${I.chevronRight({ size: 12 })}
            </button>
            <div class="model-picker-submenu" hidden role="menu">${modelBtns}</div>
          </div>`;
        })
        .join("")
    : `<p class="model-picker-empty">暂无可用的 Agent</p>`;
  return `<div class="model-picker" id="model-picker">
    <button type="button" id="model-picker-trigger" class="model-picker-trigger" title="${esc(p?.label || "")} · ${esc(label)}" aria-label="选择模型：${esc(label)}" aria-haspopup="menu" aria-expanded="false">
      <span class="model-picker-logo">${agentLogoSvg(provider, 16)}</span>
      <span class="model-picker-label">${esc(label)}</span>
      ${I.chevronDown({ size: 12 })}
    </button>
    <div id="model-picker-menu" class="model-picker-menu" hidden role="menu">${agentRows}</div>
  </div>`;
}

/**
 * 绑定侧栏模型联级菜单：一级 Agent，二级已添加模型（含默认）。
 * 菜单使用 fixed 定位，避免被 composer / rail 裁切。
 */
function bindModelPicker() {
  const root = $("#model-picker");
  const trigger = $("#model-picker-trigger");
  const menu = $("#model-picker-menu");
  if (!root || !trigger || !menu) return;

  /** @type {((e: Event) => void) | null} */
  let onDocPointer = null;

  const clearFixed = (el) => {
    el.style.position = "";
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.bottom = "";
    el.style.zIndex = "";
    el.classList.remove("is-fixed");
  };

  const closeAll = () => {
    menu.setAttribute("hidden", "");
    trigger.setAttribute("aria-expanded", "false");
    clearFixed(menu);
    root.querySelectorAll(".model-picker-submenu").forEach((el) => {
      el.setAttribute("hidden", "");
      clearFixed(el);
    });
    root.querySelectorAll(".model-picker-agent-btn").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
    if (onDocPointer) {
      document.removeEventListener("pointerdown", onDocPointer, true);
      onDocPointer = null;
    }
    if (activeComposerMenuDismiss === closeAll) activeComposerMenuDismiss = null;
  };

  const placeMenu = () => {
    const rect = trigger.getBoundingClientRect();
    menu.classList.add("is-fixed");
    menu.style.position = "fixed";
    menu.style.zIndex = "200";
    menu.style.left = "auto";
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.top = "auto";
    menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  };

  const placeSubmenu = (agentEl) => {
    const sub = agentEl.querySelector(".model-picker-submenu");
    const btn = agentEl.querySelector(".model-picker-agent-btn");
    if (!sub || !btn) return;
    sub.classList.add("is-fixed");
    sub.style.position = "fixed";
    sub.style.zIndex = "201";
    const btnRect = btn.getBoundingClientRect();
    const subW = sub.offsetWidth || 160;
    const subH = sub.offsetHeight || 40;
    let left = btnRect.left - subW - 4;
    if (left < 8) left = Math.min(btnRect.right + 4, window.innerWidth - subW - 8);
    let top = btnRect.bottom - subH;
    if (top < 8) top = 8;
    if (top + subH > window.innerHeight - 8)
      top = Math.max(8, window.innerHeight - subH - 8);
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
    sub.style.right = "auto";
    sub.style.bottom = "auto";
  };

  const openSubmenu = (agentEl) => {
    root.querySelectorAll(".model-picker-agent").forEach((el) => {
      const sub = el.querySelector(".model-picker-submenu");
      const btn = el.querySelector(".model-picker-agent-btn");
      const open = !!agentEl && el === agentEl;
      if (sub) {
        if (open) {
          sub.removeAttribute("hidden");
          placeSubmenu(el);
        } else {
          sub.setAttribute("hidden", "");
          clearFixed(sub);
        }
      }
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  };

  trigger.onclick = (e) => {
    e.stopPropagation();
    const willOpen = menu.hasAttribute("hidden");
    dismissActiveComposerMenu();
    if (!willOpen) return;
    menu.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
    activeComposerMenuDismiss = closeAll;
    placeMenu();
    const active = root.querySelector(
      `.model-picker-agent[data-agent="${CSS.escape(railProviderId())}"]`,
    );
    if (active) openSubmenu(active);
    onDocPointer = (ev) => {
      const t = /** @type {Node} */ (ev.target);
      if (root.contains(t) || menu.contains(t)) return;
      if (
        [...root.querySelectorAll(".model-picker-submenu")].some((s) =>
          s.contains(t),
        )
      )
        return;
      closeAll();
    };
    document.addEventListener("pointerdown", onDocPointer, true);
  };

  root.querySelectorAll(".model-picker-agent").forEach((agentEl) => {
    const btn = agentEl.querySelector(".model-picker-agent-btn");
    if (!btn) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      const sub = agentEl.querySelector(".model-picker-submenu");
      const opening = sub?.hasAttribute("hidden");
      openSubmenu(opening ? agentEl : null);
    };
    agentEl.onmouseenter = () => openSubmenu(agentEl);
  });

  root.querySelectorAll(".model-picker-option").forEach((opt) => {
    opt.onclick = async (e) => {
      e.stopPropagation();
      const provider = opt.getAttribute("data-provider") || "";
      const model = opt.getAttribute("data-model") || "";
      if (!provider || !agentInstalled(provider) || !agentEnabled(provider)) {
        toast("未找到该 CLI");
        return;
      }
      state.provider = provider;
      state.model = model;
      closeAll();
      await persistAgentModels();
      const label = railModelLabel(provider);
      const logo = trigger.querySelector(".model-picker-logo");
      const text = trigger.querySelector(".model-picker-label");
      if (logo) logo.innerHTML = agentLogoSvg(provider, 16);
      if (text) text.textContent = label;
      const agentLabel =
        AGENT_PROVIDERS.find((x) => x.id === provider)?.label || "";
      trigger.title = `${agentLabel} · ${label}`;
      trigger.setAttribute("aria-label", `选择模型：${label}`);
      root.querySelectorAll(".model-picker-option").forEach((btn) => {
        const on =
          btn.getAttribute("data-provider") === provider &&
          (btn.getAttribute("data-model") || "") === model;
        btn.setAttribute("aria-checked", on ? "true" : "false");
        const raw = (btn.getAttribute("data-model") || "") || "默认";
        const name = btn.getAttribute("data-model") ? raw : "默认";
        btn.textContent = on ? `✓ ${name}` : name;
      });
      root.querySelectorAll(".model-picker-agent").forEach((el) => {
        const mark = el.querySelector(".model-picker-current");
        const isOn = el.getAttribute("data-agent") === provider;
        if (isOn && !mark) {
          const name = el.querySelector(".model-picker-agent-name");
          name?.insertAdjacentHTML(
            "afterend",
            `<span class="model-picker-current">使用中</span>`,
          );
        } else if (!isOn && mark) mark.remove();
      });
    };
  });
}

function ensureAgentModelsStore() {
  if (!state.agentModels || typeof state.agentModels !== "object")
    state.agentModels = {};
}

function getAgentModelList(provider) {
  ensureAgentModelsStore();
  const list = state.agentModels[provider];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function setAgentModelList(provider, list) {
  ensureAgentModelsStore();
  state.agentModels = {
    ...state.agentModels,
    [provider]: [...new Set(list.map((x) => String(x).trim()).filter(Boolean))],
  };
}

function agentSuggestionIds(provider, discovered = []) {
  const saved = getAgentModelList(provider);
  return [...new Set([...discovered, ...saved])];
}

function openAgentDetail(id, tab = "connection") {
  agentDetailId = id;
  agentDetailTab = tab;
  page = "agent";
  render();
}

function agentListItemHtml(p) {
  const installed = agentInstalled(p.id);
  const enabled = agentEnabled(p.id);
  const isDefault = state.provider === p.id;
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

function agentModelsPanelHtml(p, info) {
  const installed = agentInstalled(p.id);
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
  const saved = getAgentModelList(p.id);
  if (!saved.length && state.provider === p.id && state.model) {
    setAgentModelList(p.id, [state.model]);
  }
  const list = getAgentModelList(p.id);
  const suggestions = agentSuggestionIds(p.id, info?.models || []);
  const rows = list.length
    ? list
        .map((m) => {
          const active = state.provider === p.id && state.model === m;
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

function setModelRowStatus(provider, model, text, kind = "") {
  const root =
    $(`[data-agent-body="${provider}"]`) ||
    $(`.agent-card[data-agent="${provider}"]`) ||
    document;
  const el = [...root.querySelectorAll("[data-model-status]")].find(
    (n) => n.getAttribute("data-model-status") === model,
  );
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind;
}

async function persistAgentModels() {
  ensureAgentModelsStore();
  await persist();
}

async function fillAgentCard(p, refresh = false) {
  const body = $(`[data-agent-body="${p.id}"]`);
  if (!body) return;
  if (!agentInstalled(p.id)) {
    body.innerHTML = agentModelsPanelHtml(p, null);
    return;
  }
  let info = { models: [], selectable: p.id !== "zcode", current: "" };
  try {
    info = await api("agent-models", { provider: p.id, refresh });
  } catch (e) {
    info = {
      models: [],
      selectable: p.id !== "zcode",
      current: "",
      error: e.message || "读取失败",
    };
  }
  body.innerHTML = agentModelsPanelHtml(p, info);
  bindAgentModelControls(p);
}

function bindAgentModelControls(p) {
  const refresh = $(`[data-agent-refresh="${p.id}"]`);
  if (refresh) refresh.onclick = async () => { refresh.disabled = true; refresh.textContent = "刷新中…"; await fillAgentCard(p, true); };
  const useDefault = $(`[data-agent-cli-default="${p.id}"]`);
  if (useDefault)
    useDefault.onclick = async () => {
      if (!agentEnabled(p.id)) await setAgentEnabled(p.id, true);
      state.provider = p.id;
      state.model = "";
      await persistAgentModels();
      render();
    };

  const addBtn = $(`[data-agent-add-model="${p.id}"]`);
  const pick = $(`[data-agent-pick="${p.id}"]`);
  const preset = $(`[data-agent-preset="${p.id}"]`);
  if (preset && pick)
    preset.onchange = () => {
      if (preset.value) pick.value = preset.value;
    };
  const addModel = async () => {
    const value = (pick?.value || "").trim();
    if (!value) return toast("请输入或选择模型 ID");
    const next = [...getAgentModelList(p.id), value];
    setAgentModelList(p.id, next);
    await persistAgentModels();
    if (pick) pick.value = "";
    if (preset) preset.value = "";
    toast("已添加模型");
    fillAgentCard(p);
  };
  if (addBtn) addBtn.onclick = addModel;
  if (pick)
    pick.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addModel();
      }
    };

  $$(`[data-agent-use="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      if (!agentEnabled(p.id)) await setAgentEnabled(p.id, true);
      if (state.provider !== p.id) state.provider = p.id;
      state.model = model;
      await persistAgentModels();
      toast(`已使用 ${model}`);
      render();
    };
  });

  $$(`[data-agent-remove-model="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      setAgentModelList(
        p.id,
        getAgentModelList(p.id).filter((m) => m !== model),
      );
      if (state.provider === p.id && state.model === model) state.model = "";
      await persistAgentModels();
      fillAgentCard(p);
    };
  });

  $$(`[data-agent-test-model="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      btn.disabled = true;
      setModelRowStatus(p.id, model, "测试中…", "pending");
      try {
        const result = await api("agent-test", { provider: p.id, model });
        if (result.ok) {
          const ms = result.latencyMs != null ? `${result.latencyMs}ms` : "ok";
          setModelRowStatus(p.id, model, ms, "ok");
          toast(`${p.label} · ${model} 连通正常`);
        } else {
          setModelRowStatus(p.id, model, result.error || "失败", "err");
          toast(result.error || "连接失败");
        }
      } catch (e) {
        setModelRowStatus(p.id, model, e.message || "失败", "err");
        toast(e.message || "连接失败");
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function runAgentDefaultTest(id) {
  const p = AGENT_PROVIDERS.find((x) => x.id === id);
  if (!agentInstalled(id)) return toast("未找到该 CLI");
  const btn =
    $(`[data-agent-test-default="${id}"]`) || $("#agent-test-default");
  if (btn) btn.disabled = true;
  toast(`${p?.label || id}：测试 CLI 默认…`);
  try {
    const result = await api("agent-test", { provider: id, model: "" });
    if (result.ok) {
      toast(
        `${p?.label || id} 默认连通正常` +
          (result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""),
      );
    } else toast(result.error || "连接失败");
  } catch (e) {
    toast(e.message || "连接失败");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function mountAgentsSettings() {
  try {
    const next = await api("load");
    if (next?.agents) state.agents = next.agents;
    if (next?.agentModels) state.agentModels = next.agentModels;
    if (next?.agentsEnabled) state.agentsEnabled = next.agentsEnabled;
  } catch {
    /* keep cached */
  }
  ensureAgentModelsStore();
  ensureAgentsEnabledStore();

  $$("[data-open-agent]").forEach((item) => {
    const open = () => openAgentDetail(item.dataset.openAgent);
    item.onclick = (e) => {
      if (e.target.closest("[data-agent-enable], .agent-switch")) return;
      open();
    };
    item.onkeydown = (e) => {
      if (e.target.closest("[data-agent-enable], .agent-switch")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };
  });
  $$("[data-agent-enable]").forEach((input) => {
    input.onclick = (e) => e.stopPropagation();
    input.onchange = async () => {
      const id = input.getAttribute("data-agent-enable") || "";
      if (!id) return;
      input.disabled = true;
      try {
        await setAgentEnabled(id, input.checked);
        render();
      } catch (e) {
        input.checked = !input.checked;
        toast(e.message || "保存失败");
        input.disabled = false;
      }
    };
  });
  mountAgentUsage($("#agent-usage"), api, AGENT_PROVIDERS, {
    mode: "overview",
  });
}

async function renderAgentDetail() {
  const p = AGENT_PROVIDERS.find((x) => x.id === agentDetailId);
  if (!p) {
    page = "settings";
    settingsTab = "agents";
    agentDetailId = null;
    render();
    return;
  }
  try {
    const next = await api("load");
    if (next?.agents) state.agents = next.agents;
    if (next?.agentModels) state.agentModels = next.agentModels;
    if (next?.agentsEnabled) state.agentsEnabled = next.agentsEnabled;
  } catch {
    /* keep cached */
  }
  ensureAgentModelsStore();
  ensureAgentsEnabledStore();
  if (!["connection", "usage"].includes(agentDetailTab))
    agentDetailTab = "connection";

  const installed = agentInstalled(p.id);
  const enabled = agentEnabled(p.id);
  const isDefault = state.provider === p.id;
  const tabs = [
    { id: "connection", title: "连接" },
    { id: "usage", title: "使用统计" },
  ];
  const actions = [
    isDefault
      ? ""
      : `<button type="button" class="primary" id="agent-set-default" ${installed ? "" : "disabled"}>设为默认</button>`,
    `<button type="button" class="ghost" id="agent-test-default" ${installed ? "" : "disabled"} title="不指定模型，使用 CLI 默认">测试默认</button>`,
  ]
    .filter(Boolean)
    .join("");

  const shell = (body) => {
    $("#main").innerHTML =
      `<header><div class="header-lead account-detail-lead"><button type="button" class="ghost icon-btn" id="agent-detail-back" title="返回模型列表" aria-label="返回模型列表">${I.chevronLeft({ size: 22 })}</button><h1 class="dashboard-tagline">${esc(p.label)}</h1></div><div class="header-actions">${actions}</div></header><section class="dashboard account-detail settings agent-detail"><nav class="settings-tabs account-detail-tabs" role="tablist">${tabs
        .map(
          (t) =>
            `<button type="button" role="tab" data-agent-tab="${t.id}" aria-selected="${agentDetailTab === t.id}" class="${agentDetailTab === t.id ? "active" : ""}">${t.title}</button>`,
        )
        .join("")}</nav><div id="agent-detail-body" class="settings-body">${body}</div></section>`;
    $("#agent-detail-back").onclick = () => {
      page = "settings";
      settingsTab = "agents";
      agentDetailId = null;
      render();
    };
    const setDefault = $("#agent-set-default");
    if (setDefault)
      setDefault.onclick = async () => {
        if (!agentInstalled(p.id)) return toast("未找到该 CLI");
        if (!agentEnabled(p.id)) await setAgentEnabled(p.id, true);
        state.provider = p.id;
        state.model = "";
        await persistAgentModels();
        toast(`已设为默认：${p.label}`);
        render();
      };
    const testDefault = $("#agent-test-default");
    if (testDefault)
      testDefault.onclick = () => runAgentDefaultTest(p.id);
    $$("[data-agent-tab]").forEach((b) => {
      b.onclick = () => {
        agentDetailTab = b.dataset.agentTab;
        render();
      };
    });
  };

  if (agentDetailTab === "usage") {
    shell(
      settingsSection({
        title: "调用明细",
        className: "settings-section-agents",
        control: `<section id="agent-usage" class="agent-usage"></section>`,
      }),
    );
    mountAgentUsage($("#agent-usage"), api, AGENT_PROVIDERS, {
      mode: "detail",
      provider: p.id,
    });
    return;
  }

  shell(
    [
      settingsSection({
        title: "基本信息",
        control: settingsPanel(
          `<div class="account-overview-top agent-overview-top"><div class="agent-card-logo agent-overview-logo">${agentLogoSvg(p.id)}</div><div class="account-overview-info"><h2>${esc(p.label)}</h2><div class="account-stat-meta"><span class="agent-badge ${installed ? "agent-badge-ok" : "agent-badge-miss"}">${installed ? "已安装" : "未安装"}</span>${enabled ? "" : `<span class="agent-badge agent-badge-off">已关闭</span>`}${isDefault ? `<span class="agent-badge agent-badge-default">默认</span>` : ""}<span>${esc(p.blurb)}</span></div></div></div>`,
        ),
      }),
      settingsSection({
        title: "模型",
        className: "settings-section-agents",
        control: settingsPanel(
          `<div data-agent-body="${p.id}"><p class="settings-hint">读取可用模型…</p></div>`,
        ),
      }),
    ].join(""),
  );
  await fillAgentCard(p);
}
