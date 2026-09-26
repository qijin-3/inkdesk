const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

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
  if (b === "all") return "所有";
  if (b === "none") return "不启用";
  const labels = b.map(
    (id) => accounts.find((a) => a.id === id)?.label || id,
  );
  if (!labels.length) return "不启用";
  if (labels.length <= 2) return labels.join("、");
  return `${labels.slice(0, 2).join("、")} 等 ${labels.length} 个`;
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
  return `<details class="skill-accounts" data-skill-accounts="${escape(skillId)}"><summary title="支持的账号">${escape(bindingLabel(b, accounts))}</summary><div class="skill-accounts-menu"><label class="skill-accounts-option"><input type="checkbox" data-skill-bind="${escape(skillId)}" data-bind-value="all" ${allOn ? "checked" : ""}><span>所有</span></label>${accountRows}<label class="skill-accounts-option"><input type="checkbox" data-skill-bind="${escape(skillId)}" data-bind-value="none" ${noneOn ? "checked" : ""}><span>不启用</span></label></div></details>`;
}

function readBindingFromMenu(menu) {
  const checked = [...menu.querySelectorAll("input[data-bind-value]:checked")];
  const values = checked.map((el) => el.getAttribute("data-bind-value"));
  if (values.includes("none") && values.length === 1) return "none";
  if (values.includes("all")) return "all";
  return values.filter((v) => v !== "all" && v !== "none");
}

/**
 * 设置页：树状分组平铺全部技能；账号详情可按当前账号过滤。
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
  const visibleTree = () => {
    if (!opts.lockAccount) return state.tree;
    return state.tree
      .map((g) => ({
        ...g,
        skills: g.skills.filter((x) =>
          skillAvailableFor(x.binding ?? state.bindings?.[x.id], state.account),
        ),
      }))
      .filter((g) => g.skills.length);
  };
  const draw = () => {
    const tree = visibleTree();
    const treeHtml = tree.length
      ? tree
          .map((g) => {
            const rows = g.skills
              .map((x) => {
                const binding =
                  x.binding ?? state.bindings?.[x.id] ?? "none";
                return `<div class="skill-tree-row" data-skill-id="${escape(x.id)}"><div class="skill-tree-main"><strong>${escape(x.name)}</strong><span class="muted">${escape(x.description || "")}</span>${x.missing ? '<span class="notice">目录异常</span>' : ""}</div><div class="skill-tree-actions">${bindingMenuHtml(x.id, binding, accounts)}<button type="button" class="ghost" data-reveal="${escape(x.id)}">访达</button><button type="button" class="ghost danger" data-remove="${escape(x.id)}">删除</button></div></div>`;
              })
              .join("");
            return `<details class="skill-tree-group" open><summary><span class="skill-tree-group-label">${escape(g.label)}</span><span class="muted">${g.skills.length}</span></summary><div class="skill-tree-list">${rows}</div></details>`;
          })
          .join("")
      : opts.lockAccount
        ? '<p class="settings-empty">当前账号暂无可用技能。请到设置 → 技能库，将技能绑定到「所有」或本账号。</p>'
        : '<p class="settings-empty">还没有技能。将含 SKILL.md 的文件夹放到仓库 <code>.agents/skills</code>，或使用导入 / 新建。</p>';
    if (opts.layout === "sections") {
      root.innerHTML = `<section class="settings-section"><h3 class="settings-section-title">技能库</h3><div class="settings-section-control"><div class="settings-panel-toolbar"><button type="button" id="skill-reveal-root">访达</button><button type="button" id="skill-import">导入文件夹</button><button type="button" class="primary" id="skill-new">＋ 新建</button></div><div class="settings-panel settings-panel-flush"><div class="skill-tree">${treeHtml}</div></div><p id="skill-page-error" role="status"></p></div></section>`;
    } else {
      const head = opts.compact
        ? `<div class="settings-card-actions skill-compact-actions"><button type="button" id="skill-reveal-root">访达</button><button type="button" id="skill-import">导入文件夹</button><button type="button" class="primary" id="skill-new">＋ 新建</button></div><p class="muted">仓库 <code>${escape(state.root)}</code> · 为每个技能选择支持的账号。</p>`
        : `<div class="settings-card-head accounts-toolbar"><h3>技能</h3><div class="settings-card-actions"><button type="button" id="skill-reveal-root">访达</button><button type="button" id="skill-import">导入文件夹</button><button type="button" class="primary" id="skill-new">＋ 新建</button></div></div><p class="muted">技能存放于仓库 <code>${escape(state.root)}</code>；运行时以软链接挂到 Agent 工作区同名路径。</p>`;
      root.innerHTML = `${head}<div class="skill-tree">${treeHtml}</div><p id="skill-page-error" role="status"></p>`;
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
        const next = await api("skills-import", {
          account: state.account,
          revision: state.revision,
        });
        if (!next) return;
        state = next;
        draw();
      } catch (e) {
        err(e.message);
      }
    };
    root.querySelector("#skill-new").onclick = async () => {
      const name = await askLine(
        "技能名称",
        "小写字母、数字、连字符，如 fact-check",
      );
      if (name == null) return;
      const description = await askLine(
        "技能描述",
        "做什么、何时使用（1–1024 字）",
      );
      if (description == null) return;
      const group = await askLine("分组路径（可留空）", "可选，如 writing；留空放在根目录", {
        allowEmpty: true,
      });
      if (group == null) return;
      try {
        state = await api("skills-create", {
          account: state.account,
          revision: state.revision,
          name,
          description,
          group,
        });
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
          const nextBinding = Array.isArray(binding) && binding.length === 0
            ? "none"
            : binding;
          const summary = details.querySelector("summary");
          if (summary) summary.textContent = bindingLabel(nextBinding, accounts);
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
