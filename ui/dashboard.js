// @extracted from renderer.js 3738-4466 — 后续改为 export 函数后由 renderer import
function formatDelta(n) {
  if (n == null || n === 0 || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  return (v > 0 ? "+" : "") + v.toLocaleString();
}

/** 从 xlsx 导入笔记数据并更新归档 YAML */
async function runNoteImport() {
  try {
    const filePayload = await pickNoteTable();
    if (!filePayload) return;
    const followers = await askFollowers(state.followers?.[account]);
    if (followers === null) return toast("粉丝量无效或已取消");
    const preview = await api("import-notes-preview", {
      account,
      ...filePayload,
    });
    let pairs = preview.matched.map((m) => ({
      index: m.index,
      path: m.path,
    }));
    if (preview.unmatched.length) {
      const manual = await showUnmatchedMatcher(preview);
      if (manual === null) return toast("已取消导入");
      pairs = pairs.concat(manual);
    }
    if (!pairs.length) return toast("没有可更新的匹配项");
    const result = await api("import-notes-apply", {
      account,
      followers,
      rows: preview.rows,
      pairs,
    });
    Object.assign(state, result);
    dirty = false;
    page = "dashboard";
    render();
    toast(`已更新 ${result.updated?.length ?? pairs.length} 篇归档与 YAML`);
  } catch (e) {
    toast(e.message);
  }
}

function renderDashboard() {
  const rows = state.metrics.filter((r) => sameAccount(r["账号"], account));
  const deltas = state.metricDeltas?.[account] || null;
  const sum = (k) =>
    rows.some((r) => r[k] !== null)
      ? rows.reduce((s, r) => s + (r[k] || 0), 0).toLocaleString()
      : "—";
  /** 卡片数值旁的增减标记 */
  const deltaMark = (key) => {
    const text = formatDelta(deltas?.[key]);
    if (!text) return "";
    const cls = Number(deltas[key]) > 0 ? "up" : "down";
    return `<em class="delta ${cls}">${text}</em>`;
  };
  /** 表格单元格增减 */
  const cellDelta = (path, key) => {
    const text = formatDelta(deltas?.articles?.[path]?.[key]);
    if (!text) return "";
    const cls = Number(deltas.articles[path][key]) > 0 ? "up" : "down";
    return ` <em class="delta ${cls}">${text}</em>`;
  };
  const sortKeys = [
    ["阅读", "按阅读量"],
    ["收藏", "按收藏"],
    ["点赞", "按点赞"],
    ["涨粉", "按涨粉"],
    ["日期", "按日期"],
  ];
  /** 按当前排序字段排列归档文章 */
  const sorted = [...rows].sort((a, b) => {
    if (metricsSort === "日期")
      return String(b["日期"] || "").localeCompare(String(a["日期"] || ""));
    return (b[metricsSort] || 0) - (a[metricsSort] || 0);
  });
  const validPaths = new Set(sorted.map((r) => r.path));
  publishedSelection = new Set(
    [...publishedSelection].filter((p) => validPaths.has(p)),
  );
  const selectedCount = publishedSelection.size;
  const allSelected = sorted.length > 0 && selectedCount === sorted.length;
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">让每一次表达，都有回响。</h1></div><div class="header-actions"><button type="button" id="refresh-dashboard" class="ghost icon-btn" title="从磁盘同步本地数据" aria-label="刷新">${I.refresh({ size: 18 })}</button><button id="import-notes" class="primary">更新数据</button></div></header><section class="dashboard"><div class="stats">${[
      ["粉丝量", "粉丝量"],
      ["阅读", "总阅读"],
      ["点赞", "总点赞"],
      ["收藏", "总收藏"],
      ["评论", "总评论"],
      ["涨粉", "文章涨粉合计"],
      ["文章", "总文章数量"],
    ]
      .map(
        ([k, l]) =>
          `<div><small>${l}</small><strong title="${k === "涨粉" ? "汇总文章 YAML 的涨粉字段，不是账号净增粉丝，也不是工作台估算" : k === "粉丝量" ? "导入数据时填写的当前粉丝量" : ""}">${k === "文章" ? rows.length.toLocaleString() : k === "粉丝量" ? (state.followers?.[account] != null ? Number(state.followers[account]).toLocaleString() : "—") : sum(k)}${deltaMark(k)}</strong></div>`,
      )
      .join(
        "",
      )}</div><div id="publishing-calendar" class="dashboard-card"></div><div class="dashboard-card"><div class="row performance-head"><h3>已发布</h3><div id="published-bulk" class="published-bulk" ${selectedCount ? "" : "hidden"}><span class="published-bulk-count">已选 ${selectedCount}</span><button type="button" id="bulk-group">${I.tags()} 设置分组</button><button type="button" id="bulk-backup">${I.folder()} 本地同步</button><button type="button" id="bulk-to-draft">移回草稿</button><button type="button" class="ghost" id="bulk-clear">取消选择</button></div><select id="metrics-sort" aria-label="文章排序方式">${sortKeys.map(([k, l]) => `<option value="${k}" ${metricsSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>${
      rows.length
        ? `<table class="published-table"><thead><tr><th class="published-check"><input type="checkbox" id="published-select-all" aria-label="全选" ${allSelected ? "checked" : ""} ${selectedCount && !allSelected ? 'data-indeterminate="1"' : ""}></th><th>文章</th><th>分组</th><th>日期</th><th>阅读</th><th>点赞</th><th>收藏</th><th>涨粉</th></tr></thead><tbody>${sorted
            .map((r) => {
              const on = publishedSelection.has(r.path);
              const g =
                typeof r["分组"] === "string" && r["分组"].trim()
                  ? r["分组"].trim()
                  : "";
              return `<tr class="${on ? "is-selected" : ""}"><td class="published-check"><input type="checkbox" data-select-published="${esc(r.path)}" aria-label="选择 ${esc(r["标题"])}" ${on ? "checked" : ""}></td><td><button type="button" class="title-preview" data-published="${esc(r.path)}">${esc(r["标题"])}</button></td><td class="published-group">${g ? groupChipHtml(g) : "—"}</td><td>${esc(r["日期"])}</td><td>${r["阅读"] ?? "—"}${cellDelta(r.path, "阅读")}</td><td>${r["点赞"] ?? "—"}${cellDelta(r.path, "点赞")}</td><td>${r["收藏"] ?? "—"}${cellDelta(r.path, "收藏")}</td><td>${r["涨粉"] ?? "—"}${cellDelta(r.path, "涨粉")}</td></tr>`;
            })
            .join("")}</tbody></table>`
        : '<div class="empty-data">还没有数据。<p>文章归档后，在 YAML 中填写平台数据即可查看。</p></div>'
    }</div></section>`;
  renderCalendar(rows);
  $("#metrics-sort").onchange = (e) => {
    metricsSort = e.target.value;
    renderDashboard();
  };
  $("#refresh-dashboard").onclick = () => refreshDashboardData();
  $("#import-notes").onclick = () => runNoteImport();
  const selectAll = $("#published-select-all");
  if (selectAll?.dataset.indeterminate) selectAll.indeterminate = true;
  selectAll?.addEventListener("change", () => {
    if (selectAll.checked)
      sorted.forEach((r) => publishedSelection.add(r.path));
    else publishedSelection.clear();
    renderDashboard();
  });
  $$("[data-select-published]").forEach((box) => {
    box.onchange = () => {
      const rel = box.dataset.selectPublished;
      if (box.checked) publishedSelection.add(rel);
      else publishedSelection.delete(rel);
      renderDashboard();
    };
  });
  $("#bulk-clear")?.addEventListener("click", () => {
    publishedSelection.clear();
    renderDashboard();
  });
  $("#bulk-group")?.addEventListener("click", () =>
    setPublishedGroups([...publishedSelection]),
  );
  $("#bulk-backup")?.addEventListener("click", () =>
    backupPublishedArticle([...publishedSelection]),
  );
  $("#bulk-to-draft")?.addEventListener("click", () =>
    movePublishedToDraft([...publishedSelection]),
  );
  $$("[data-published]").forEach((b) => {
    b.onclick = () => openPublishedPreview(b.dataset.published);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const rel = b.dataset.published;
      showContextMenu(e.clientX, e.clientY, [
        { label: "预览", run: () => openPublishedPreview(rel) },
        { label: "设置分组", run: () => setPublishedGroups([rel]) },
        { label: "本地同步", run: () => backupPublishedArticle(rel) },
        { label: "移回草稿", run: () => movePublishedToDraft(rel) },
      ]);
    };
  });
}

/**
 * 为已发布文章设置分组（单篇或批量）。
 * @param {string|string[]} paths
 */
async function setPublishedGroups(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  const currentGroups = [
    ...new Set(list.map((rel) => publishedGroup(rel) || "")),
  ];
  const selected = currentGroups.length === 1 ? currentGroups[0] || "" : "";
  $("#group-set-modal")?.remove();
  const m = document.createElement("div");
  m.id = "group-set-modal";
  m.className = "modal";
  m.innerHTML = `<div class="dialog"><h2>设置分组</h2><label>分组<select id="group-set-select">${groupOptionsHtml(selected)}</select></label><label>或新建分组<input id="group-set-new" placeholder="输入新分组名称" autocomplete="off"></label><div class="row"><button type="button" id="group-set-cancel">取消</button><button type="button" class="primary" id="group-set-ok">保存</button></div></div>`;
  document.body.append(m);
  $("#group-set-cancel").onclick = () => m.remove();
  $("#group-set-ok").onclick = async () => {
    const created = $("#group-set-new")?.value.trim() || "";
    const picked = $("#group-set-select")?.value || "";
    const group = created || picked || null;
    try {
      if (created) {
        applyAccountState(await api("group-upsert", { name: created }));
      }
      applyAccountState(await api("article-set-group", { paths: list, group }));
      m.remove();
      toast(group ? `已设为分组「${group}」` : "已清除分组");
    } catch (e) {
      toast(e.message || "设置失败");
    }
  };
}

/**
 * 打开已发布文章的排版预览（公众号 / 小红书），与草稿预览一致。
 * @param {string} rel vault 相对路径
 */
async function openPublishedPreview(rel) {
  const row = (state.archives || []).find((a) => a.path === rel);
  const title =
    row?.title || rel.split("/").pop().replace(/\.md$/, "") || "文章";
  try {
    const body = row?.body ?? (await api("published-read", rel));
    publishedPreview = { path: rel, title, body: body || "" };
    page = "published-preview";
    previewPane = "wechat";
    render();
  } catch (e) {
    toast(e.message);
  }
}

/**
 * 将已发布文章同步备份到本地目录（支持单篇或多选）。
 * 默认路径优先取文章分组的本地路径，无分组路径时回退账号路径。
 * @param {string|string[]} paths vault 相对路径
 */
async function backupPublishedArticle(paths) {
  if (isWeb()) return toast("本地同步仅支持桌面端");
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  const first = list[0];
  const accountId =
    (state.archives || []).find((a) => a.path === first)?.account ||
    first.split("/")[0] ||
    account;
  const groups = [...new Set(list.map((rel) => publishedGroup(rel) || ""))];
  const singleGroup = groups.length === 1 ? groups[0] || null : null;
  const mixedGroups = groups.length > 1;
  const defaultPath = singleGroup ? backupPathFor(singleGroup, accountId) : "";
  const perPathDefaults = list.map((rel) => ({
    rel,
    group: publishedGroup(rel),
    dest: backupPathFor(publishedGroup(rel), accountId),
  }));
  const allHaveDefault = perPathDefaults.every((x) => x.dest);
  const label =
    list.length === 1
      ? `「${
          publishedPreview?.path === first
            ? publishedPreview.title
            : (state.archives || []).find((a) => a.path === first)?.title ||
              first.split("/").pop().replace(/\.md$/, "") ||
              "文章"
        }」`
      : `选中的 ${list.length} 篇文章`;
  const rememberTarget = singleGroup
    ? `分组「${singleGroup}」`
    : mixedGroups
      ? "（多分组时请分别设置）"
      : "该账号";
  const defaultHint = mixedGroups
    ? allHaveDefault
      ? "各分组已配置默认路径，可按分组分别同步"
      : "选中文章分组不同或未配置路径，请选择统一路径，或先设置分组"
    : defaultPath
      ? defaultPath
      : singleGroup
        ? `分组「${singleGroup}」未设置（可在设置 · 分组中配置）`
        : "未设置（可先为文章指定分组，或在设置 · 账号中配置）";

  /** @param {string} destDir @param {boolean} [remember] */
  const runBackup = async (destDir, remember) => {
    let ok = 0;
    for (const rel of list) {
      await api("published-backup", { rel, destDir });
      ok += 1;
    }
    if (remember && singleGroup && destDir !== defaultPath) {
      applyAccountState(
        await api("group-set-backup-path", {
          name: singleGroup,
          path: destDir,
        }),
      );
    } else if (
      remember &&
      !singleGroup &&
      !mixedGroups &&
      destDir !== defaultPath
    ) {
      applyAccountState(
        await api("account-set-backup-path", {
          id: accountId,
          path: destDir,
        }),
      );
    }
    toast(`已同步 ${ok} 篇到 ${destDir}`);
  };

  /** 按各文章分组默认路径分别同步 */
  const runBackupByGroup = async () => {
    let ok = 0;
    for (const item of perPathDefaults) {
      if (!item.dest) throw Error("部分文章缺少默认同步路径");
      await api("published-backup", { rel: item.rel, destDir: item.dest });
      ok += 1;
    }
    toast(`已按分组同步 ${ok} 篇`);
  };

  $("#backup-sync-modal")?.remove();
  const m = document.createElement("div");
  m.id = "backup-sync-modal";
  m.className = "modal";
  const canRemember = !mixedGroups;
  const showDefaultBtn = mixedGroups ? allHaveDefault : !!defaultPath;
  m.innerHTML = `<div class="dialog"><h2>本地同步</h2><p>将${label}备份为 Markdown 到本机文件夹。</p><p class="muted">默认路径：${esc(defaultHint)}</p>${canRemember ? `<label class="backup-remember"><input type="checkbox" id="backup-remember" ${defaultPath ? "" : "checked"}> 将本次选择的路径设为${esc(rememberTarget)}默认</label>` : ""}<div class="row"><button type="button" id="backup-cancel">取消</button>${showDefaultBtn ? `<button type="button" id="backup-pick">${I.folder()} 选择其他路径</button><button type="button" class="primary" id="backup-default">${mixedGroups ? "按分组同步到默认" : "同步到默认"}</button>` : `<button type="button" class="primary" id="backup-pick">${I.folder()} 选择并同步</button>`}</div></div>`;
  document.body.append(m);
  const remember = () => !!$("#backup-remember")?.checked;
  $("#backup-cancel").onclick = () => m.remove();
  const pickAndSync = async () => {
    try {
      const folder = await api("pick-backup-folder", {
        defaultPath:
          defaultPath || perPathDefaults.find((x) => x.dest)?.dest || "",
      });
      if (!folder) return;
      await runBackup(folder, remember());
      m.remove();
    } catch (e) {
      toast(e.message || "同步失败");
    }
  };
  $("#backup-pick")?.addEventListener("click", pickAndSync);
  $("#backup-default")?.addEventListener("click", async () => {
    try {
      if (mixedGroups) await runBackupByGroup();
      else await runBackup(defaultPath, false);
      m.remove();
    } catch (e) {
      toast(e.message || "同步失败");
    }
  });
}

/**
 * 将已发布文章移回草稿箱（支持单篇或多选）。
 * @param {string|string[]} paths vault 相对路径
 */
async function movePublishedToDraft(paths) {
  if (busy) return toast("请等待 AI 完成后再操作");
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  const titleOf = (rel) =>
    publishedPreview?.path === rel
      ? publishedPreview.title
      : (state.archives || []).find((a) => a.path === rel)?.title ||
        rel.split("/").pop().replace(/\.md$/, "") ||
        "文章";
  const msg =
    list.length === 1
      ? `将「${titleOf(list[0])}」移回草稿箱？可继续编辑后再发布。`
      : `将选中的 ${list.length} 篇文章移回草稿箱？可继续编辑后再发布。`;
  if (!confirm(msg)) return;
  sync();
  try {
    await persist();
    let lastId = null;
    for (const rel of list) {
      const result = await api("to-draft", rel);
      Object.assign(state, result);
      lastId = result.restoredId;
      publishedSelection.delete(rel);
    }
    publishedPreview = null;
    dirty = false;
    pending = null;
    if (list.length === 1) {
      current =
        state.documents.find((d) => d.id === lastId) ||
        state.documents.find((d) => sameAccount(d.account, account));
      page = current ? "write" : "dashboard";
    } else {
      page = "dashboard";
      current =
        state.documents.find((d) => sameAccount(d.account, account)) || current;
    }
    render();
    toast(list.length === 1 ? "已移回草稿" : `已移回 ${list.length} 篇草稿`);
  } catch (e) {
    toast(e.message);
  }
}

/** 仪表盘刷新：重新读取 Content_OS，同步外部改动的 YAML / 归档 */
async function refreshDashboardData() {
  if (busy) return toast("AI 正在回复，请结束后再刷新");
  sync();
  const apply = (result) => {
    const id = current?.id;
    Object.assign(state, result);
    current =
      state.documents.find((d) => d.id === id) ||
      state.documents.find((d) => sameAccount(d.account, account));
    dirty = false;
    pending = null;
    page = "dashboard";
    render();
    toast(
      state.warnings?.length
        ? "已同步，部分文件未读取，请在存储设置查看"
        : "已同步本地数据",
    );
  };
  if (!(await persist())) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML =
      '<div class="dialog"><h2>本次保存未完成</h2><p>可以保留当前未保存内容到本地恢复文件，再读取磁盘版本。</p><button id="cancel-reload">继续编辑</button><button id="recover-reload" class="primary">备份未保存内容并刷新</button></div>';
    document.body.append(m);
    $("#cancel-reload").onclick = () => m.remove();
    $("#recover-reload").onclick = async () => {
      try {
        apply(await api("recover-refresh", state));
        m.remove();
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

async function renderTopics() {
  if (!account) {
    $("#main").innerHTML =
      `<header><div class="header-lead"><h1 class="dashboard-tagline">灵感库</h1></div></header><section class="dashboard"><div class="empty-state"><img src="assets/empty-topics.png" alt="" class="empty-state-img" /><p class="empty-state-text">请先在设置中添加账号</p></div></section>`;
    return;
  }
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">灵感库</h1></div></header><section class="dashboard topic-dashboard"><div class="topic-composer"><textarea id="topic-input" rows="5" placeholder="记下灵感… 支持 Markdown"></textarea><div class="topic-composer-bar"><span class="muted">Markdown · ⌘/Ctrl + Enter 保存</span><button type="button" id="topic-save" class="primary">记下</button></div></div><div class="topic-grid" id="topic-grid"><p class="muted">加载中…</p></div></section>`;

  /** 从灵感写成草稿并进入写作页 */
  const writeFromTopic = async (rel) => {
    const topic = await api("topics-read", { path: rel });
    const firstLine =
      String(topic.body || "")
        .split(/\r?\n/)
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find(Boolean) || "未命名文章";
    const d = {
      id: crypto.randomUUID(),
      title: firstLine.slice(0, 80),
      body: topic.body || "",
      account,
      updated: new Date().toISOString(),
      chat: [],
      titles: [],
      prompts: [],
      topics: [
        {
          text: firstLine.slice(0, 80),
          at: new Date().toISOString(),
        },
      ],
      checks: [],
      snapshots: [],
    };
    state.documents.unshift(d);
    current = d;
    page = "write";
    tab = "topics";
    pending = null;
    persist();
    render();
  };

  /** @param {{ path: string, title?: string, body?: string, preview?: string, updated?: string }[]} list */
  const draw = (list) => {
    if (page !== "topics") return;
    const grid = $("#topic-grid");
    if (!grid) return;
    grid.innerHTML =
      list
        .map((t) => {
          const when = t.updated
            ? new Date(t.updated).toLocaleString("zh-CN")
            : "";
          const md = typeof t.body === "string" ? t.body : "";
          const plain = md
            .replace(/\r\n/g, "\n")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^>\s?/gm, "")
            .replace(/^[-*+]\s+/gm, "• ")
            .trim();
          return `<div class="result-card topic-card" data-topic="${esc(t.path)}"><div class="topic-card-head"><time datetime="${esc(t.updated || "")}">${esc(when)}</time><div class="topic-card-actions"><button type="button" class="ghost icon-btn" data-write-topic="${esc(t.path)}" title="写成文章" aria-label="写成文章">${I.pen({ size: 15 })}</button><button type="button" class="ghost icon-btn danger" data-delete-topic="${esc(t.path)}" title="删除灵感" aria-label="删除灵感">${I.trash({ size: 15 })}</button></div></div><div class="topic-card-body" data-open-topic="${esc(t.path)}" role="button" tabindex="0">${plain ? esc(plain) : '<span class="muted">（空）</span>'}</div></div>`;
        })
        .join("") ||
      '<div class="empty-state topic-empty"><img src="assets/empty-topics.png" alt="" class="empty-state-img" /><p class="empty-state-text">还没有灵感，在上方写一条吧</p></div>';

    const deleteTopic = async (rel) => {
      if (!(await askConfirm("删除灵感", "确定删除这条灵感？"))) return;
      try {
        draw(await api("topics-delete", { path: rel }));
        $("#topic-drawer")?.remove();
        toast("已删除");
      } catch (err) {
        toast(err.message);
      }
    };

    $$("[data-write-topic]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        try {
          await writeFromTopic(b.dataset.writeTopic);
        } catch (err) {
          toast(err.message);
        }
      };
    });

    $$("[data-delete-topic]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        deleteTopic(b.dataset.deleteTopic);
      };
    });

    $$("[data-open-topic]").forEach((el) => {
      const open = () => openTopicDrawer(el.dataset.openTopic, { onSaved: draw });
      el.onclick = (e) => {
        e.stopPropagation();
        open();
      };
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      };
    });

    $$("[data-topic]").forEach((card) => {
      card.oncontextmenu = (e) => {
        e.preventDefault();
        const rel = card.dataset.topic;
        showContextMenu(e.clientX, e.clientY, [
          {
            label: "删除灵感",
            danger: true,
            run: () => deleteTopic(rel),
          },
        ]);
      };
    });
  };

  const saveTopic = async () => {
    const input = $("#topic-input");
    const body = input?.value.trim() || "";
    if (!body) {
      input?.focus();
      return;
    }
    try {
      draw(await api("topics-create", { account, body }));
      if (input) input.value = "";
      toast("已记下");
      input?.focus();
    } catch (err) {
      toast(err.message);
    }
  };

  $("#topic-save").onclick = () => saveTopic();
  $("#topic-input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveTopic();
    }
  });
  requestAnimationFrame(() => $("#topic-input")?.focus());

  try {
    const list = await api("topics-list", { account });
    const hydrated = await Promise.all(
      (list || []).map(async (t) => {
        if (typeof t.body === "string") return t;
        try {
          const full = await api("topics-read", { path: t.path });
          return { ...t, body: full.body || "" };
        } catch {
          return { ...t, body: "" };
        }
      }),
    );
    draw(hydrated);
  } catch (err) {
    const grid = $("#topic-grid");
    if (grid)
      grid.innerHTML = `<p class="muted">${esc(err.message || "加载失败")}</p>`;
    toast(err.message);
  }
}

/**
 * 右侧抽屉查看 / 编辑灵感全文。
 * @param {string} rel
 * @param {{ onSaved?: (list: any[]) => void }} [opts]
 */
async function openTopicDrawer(rel, opts = {}) {
  let topic;
  try {
    topic = await api("topics-read", { path: rel });
  } catch (err) {
    toast(err.message);
    return;
  }
  $("#topic-drawer")?.remove();
  $("#reference-drawer")?.remove();
  $("#published-drawer")?.remove();
  const when = topic.updated
    ? new Date(topic.updated).toLocaleString("zh-CN")
    : topic.title || "灵感";
  const n = document.createElement("aside");
  n.id = "topic-drawer";
  n.className = "reference-drawer topic-drawer";
  n.innerHTML = `<div class="row reference-drawer-head"><h3>${esc(when)}</h3><div class="reference-drawer-toolbar"><button type="button" class="ghost" id="topic-drawer-mode">编辑</button><button type="button" class="ghost icon-btn" id="topic-drawer-write" title="写成文章" aria-label="写成文章">${I.pen({ size: 16 })}</button><button type="button" class="ghost icon-btn" id="close-topic-drawer" title="关闭" aria-label="关闭">${I.close({ size: 18 })}</button></div></div><div class="reference-drawer-body topic-drawer-body"><div id="topic-drawer-preview" class="topic-drawer-preview is-md">${topic.body?.trim() ? safeHTML(topic.body) : '<p class="muted">（空）</p>'}</div><textarea id="topic-drawer-editor" class="topic-drawer-editor hidden" spellcheck="false">${esc(topic.body || "")}</textarea></div><div class="topic-drawer-foot hidden" id="topic-drawer-foot"><button type="button" class="ghost" id="topic-drawer-cancel">取消</button><button type="button" class="primary" id="topic-drawer-save">保存</button></div>`;
  document.body.append(n);

  let editing = false;
  const preview = $("#topic-drawer-preview");
  const editor = $("#topic-drawer-editor");
  const foot = $("#topic-drawer-foot");
  const modeBtn = $("#topic-drawer-mode");

  const setMode = (edit) => {
    editing = edit;
    preview.classList.toggle("hidden", edit);
    editor.classList.toggle("hidden", !edit);
    foot.classList.toggle("hidden", !edit);
    modeBtn.textContent = edit ? "预览" : "编辑";
    if (edit) {
      requestAnimationFrame(() => {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      });
    } else {
      const md = editor.value;
      preview.innerHTML = md.trim()
        ? safeHTML(md)
        : '<p class="muted">（空）</p>';
    }
  };

  $("#close-topic-drawer").onclick = () => n.remove();
  modeBtn.onclick = () => setMode(!editing);
  $("#topic-drawer-cancel").onclick = () => {
    editor.value = topic.body || "";
    setMode(false);
  };
  $("#topic-drawer-save").onclick = async () => {
    try {
      const list = await api("topics-save", {
        path: topic.path,
        body: editor.value,
      });
      topic = { ...topic, body: editor.value };
      setMode(false);
      opts.onSaved?.(list);
      toast("已保存");
    } catch (err) {
      toast(err.message);
    }
  };
  $("#topic-drawer-write").onclick = async () => {
    try {
      if (editing && editor.value !== (topic.body || "")) {
        await api("topics-save", { path: topic.path, body: editor.value });
        topic.body = editor.value;
      }
      n.remove();
      const firstLine =
        String(topic.body || "")
          .split(/\r?\n/)
          .map((l) => l.replace(/^#+\s*/, "").trim())
          .find(Boolean) || "未命名文章";
      const d = {
        id: crypto.randomUUID(),
        title: firstLine.slice(0, 80),
        body: topic.body || "",
        account,
        updated: new Date().toISOString(),
        chat: [],
        titles: [],
        prompts: [],
        topics: [
          {
            text: firstLine.slice(0, 80),
            at: new Date().toISOString(),
          },
        ],
        checks: [],
        snapshots: [],
      };
      state.documents.unshift(d);
      current = d;
      page = "write";
      tab = "topics";
      pending = null;
      persist();
      render();
    } catch (err) {
      toast(err.message);
    }
  };
}

/**
 * 设置页分区；title 可选，省略则不渲染分区标题。
 * @param {{ title?: string, control: string, className?: string }} opts
 */