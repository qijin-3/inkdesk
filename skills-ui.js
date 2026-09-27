import { I } from "./icons.js";

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/** 网页端选择技能文件夹（含 SKILL.md），返回可上传的相对路径文件列表 */
function pickSkillFolderFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.directory = true;
    input.multiple = true;
    input.style.cssText =
      "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;";
    document.body.append(input);
    let settled = false;
    /** @param {File[]} files */
    const done = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () =>
      done(input.files ? [...input.files] : []),
    );
    input.addEventListener("cancel", () => done([]));
    input.click();
  });
}

/**
 * @param {File[]} files
 * @returns {Promise<{ path: string, bytes: number[] }[]>}
 */
async function skillFilesPayload(files) {
  const out = [];
  for (const f of files) {
    const rel = String(f.webkitRelativePath || f.name || "").replace(/\\/g, "/");
    if (!rel || rel.split("/").some((p) => p.startsWith("."))) continue;
    out.push({
      path: rel,
      bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
    });
  }
  return out;
}

function askLine(title, placeholder = "", { allowEmpty = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "skill-ask-dialog";
    d.innerHTML = `<div class="skill-ask-body"><h2>${escape(title)}</h2><input id="skill-prompt-input" type="text" placeholder="${escape(placeholder)}" autocomplete="off"><div class="row"><button type="button" id="skill-prompt-cancel">取消</button><button type="button" class="primary" id="skill-prompt-ok">确定</button></div></div>`;
    document.body.append(d);
    const input = d.querySelector("#skill-prompt-input");
    const done = (v) => {
      d.close();
      d.remove();
      resolve(v);
    };
    d.querySelector("#skill-prompt-cancel").onclick = () => done(null);
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(null);
    });
    const submit = () => {
      const v = input.value.trim();
      if (!v && !allowEmpty) return;
      done(v);
    };
    d.querySelector("#skill-prompt-ok").onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    d.showModal();
    input.focus();
  });
}

function normalizeBinding(raw) {
  if (raw === "all" || raw === "none") return raw;
  if (Array.isArray(raw)) {
    const ids = [
      ...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)),
    ];
    return ids.length ? ids : "none";
  }
  return "none";
}

function skillAvailableFor(binding, account) {
  const b = normalizeBinding(binding);
  if (b === "all") return true;
  if (b === "none") return false;
  return b.includes(account);
}

function bindingLabel(binding, accounts) {
  const b = normalizeBinding(binding);
  if (b === "all") return "全局";
  if (b === "none") return "禁用";
  const labels = b.map(
    (id) => accounts.find((a) => a.id === id)?.label || id,
  );
  if (!labels.length) return "禁用";
  if (labels.length <= 2) return labels.join("、");
  return `${labels.slice(0, 2).join("、")} 等 ${labels.length} 个`;
}

/** 按名称稳定映射到色板序号（与分组 tag 一致）。 */
function bindTagTone(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

/**
 * 账号绑定摘要：以 tag 呈现。
 * @param {string|string[]} binding
 * @param {{ id: string, label: string }[]} accounts
 */
function bindingTagsHtml(binding, accounts) {
  const b = normalizeBinding(binding);
  if (b === "all")
    return `<span class="group-chip skill-bind-tag skill-bind-tag-all">全局</span>`;
  if (b === "none")
    return `<span class="group-chip skill-bind-tag skill-bind-tag-none">禁用</span>`;
  return b
    .map((id) => {
      const label = accounts.find((a) => a.id === id)?.label || id;
      return `<span class="group-chip group-chip-${bindTagTone(label)} skill-bind-tag">${escape(label)}</span>`;
    })
    .join("");
}

function bindingMenuHtml(skillId, binding, accounts) {
  const b = normalizeBinding(binding);
  const allOn = b === "all";
  const noneOn = b === "none";
  const selected = Array.isArray(b) ? new Set(b) : new Set();
  const accountRows = accounts
    .map(
      (a) =>
        `<label class="skill-accounts-option"><input type="checkbox" data-skill-bind="${escape(skillId)}" data-bind-value="${escape(a.id)}" ${!allOn && !noneOn && selected.has(a.id) ? "checked" : ""}><span>${escape(a.label)}</span></label>`,
    )
    .join("");
  return `<details class="skill-accounts" data-skill-accounts="${escape(skillId)}"><summary title="支持的账号：${escape(bindingLabel(b, accounts))}">${bindingTagsHtml(b, accounts)}</summary><div class="skill-accounts-menu"><label class="skill-accounts-option"><input type="checkbox" data-skill-bind="${escape(skillId)}" data-bind-value="all" ${allOn ? "checked" : ""}><span>全局</span></label>${accountRows}<label class="skill-accounts-option"><input type="checkbox" data-skill-bind="${escape(skillId)}" data-bind-value="none" ${noneOn ? "checked" : ""}><span>禁用</span></label></div></details>`;
}

function readBindingFromMenu(menu) {
  const checked = [...menu.querySelectorAll("input[data-bind-value]:checked")];
  const values = checked.map((el) => el.getAttribute("data-bind-value"));
  if (values.includes("none") && values.length === 1) return "none";
  if (values.includes("all")) return "all";
  return values.filter((v) => v !== "all" && v !== "none");
}

/**
 * 设置页：平铺技能卡片；账号详情可按当前账号过滤。
 * @param {HTMLElement} root
 * @param {(name: string, data?: object) => Promise<any>} api
 * @param {string} account 当前账号（账号详情过滤用）
 * @param {{ id: string, label: string }[]} accounts 全部账号（绑定多选）
 * @param {(id?: string) => void} [onRefresh]
 * @param {{ lockAccount?: boolean, compact?: boolean, layout?: "sections" }} [opts]
 */
export async function mountSkillsSettings(
  root,
  api,
  account,
  accounts,
  onRefresh = () => {},
  opts = {},
) {
  let state;
  let skillQuery = "";
  const err = (msg) => {
    const el = root.querySelector("#skill-page-error");
    if (el) el.textContent = msg || "";
  };
  const load = async () => {
    if (!accounts.length) {
      root.innerHTML =
        '<p class="muted">请先添加账号，再管理技能与账号绑定。</p>';
      return;
    }
    state = await api("skills-list", { account: account || accounts[0].id });
    draw();
  };
  /** @returns {any[]} */
  const flatSkills = () => {
    const fromItems = Array.isArray(state.items) ? state.items : null;
    let list = fromItems
      ? [...fromItems]
      : (state.tree || []).flatMap((g) => g.skills || []);
    if (opts.lockAccount) {
      list = list.filter((x) =>
        skillAvailableFor(x.binding ?? state.bindings?.[x.id], state.account),
      );
    }
    return list.sort((a, b) =>
      String(a.name || a.id).localeCompare(String(b.name || b.id), "zh"),
    );
  };
  const filteredSkills = () => {
    const q = skillQuery.trim().toLowerCase();
    const list = flatSkills();
    if (!q) return list;
    return list.filter((x) => {
      const hay = `${x.name || ""} ${x.description || ""} ${x.id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  };
  const skillCardHtml = (x) => {
    const binding = x.binding ?? state.bindings?.[x.id] ?? "none";
    return `<article class="skill-card" data-skill-id="${escape(x.id)}"><div class="skill-card-body"><div class="skill-card-head"><strong class="skill-card-name">${escape(x.name)}</strong>${bindingMenuHtml(x.id, binding, accounts)}</div><p class="skill-card-desc muted">${escape(x.description || "")}</p>${x.missing ? '<p class="notice">目录异常</p>' : ""}</div><div class="skill-card-actions"><button type="button" class="ghost icon-btn" data-reveal="${escape(x.id)}" title="访达" aria-label="访达">${I.folder({ size: 15 })}</button><button type="button" class="ghost icon-btn danger" data-remove="${escape(x.id)}" title="删除" aria-label="删除">${I.trash({ size: 15 })}</button></div></article>`;
  };
  const draw = () => {
    const skills = filteredSkills();
    const total = flatSkills().length;
    const listHtml = skills.length
      ? `<div class="skill-card-list">${skills.map(skillCardHtml).join("")}</div>`
      : opts.lockAccount
        ? '<p class="settings-empty">当前账号暂无可用技能。请到设置 → 技能，将技能绑定到「全局」或本账号。</p>'
        : total
          ? '<p class="settings-empty">没有匹配的技能。</p>'
          : '<p class="settings-empty">还没有技能。将含 SKILL.md 的文件夹放到仓库 <code>.agents/skills</code>，或使用导入技能。</p>';
    const searchHtml = `<div class="skill-search-wrap">${I.search({ size: 15 })}<input type="search" id="skill-search" class="skill-search" placeholder="搜索技能名称或描述…" value="${escape(skillQuery)}" autocomplete="off"></div>`;
    const toolbar = `<div class="settings-panel-toolbar skill-toolbar"><button type="button" id="skill-reveal-root">查看本地文件</button><button type="button" id="skill-import">导入技能</button>${searchHtml}</div>`;
    if (opts.layout === "sections") {
      root.innerHTML = `<section class="settings-section"><div class="settings-section-control">${toolbar}<div class="skill-board">${listHtml}</div><p id="skill-page-error" role="status"></p></div></section>`;
    } else {
      const head = opts.compact
        ? `<div class="settings-card-actions skill-compact-actions"><button type="button" id="skill-reveal-root">查看本地文件</button><button type="button" id="skill-import">导入技能</button>${searchHtml}</div><p class="muted">仓库 <code>${escape(state.root)}</code> · 为每个技能选择支持的账号。</p>`
        : `<div class="settings-card-head accounts-toolbar"><h3>技能</h3><div class="settings-card-actions"><button type="button" id="skill-reveal-root">查看本地文件</button><button type="button" id="skill-import">导入技能</button>${searchHtml}</div></div><p class="muted">技能存放于仓库 <code>${escape(state.root)}</code>；运行时以软链接挂到 Agent 工作区同名路径。</p>`;
      root.innerHTML = `${head}<div class="skill-board">${listHtml}</div><p id="skill-page-error" role="status"></p>`;
    }
    const search = root.querySelector("#skill-search");
    if (search) {
      search.oninput = () => {
        skillQuery = search.value;
        const active = document.activeElement === search;
        const pos = search.selectionStart;
        draw();
        const next = root.querySelector("#skill-search");
        if (active && next) {
          next.focus();
          try {
            next.setSelectionRange(pos, pos);
          } catch (_) {}
        }
      };
    }
    root.querySelector("#skill-reveal-root").onclick = async () => {
      try {
        await api("skills-reveal", { account: state.account });
      } catch (e) {
        err(e.message);
      }
    };
    root.querySelector("#skill-import").onclick = async () => {
      try {
        /** @type {*} */
        let payload = {
          account: state.account,
          revision: state.revision,
        };
        if (window.desk?.web) {
          const picked = await pickSkillFolderFiles();
          if (!picked.length) return;
          const files = await skillFilesPayload(picked);
          if (!files.length) throw Error("请选择有效的技能文件夹");
          payload = { ...payload, files };
        }
        const next = await api("skills-import", payload);
        if (!next) return;
        state = next;
        draw();
      } catch (e) {
        err(e.message);
      }
    };
    root.querySelectorAll("[data-skill-accounts]").forEach((details) => {
      const skillId = details.getAttribute("data-skill-accounts");
      const menu = details.querySelector(".skill-accounts-menu");
      const applyExclusive = (changed) => {
        const value = changed.getAttribute("data-bind-value");
        if (!changed.checked) {
          if (value === "all" || value === "none") return;
          const anyAccount = [
            ...menu.querySelectorAll(
              'input[data-bind-value]:not([data-bind-value="all"]):not([data-bind-value="none"])',
            ),
          ].some((el) => el.checked);
          if (!anyAccount) {
            const none = menu.querySelector('input[data-bind-value="none"]');
            if (none) none.checked = true;
          }
          return;
        }
        if (value === "all" || value === "none") {
          menu
            .querySelectorAll("input[data-bind-value]")
            .forEach((el) => {
              el.checked = el === changed;
            });
          return;
        }
        const all = menu.querySelector('input[data-bind-value="all"]');
        const none = menu.querySelector('input[data-bind-value="none"]');
        if (all) all.checked = false;
        if (none) none.checked = false;
      };
      menu.querySelectorAll("input[data-bind-value]").forEach((input) => {
        input.onchange = async () => {
          applyExclusive(input);
          const binding = readBindingFromMenu(menu);
          const nextBinding =
            Array.isArray(binding) && binding.length === 0 ? "none" : binding;
          const summary = details.querySelector("summary");
          if (summary)
            summary.innerHTML = bindingTagsHtml(nextBinding, accounts);
          try {
            state = await api("skills-configure", {
              account: state.account,
              revision: state.revision,
              id: skillId,
              binding: nextBinding,
            });
            draw();
          } catch (e) {
            draw();
            err(e.message || "保存失败");
          }
        };
      });
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        const close = (e) => {
          if (details.contains(e.target)) return;
          details.open = false;
          document.removeEventListener("pointerdown", close, true);
        };
        document.addEventListener("pointerdown", close, true);
      });
    });
    root.querySelectorAll("[data-reveal]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api("skills-reveal", {
            account: state.account,
            id: b.getAttribute("data-reveal"),
          });
        } catch (e) {
          err(e.message);
        }
      };
    });
    root.querySelectorAll("[data-remove]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("删除此技能？将移除仓库 .agents/skills 下对应文件夹。"))
          return;
        try {
          state = await api("skills-remove", {
            account: state.account,
            revision: state.revision,
            id: b.getAttribute("data-remove"),
          });
          draw();
        } catch (e) {
          err(e.message);
        }
      };
    });
  };
  try {
    await load();
  } catch (e) {
    root.innerHTML = `<p class="notice">${escape(e.message)}</p>`;
  }
}

/** @deprecated 保留空实现以免旧调用报错；设置页请用 mountSkillsSettings */
export async function manageSkills() {}

export async function mountSkillPicker(root, api, account, session) {
  let data;
  try {
    data = await api("skills-list", { account });
    if (!root.isConnected) return;
    const available = (data.items || []).filter((x) =>
      skillAvailableFor(x.binding ?? data.bindings?.[x.id], data.account),
    );
    const availableIds = new Set(available.map((x) => x.id));
    const defaults = data.accounts[data.account] || available.map((x) => x.id);
    const ids = (session.skillIds ?? defaults).filter((id) =>
      availableIds.has(id),
    );
    session.skillIds = [...ids];
    const draw = () => {
      const selected = session.skillIds || [];
      const byGroup = (data.tree || [])
        .map((g) => ({
          ...g,
          skills: g.skills.filter((x) => availableIds.has(x.id)),
        }))
        .filter((g) => g.skills.length);
      root.innerHTML = `<details class="chat-skill-menu"><summary title="选择本次技能">技能${selected.length ? ` · ${selected.length}` : ""}</summary><div class="chat-skill-options"><strong>本次使用</strong>${
        byGroup
          .map((g) => {
            const rows = g.skills
              .map(
                (x) =>
                  `<label class="skill-check"><input type="checkbox" value="${escape(x.id)}" ${selected.includes(x.id) ? "checked" : ""}>${escape(x.name)}${g.group ? `<small>${escape(g.group)}</small>` : ""}</label>`,
              )
              .join("");
            return g.group
              ? `<div class="chat-skill-group"><span>${escape(g.label)}</span>${rows}</div>`
              : rows;
          })
          .join("") ||
        "<p>还没有可用技能，请在设置 → 技能中绑定账号。</p>"
      }</div></details>`;
      root.querySelectorAll("input").forEach(
        (x) =>
          (x.onchange = () => {
            session.skillIds = [...root.querySelectorAll("input:checked")].map(
              (el) => el.value,
            );
            root.querySelector("summary").textContent = `技能${
              session.skillIds.length
                ? " · " + session.skillIds.length
                : ""
            }`;
            root.dispatchEvent(
              new CustomEvent("skills-change", { bubbles: true }),
            );
          }),
      );
      root.querySelector("details").addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.currentTarget.open = false;
          root.querySelector("summary").focus();
        }
      });
    };
    draw();
  } catch (e) {
    if (root.isConnected) root.textContent = e.message;
  }
}
