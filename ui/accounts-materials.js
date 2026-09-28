// @extracted from renderer.js 5443-6122 — 后续改为 export 函数后由 renderer import
async function pickGroupBackupPath(name) {
  if (isWeb()) return toast("选择备份路径仅支持桌面端");
  if (!name) return toast("分组无效");
  try {
    const folder = await api("pick-backup-folder", {
      defaultPath: state.groups?.[name]?.backupPath || "",
    });
    if (!folder) return;
    applyAccountState(
      await api("group-set-backup-path", { name, path: folder }),
    );
    toast("分组默认同步路径已保存");
  } catch (e) {
    toast(e.message || "设置失败");
  }
}

/**
 * 已注册的分组名称（按中文排序）。
 * @returns {string[]}
 */
function groupNames() {
  return Object.keys(state.groups || {}).sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}

/**
 * 按分组名稳定映射到色板序号。
 * @param {string} name
 */
function groupChipTone(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

/**
 * 分组圆角标签 HTML。
 * @param {string} name
 */
function groupChipHtml(name) {
  return `<span class="group-chip group-chip-${groupChipTone(name)}">${esc(name)}</span>`;
}

/**
 * 读取已发布文章的分组标签。
 * @param {string} rel
 * @returns {string|null}
 */
function publishedGroup(rel) {
  const row = (state.metrics || []).find((r) => r.path === rel);
  const fromMetrics =
    typeof row?.["分组"] === "string" && row["分组"].trim()
      ? row["分组"].trim()
      : null;
  if (fromMetrics) return fromMetrics;
  const arch = (state.archives || []).find((a) => a.path === rel);
  return arch?.group || null;
}

/**
 * 按分组解析本地同步默认路径；无分组路径时回退到账号路径。
 * @param {string|null|undefined} group
 * @param {string} accountId
 */
function backupPathFor(group, accountId) {
  const g = typeof group === "string" ? group.trim() : "";
  if (g && state.groups?.[g]?.backupPath) return state.groups[g].backupPath;
  return state.backupPaths?.[accountId] || "";
}

/**
 * 分组下拉选项 HTML。
 * @param {string|null|undefined} selected
 * @param {{ allowEmpty?: boolean, emptyLabel?: string }} [opts]
 */
function groupOptionsHtml(selected, opts = {}) {
  const allowEmpty = opts.allowEmpty !== false;
  const emptyLabel = opts.emptyLabel || "无分组";
  const cur = typeof selected === "string" ? selected.trim() : "";
  const names = new Set(groupNames());
  if (cur) names.add(cur);
  return `${allowEmpty ? `<option value="">${esc(emptyLabel)}</option>` : ""}${[
    ...names,
  ]
    .sort((a, b) => a.localeCompare(b, "zh"))
    .map(
      (n) =>
        `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)}</option>`,
    )
    .join("")}`;
}

/**
 * 为账号选择并保存本地备份默认目录。
 * @param {string} accountId
 */
async function pickAccountBackupPath(accountId) {
  if (isWeb()) return toast("选择备份路径仅支持桌面端");
  if (!accountId) return toast("账号无效");
  try {
    const folder = await api("pick-backup-folder", {
      defaultPath: state.backupPaths?.[accountId] || "",
    });
    if (!folder) return;
    applyAccountState(
      await api("account-set-backup-path", { id: accountId, path: folder }),
    );
    toast("默认备份路径已保存");
  } catch (e) {
    toast(e.message || "设置失败");
  }
}

/**
 * Uint8Array 转 Base64（分块，避免大图撑爆调用栈）。
 * @param {Uint8Array} buf
 */
function uint8ToBase64(buf) {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) {
    s += String.fromCharCode(...buf.subarray(i, i + step));
  }
  return btoa(s);
}

/**
 * 网页端弹出图片文件选择。
 * @returns {Promise<File|null>}
 */
function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp";
    input.style.cssText =
      "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0;";
    document.body.append(input);
    let settled = false;
    /** @param {File|null} f */
    const done = (f) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => done(input.files?.[0] || null));
    input.addEventListener("cancel", () => done(null));
    input.click();
  });
}

/**
 * 选择图片并设为账号头像。
 * @param {string} accountId
 */
async function pickAndSetAccountAvatar(accountId) {
  if (!accountId) return toast("账号无效");
  try {
    let result;
    if (!isWeb()) {
      result = await api("pick-account-avatar", { id: accountId });
      if (!result) return;
    } else {
      const file = await pickImageFile();
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      result = await api("account-set-avatar", {
        id: accountId,
        bytesBase64: uint8ToBase64(buf),
        type: file.type || "image/png",
      });
    }
    applyAccountState(result);
    toast("头像已更新");
  } catch (e) {
    toast(e.message || "头像更新失败");
  }
}

/**
 * 文本输入对话框（替代 prompt，网页端更可靠）。
 * @param {string} title
 * @param {string} hint
 * @param {string} [value]
 * @returns {Promise<string|null>}
 */
function askText(title, hint, value = "") {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>${esc(title)}</h2><p>${esc(hint)}</p><input id="ask-text-input" value="${esc(value)}" autocomplete="off"><div class="row"><button type="button" id="ask-text-cancel">取消</button><button type="button" class="primary" id="ask-text-ok">确定</button></div></div>`;
    document.body.append(m);
    const input = $("#ask-text-input");
    input?.focus();
    input?.select();
    const done = (v) => {
      m.remove();
      resolve(v);
    };
    $("#ask-text-cancel").onclick = () => done(null);
    $("#ask-text-ok").onclick = () => done(input.value);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") done(null);
    });
  });
}

/**
 * 确认对话框（替代 confirm，网页端更可靠）。
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function askConfirm(title, message) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="row"><button type="button" id="ask-confirm-cancel">取消</button><button type="button" class="primary" id="ask-confirm-ok">确定</button></div></div>`;
    document.body.append(m);
    $("#ask-confirm-cancel").onclick = () => {
      m.remove();
      resolve(false);
    };
    $("#ask-confirm-ok").onclick = () => {
      m.remove();
      resolve(true);
    };
  });
}

/**
 * 选择仓库内文件夹并注册为账号（桌面弹系统对话框，网页列出可选目录）。
 */
async function pickAndRegisterAccountFolder() {
  try {
    let result = null;
    if (!isWeb()) {
      result = await api("pick-account-folder");
    } else {
      const folder = await pickAccountFolderOnWeb();
      if (!folder) return;
      result = await api("account-register", { folder });
    }
    if (!result) return;
    applyAccountState(result);
    toast("已添加账号");
  } catch (e) {
    toast(e.message || "添加失败");
  }
}

/**
 * 网页端：列出内容仓库一级目录供选择注册。
 * @returns {Promise<string|null>}
 */
async function pickAccountFolderOnWeb() {
  const folders = await api("account-folder-candidates");
  if (!folders?.length) {
    toast("仓库内暂无未注册的文件夹，请先新建账号");
    return null;
  }
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>选择账号文件夹</h2><p>以下为当前内容仓库内尚未注册的一级目录。</p><div class="folder-pick-list">${folders
      .map(
        (f) =>
          `<button type="button" class="folder-pick-item" data-folder="${esc(f.name)}"><strong>${esc(f.label)}</strong><small>${esc(f.name)}</small></button>`,
      )
      .join(
        "",
      )}</div><div class="row"><button type="button" id="cancel-folder-pick">取消</button></div></div>`;
    document.body.append(m);
    $("#cancel-folder-pick").onclick = () => {
      m.remove();
      resolve(null);
    };
    $$(".folder-pick-item").forEach(
      (b) =>
        (b.onclick = () => {
          const name = b.dataset.folder;
          m.remove();
          resolve(name);
        }),
    );
  });
}

/**
 * 应用含账号列表的状态快照并重绘。
 * @param {object} result
 */
function applyAccountState(result) {
  const id = current?.id;
  Object.assign(state, result);
  ensureAccount();
  current =
    state.documents.find((d) => d.id === id) ||
    state.documents.find((d) => sameAccount(d.account, account)) ||
    null;
  dirty = false;
  pending = null;
  render();
}
async function refreshVault() {
  if (busy) return toast("AI 正在回复，请结束后刷新");
  sync();
  const apply = (result) => {
    applyAccountState(result);
    toast(
      state.warnings?.length
        ? "部分文件未读取，请在存储设置查看错误"
        : "已刷新内容仓库",
    );
  };
  if (!(await persist())) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML =
      '<div class="dialog"><h2>本次保存未完成</h2><p>可以保留当前未保存内容到本地恢复文件，再读取磁盘版本。恢复文件位于 _system/inkdesk/recovery。</p><button id="cancel-reload">继续编辑</button><button id="recover-reload" class="primary">备份未保存内容并刷新</button></div>';
    document.body.append(m);
    $("#cancel-reload").onclick = () => m.remove();
    $("#recover-reload").onclick = async () => {
      try {
        const result = await api("recover-refresh", state);
        m.remove();
        apply(result);
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  try {
    apply(await api("refresh"));
  } catch (e) {
    toast(e.message);
  }
}
function showMaterial(rel, body) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="dialog"><div class="row"><h2>${esc(rel.split("/").pop())}</h2><button id="close-material" class="icon-btn" title="关闭" aria-label="关闭">${I.close()}</button></div><div class="material-preview">${safeHTML(body)}</div>${current ? '<p class="notice">选中素材文字后，可将选段插入当前草稿。未选中文字时仅插入素材链接。</p><button id="insert-material" class="primary">插入到草稿末尾</button>' : ""}</div>`;
  document.body.append(m);
  $("#close-material").onclick = () => m.remove();
  if ($("#insert-material"))
    $("#insert-material").onclick = async () => {
      const selection = window.getSelection();
      const selected =
        selection && $(".material-preview").contains(selection.anchorNode)
          ? selection.toString()
          : "";
      current.body +=
        "\n\n" +
        (selected ? "> " + selected.split("\n").join("\n> ") + "\n\n" : "") +
        "[[" +
        rel.replace(/\.md$/, "") +
        "]]";
      current.materials ||= [];
      if (!current.materials.includes(rel)) current.materials.push(rel);
      dirty = true;
      await persist();
      m.remove();
      page = "write";
      render();
    };
}
function putTag(reference, doc = current, session = conversation(doc)) {
  if (current?.id !== doc.id || conversation(doc).id !== session.id) {
    session.composerRefs ||= {};
    const refId = crypto.randomUUID();
    session.composerRefs[refId] = { ...reference, refId };
    session.composerDraft ||= { type: "doc", content: [{ type: "paragraph" }] };
    const content = session.composerDraft.content;
    content[content.length - 1].content ||= [];
    content[content.length - 1].content.push(
      {
        type: "referenceTag",
        attrs: {
          refId,
          label: reference.label,
          kind: reference.kind || "file",
        },
      },
      { type: "text", text: " " },
    );
    dirty = true;
    persist();
    return;
  }
  if (page !== "write") {
    page = "write";
    tab = "chat";
    render();
  } else if (!composer) {
    tab = "chat";
    renderPanel();
  }
  composer.insert(reference);
  dirty = true;
  persist();
}
function tagSelection() {
  sync();
  const c =
    selectionContext?.doc === current.id &&
    selectionContext.version === editor.getHTML()
      ? selectionContext
      : null;
  if (!c || c.from === c.to) return toast("请先选中正文中的一段文字");
  putTag({
    kind: "selection",
    articleId: current.id,
    base: current.body,
    from: c.from,
    to: c.to,
    text: c.text,
    label: "正文选段 · " + c.text.length + "字",
  });
}
async function uploadChatFiles() {
  const doc = current,
    c = conversation(doc),
    button = $("#chat-upload");
  let insertionPosition = c.composerPosition;
  button.disabled = true;
  try {
    sync();
    if (!(await persist())) return;
    const before = await api("project-refs", doc.id),
      known = new Set(before.map((r) => r.id));
    const list = await uploadProjectFiles(doc.id);
    if (!list) return;
    const added = list.filter((r) => !known.has(r.id));
    for (const r of added.filter((r) => r.status === "ready")) {
      c.composerPosition = insertionPosition;
      putTag({ kind: "file", fileId: r.id, label: r.name }, doc, c);
      insertionPosition = c.composerPosition;
    }
    if (added.some((r) => r.status !== "ready"))
      toast("部分文件未能提取文字，请在项目素材中查看原因");
  } catch (e) {
    toast(e.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
async function chooseChatFile() {
  const doc = current,
    c = conversation(doc);
  const insertionPosition = c.composerPosition;
  try {
    const [bound, all] = await Promise.all([
      api("project-refs", doc.id),
      api("materials-list", { account: doc.account || account }),
    ]);
    const boundIds = new Set(bound.map((r) => r.id));
    const merged = [
      ...bound,
      ...all.filter((r) => !boundIds.has(r.id)),
    ];
    const refs = await Promise.all(merged.map(hydrateMaterialPreview));
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog ref-picker-dialog"><div class="row ref-picker-head"><h2>引用素材</h2><button id="close-picker">关闭</button></div><input id="reference-search" placeholder="搜索素材库"><div id="reference-options"></div></div>`;
    document.body.append(m);
    $("#close-picker").onclick = () => m.remove();
    const pick = async (id) => {
      const r = refs.find((x) => x.id === id);
      if (!r) return;
      if (r.status !== "ready") return toast(r.error || "素材未就绪");
      m.remove();
      try {
        if (!boundIds.has(r.id)) {
          await api("materials-link", {
            articleId: doc.id,
            id: r.id,
          });
        }
        c.composerPosition = insertionPosition;
        putTag({ kind: "file", fileId: r.id, label: r.name }, doc, c);
      } catch (err) {
        toast(err.message);
      }
    };
    const list = () => {
      const q = $("#reference-search").value.toLowerCase();
      const match = (r) => r.name.toLowerCase().includes(q);
      const boundRows = refs.filter((r) => boundIds.has(r.id) && match(r));
      const otherRows = refs.filter((r) => !boundIds.has(r.id) && match(r));
      const section = (title, rows) =>
        `<div class="picker-section"><h3>${title}</h3><div class="material-cards">${rows.map((r) => materialPreviewCardHTML(r)).join("")}</div></div>`;
      const sections = [];
      if (boundRows.length) sections.push(section("本文素材", boundRows));
      if (otherRows.length) sections.push(section("素材库", otherRows));
      $("#reference-options").innerHTML =
        sections.join("") ||
        "<p>暂无素材，可先本地选择上传，或到素材库创建。</p>";
      $$("#reference-options [data-ref-preview]").forEach(
        (b) =>
          (b.onclick = (e) => {
            e.preventDefault();
            pick(b.dataset.refPreview);
          }),
      );
    };
    $("#reference-search").oninput = list;
    list();
    $("#reference-search").focus();
  } catch (e) {
    toast(e.message);
  }
}
function openPreview({
  title,
  text,
  path: rel,
  reference,
  material,
  doc = current,
}) {
  $("#reference-drawer")?.remove();
  $("#published-drawer")?.remove();
  $("#topic-drawer")?.remove();
  const r = material ||
    reference || {
      name: title,
      text,
      path: rel,
      kind: rel && /\.(png|jpe?g|gif|webp)$/i.test(rel) ? "image" : "text",
    };
  const n = document.createElement("aside");
  n.id = "reference-drawer";
  n.className = "reference-drawer";
  const kind = r.kind || inferMaterialKind(r.name);
  const headActions = reference
    ? `<button type="button" id="cite-file" class="ghost">引用文件</button>`
    : "";
  n.innerHTML = `<div class="row reference-drawer-head"><h3>${esc(title)}</h3><div class="reference-drawer-toolbar">${headActions}<button type="button" id="close-drawer" class="ghost icon-btn" title="关闭" aria-label="关闭">${I.close({ size: 18 })}</button></div></div><div class="reference-drawer-body">${materialDrawerBodyHTML({ ...r, kind, text: text || r.text, path: rel || r.path })}</div>`;
  document.body.append(n);
  $("#close-drawer").onclick = () => n.remove();
  if (reference) {
    $("#cite-file").onclick = () => {
      putTag(
        { kind: "file", fileId: reference.id, label: reference.name },
        doc,
      );
      n.remove();
    };
  }
}
async function renderMaterials() {
  const drafts = state.documents.filter((d) => sameAccount(d.account, account));
  if (
    materialsFilter !== "all" &&
    !drafts.some((d) => d.id === materialsFilter)
  )
    materialsFilter = "all";
  const uploadTarget =
    materialsFilter !== "all"
      ? drafts.find((d) => d.id === materialsFilter)
      : sameAccount(current?.account, account)
        ? current
        : drafts[0];
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">素材库</h1></div><div class="header-actions"><select id="material-filter" aria-label="按文章筛选素材"><option value="all">全部素材</option>${drafts.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join("")}</select><button id="upload-reference" class="primary" ${uploadTarget ? "" : "disabled"}>${I.upload()} 上传文件</button></div></header><section class="dashboard"><div id="project-files" class="material-cards"></div></section>`;
  $("#material-filter").value = materialsFilter;
  $("#material-filter").onchange = (e) => {
    materialsFilter = e.target.value;
    $("#reference-drawer")?.remove();
    $("#published-drawer")?.remove();
    if (materialsFilter !== "all")
      current =
        state.documents.find((d) => d.id === materialsFilter) || current;
    renderMaterials();
  };

  /** 渲染素材卡片列表 */
  const draw = async (list) => {
    if (page !== "materials") return;
    const filtered =
      materialsFilter === "all"
        ? list
        : list.filter((m) =>
            (m.usedBy || []).some((u) => u.id === materialsFilter),
          );
    const rows = await Promise.all(filtered.map(hydrateMaterialPreview));
    $("#project-files").innerHTML =
      rows
        .map((r) => materialPreviewCardHTML(r, { showRefCount: true }))
        .join("") ||
      '<div class="empty-state"><img src="assets/empty-materials.png" alt="" class="empty-state-img" /><p class="empty-state-text">空空如也</p></div>';
    $$("#project-files [data-ref-preview]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const r = await api("materials-read", b.dataset.refPreview);
            openPreview({
              title: r.name,
              text: r.text || r.error,
              path: r.path,
              reference: r.status === "ready" ? r : null,
              material: r,
              doc: uploadTarget || current,
            });
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    $$("[data-material]").forEach((card) => {
      card.oncontextmenu = (e) => {
        e.preventDefault();
        const id = card.dataset.material;
        const items = [
          {
            label: "删除素材",
            danger: true,
            run: async () => {
              if (!confirm("确定删除此素材？将从所有文章解除引用。")) return;
              try {
                draw(await api("materials-delete", id));
                toast("素材已删除");
              } catch (err) {
                toast(err.message);
              }
            },
          },
        ];
        if (materialsFilter !== "all" && uploadTarget) {
          items.unshift({
            label: "关联到当前筛选文章",
            run: async () => {
              try {
                await api("materials-link", {
                  articleId: uploadTarget.id,
                  id,
                });
                draw(await api("materials-list", { account }));
                toast("已关联");
              } catch (err) {
                toast(err.message);
              }
            },
          });
        }
        showContextMenu(e.clientX, e.clientY, items);
      };
    });
  };

  $("#upload-reference").onclick = async () => {
    if (!uploadTarget) return toast("请先创建一篇草稿再上传");
    const b = $("#upload-reference");
    b.disabled = true;
    b.textContent = "上传中…";
    try {
      if (!(await persist())) return;
      const list = await uploadProjectFiles(uploadTarget.id);
      if (list) draw(await api("materials-list", { account }));
    } catch (e) {
      toast(e.message);
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.innerHTML = `${I.upload()} 上传文件`;
      }
    }
  };
  try {
    draw(await api("materials-list", { account }));
  } catch (e) {
    toast(e.message);
  }
}