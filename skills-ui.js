const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function manageSkills(api, account, onDone = () => {}) {
  const modal = document.createElement("dialog");
  modal.className = "skill-dialog";
  document.body.append(modal);
  let state,
    active = null,
    scope = "global",
    modified = false;
  const close = () => {
    if (modified && !confirm("放弃未保存的技能修改？")) return;
    modal.close();
    modal.remove();
    onDone();
  };
  modal.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  async function load() {
    state = await api("skills-list", { account });
    draw();
  }
  function draw() {
    modal.innerHTML = `<div class="skill-header"><div><h2>技能工作室</h2><p>通用技能跨账号复用，账号技能仅供当前账号使用。</p></div><button id="skill-close" aria-label="关闭技能工作室">关闭</button></div><div class="skill-scopes"><button data-scope="global" class="${scope === "global" ? "primary" : ""}">通用技能</button><button data-scope="account" class="${scope === "account" ? "primary" : ""}">账号技能</button><button id="skill-new">＋ 新建技能</button></div><div class="skill-workspace"><div class="skill-list">${
      state.items
        .filter((x) => x.scope === scope)
        .map(
          (x) =>
            `<button data-skill="${x.id}" class="${active?.id === x.id ? "selected" : ""}"><strong>${escape(x.name)}</strong><small>${x.includes.length ? "组合技能" : "指令技能"}${(state.accounts[state.account] || []).includes(x.id) ? " · 默认启用" : ""}</small></button>`,
        )
        .join("") ||
      '<p class="muted">还没有技能。创建一条指令，或组合已有技能。</p>'
    }</div><div class="skill-editor">${
      active
        ? `<label>技能名称<input id="skill-name" maxlength="80" value="${escape(active.name)}"></label><label>执行指令<textarea id="skill-prompt" rows="9" placeholder="描述任务、方法和输出要求…">${escape(active.prompt)}</textarea></label><label>组合步骤 <small>按顺序执行，最后执行上方指令</small></label><div id="skill-steps"></div><div class="row"><select id="skill-add-choice"><option value="">选择一个技能</option>${state.items
            .filter(
              (x) =>
                x.id !== active.id &&
                (active.scope === "account" || x.scope === "global"),
            )
            .map((x) => `<option value="${x.id}">${escape(x.name)}</option>`)
            .join(
              "",
            )}</select><button id="skill-add">添加步骤</button></div><label class="skill-check"><input type="checkbox" id="skill-enabled" ${(state.accounts[state.account] || []).includes(active.id) ? "checked" : ""}> 当前账号默认启用</label><div class="skill-actions"><button id="skill-save" class="primary">保存技能</button>${active.id ? '<button id="skill-delete" class="danger">删除</button>' : ""}</div>`
        : '<div class="skill-empty">选择或新建技能<br><small>技能是可编辑的指令，可自由组合。账号人设继续作为写作背景。</small></div>'
    }</div></div><p id="skill-error" role="status"></p>`;
    modal.querySelector("#skill-close").onclick = close;
    const switchTo = (fn) => {
      if (modified && !confirm("放弃未保存的技能修改？")) return;
      modified = false;
      fn();
      draw();
    };
    modal.querySelectorAll("[data-scope]").forEach(
      (b) =>
        (b.onclick = () =>
          switchTo(() => {
            scope = b.dataset.scope;
            active = null;
          })),
    );
    modal.querySelectorAll("[data-skill]").forEach(
      (b) =>
        (b.onclick = () =>
          switchTo(() => {
            active = structuredClone(
              state.items.find((x) => x.id === b.dataset.skill),
            );
          })),
    );
    modal.querySelector("#skill-new").onclick = () =>
      switchTo(() => {
        active = { scope, name: "", prompt: "", includes: [] };
      });
    if (!active) return;
    const q = (s) => modal.querySelector(s);
    q("#skill-name").oninput = (e) => {
      active.name = e.target.value;
      modified = true;
    };
    q("#skill-prompt").oninput = (e) => {
      active.prompt = e.target.value;
      modified = true;
    };
    q("#skill-enabled").onchange = () => (modified = true);
    const steps = () => {
      q("#skill-steps").innerHTML = active.includes
        .map(
          (id, i) =>
            `<div class="skill-step"><span>${i + 1}. ${escape(state.items.find((x) => x.id === id)?.name || "已失效")}</span><button data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="上移步骤">↑</button><button data-remove="${i}" aria-label="移除步骤">×</button></div>`,
        )
        .join("");
      q("#skill-steps")
        .querySelectorAll("[data-remove]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              active.includes.splice(+b.dataset.remove, 1);
              modified = true;
              steps();
            }),
        );
      q("#skill-steps")
        .querySelectorAll("[data-up]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              const i = +b.dataset.up;
              [active.includes[i - 1], active.includes[i]] = [
                active.includes[i],
                active.includes[i - 1],
              ];
              modified = true;
              steps();
            }),
        );
    };
    steps();
    q("#skill-add").onclick = () => {
      const id = q("#skill-add-choice").value;
      if (id && !active.includes.includes(id)) {
        active.includes.push(id);
        modified = true;
        steps();
      }
    };
    q("#skill-save").onclick = async () => {
      const b = q("#skill-save");
      b.disabled = true;
      try {
        const enabled = q("#skill-enabled").checked;
        const ids = new Set(state.items.map((x) => x.id));
        state = await api("skills-save", {
          account,
          revision: state.revision,
          skill: active,
        });
        active = state.items.find((x) =>
          active.id ? x.id === active.id : !ids.has(x.id),
        );
        const defaults = (state.accounts[state.account] || []).filter(
          (id) => id !== active.id,
        );
        if (enabled) defaults.push(active.id);
        state = await api("skills-configure", {
          account,
          revision: state.revision,
          ids: defaults,
        });
        modified = false;
        draw();
      } catch (e) {
        q("#skill-error").textContent = e.message;
        b.disabled = false;
      }
    };
    if (q("#skill-delete"))
      q("#skill-delete").onclick = async () => {
        if (!confirm("删除此技能？通用技能删除后将对所有账号生效。")) return;
        try {
          state = await api("skills-remove", {
            account,
            revision: state.revision,
            id: active.id,
          });
          active = null;
          modified = false;
          draw();
        } catch (e) {
          q("#skill-error").textContent = e.message;
        }
      };
  }
  modal.showModal();
  try {
    await load();
  } catch (e) {
    modal.textContent = e.message;
    const b = document.createElement("button");
    b.textContent = "关闭";
    b.onclick = close;
    modal.append(b);
  }
}
export async function mountSkillPicker(root, api, account, session) {
  let data;
  try {
    data = await api("skills-list", { account });
    if (!root.isConnected) return;
    const ids = session.skillIds ?? data.accounts[data.account] ?? [];
    session.skillIds = [...ids];
    const draw = () => {
      const selected=session.skillIds||[];
      root.innerHTML = `<details class="chat-skill-menu"><summary title="选择本次技能">技能${selected.length ? ` · ${selected.length}` : ""}</summary><div class="chat-skill-options"><strong>本次使用</strong>${data.items.map(x=>`<label class="skill-check"><input type="checkbox" value="${x.id}" ${selected.includes(x.id)?"checked":""}>${escape(x.name)}<small>${x.scope==="global"?"通用":"账号"}</small></label>`).join("")||"<p>还没有技能，请在设置 → 技能中配置。</p>"}</div></details>`;
      root.querySelectorAll('input').forEach(x=>x.onchange=()=>{
        session.skillIds=[...root.querySelectorAll('input:checked')].map(x=>x.value);
        root.querySelector('summary').textContent=`技能${session.skillIds.length?' · '+session.skillIds.length:''}`;
        root.dispatchEvent(new CustomEvent('skills-change',{bubbles:true}));
      });
      root.querySelector('details').addEventListener('keydown',e=>{if(e.key==='Escape'){e.currentTarget.open=false;root.querySelector('summary').focus();}});
    };
    draw();
  } catch (e) {
    if (root.isConnected) root.textContent = e.message;
  }
}
