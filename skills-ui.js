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

/**
 * 设置页：树状分组平铺全部技能。
 * @param {HTMLElement} root
 * @param {(name: string, data?: object) => Promise<any>} api
 * @param {string} account 当前用于默认启用的账号
 * @param {{ id: string, label: string }[]} accounts
 * @param {() => void} [onRefresh]
 */
export async function mountSkillsSettings(
  root,
  api,
  account,
  accounts,
  onRefresh = () => {},
) {
  let state;
  const err = (msg) => {
    const el = root.querySelector("#skill-page-error");
    if (el) el.textContent = msg || "";
  };
  const load = async () => {
    if (!account) {
      root.innerHTML =
        '<p class="muted">请先添加账号，再管理技能默认启用项。</p>';
      return;
    }
    state = await api("skills-list", { account });
    draw();
  };
  const draw = () => {
    const defaults = state.accounts[state.account] || [];
    const accountOpts = accounts
      .map(
        (a) =>
          `<option value="${escape(a.id)}" ${a.id === state.account ? "selected" : ""}>${escape(a.label)}</option>`,
      )
      .join("");
    const treeHtml = state.tree.length
      ? state.tree
          .map((g) => {
            const rows = g.skills
              .map((x) => {
                const enabled = defaults.includes(x.id);
                return `<div class="skill-tree-row" data-skill-id="${escape(x.id)}"><div class="skill-tree-main"><strong>${escape(x.name)}</strong><span class="muted">${escape(x.description || "")}</span>${x.missing ? '<span class="notice">目录异常</span>' : ""}</div><div class="skill-tree-actions"><label class="skill-check"><input type="checkbox" data-default="${escape(x.id)}" ${enabled ? "checked" : ""}> 默认启用</label><button type="button" class="ghost" data-reveal="${escape(x.id)}">访达</button><button type="button" class="ghost danger" data-remove="${escape(x.id)}">删除</button></div></div>`;
              })
              .join("");
            return `<details class="skill-tree-group" open><summary><span class="skill-tree-group-label">${escape(g.label)}</span><span class="muted">${g.skills.length}</span></summary><div class="skill-tree-list">${rows}</div></details>`;
          })
          .join("")
      : '<p class="muted">还没有技能。将含 SKILL.md 的文件夹放到仓库 <code>.agents/skills</code>，或使用导入 / 新建。</p>';
    root.innerHTML = `<div class="settings-card-head accounts-toolbar"><h3>技能</h3><div class="settings-card-actions"><button type="button" id="skill-reveal-root">${escape("访达")}</button><button type="button" id="skill-import">导入文件夹</button><button type="button" class="primary" id="skill-new">＋ 新建</button></div></div><p class="muted">技能存放于仓库 <code>${escape(state.root)}</code>；运行时以软链接挂到 Agent 工作区同名路径。下方按文件夹分组平铺全部技能。</p><label class="skill-default-account">默认启用账号<select id="skill-account">${accountOpts}</select></label><div class="skill-tree">${treeHtml}</div><p id="skill-page-error" role="status"></p>`;
    root.querySelector("#skill-account").onchange = async (e) => {
      onRefresh(e.target.value);
    };
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
    root.querySelectorAll("[data-default]").forEach((input) => {
      input.onchange = async () => {
        try {
          const ids = [
            ...root.querySelectorAll("[data-default]:checked"),
          ].map((el) => el.getAttribute("data-default"));
          state = await api("skills-configure", {
            account: state.account,
            revision: state.revision,
            ids,
          });
          draw();
        } catch (e) {
          err(e.message);
          input.checked = !input.checked;
        }
      };
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
    const ids = session.skillIds ?? data.accounts[data.account] ?? [];
    session.skillIds = [...ids];
    const draw = () => {
      const selected = session.skillIds || [];
      const byGroup = data.tree?.length
        ? data.tree
        : [{ group: "", label: "技能", skills: data.items || [] }];
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
        "<p>还没有技能，请在设置 → 技能中配置。</p>"
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
