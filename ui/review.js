// @extracted from renderer.js 2676-3141 — 后续改为 export 函数后由 renderer import
function diffHTML(oldText, nextText) {
  return diffWords(oldText || "", nextText || "")
    .map(
      (p) =>
        `<${p.added ? "ins" : p.removed ? "del" : "span"}>${esc(p.value)}</${p.added ? "ins" : p.removed ? "del" : "span"}>`,
    )
    .join("");
}

/**
 * 将全文新旧稿拆成可逐段接受/拒绝的 hunk（行级 diff）。
 * @param {string} oldText
 * @param {string} nextText
 */
function buildEditHunks(oldText, nextText) {
  const parts = diffLines(oldText || "", nextText || "");
  const hunks = [];
  for (let i = 0; i < parts.length; ) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      hunks.push({ kind: "equal", value: p.value });
      i += 1;
      continue;
    }
    let old = "",
      next = "";
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      if (parts[i].removed) old += parts[i].value;
      if (parts[i].added) next += parts[i].value;
      i += 1;
    }
    hunks.push({
      kind: "change",
      id: crypto.randomUUID(),
      old,
      next,
      status: "pending",
    });
  }
  if (!hunks.some((h) => h.kind === "change")) {
    hunks.length = 0;
    hunks.push({
      kind: "change",
      id: crypto.randomUUID(),
      old: oldText || "",
      next: nextText || "",
      status: "pending",
    });
  }
  // hunk 级结构保护：改后若删掉配图 / 标题行，强制保留原文该行，只审阅其余文字
  const IMG = /!\[[^\]]*\]\([^)]+\)/g;
  for (const h of hunks) {
    if (h.kind !== "change") continue;
    const oldImgs = [...String(h.old || "").matchAll(IMG)].map((m) => m[0]);
    const missing = [...new Set(oldImgs)].filter((s) => !String(h.next || "").includes(s));
    if (missing.length) h.next = String(h.next || "") + (String(h.next || "").endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n";
    const oldHeads = String(h.old || "").split("\n").filter((l) => /^#{1,6}\s/.test(l.trim()));
    const missH = [...new Set(oldHeads.map((l) => l.trim()))].filter((s) => !String(h.next || "").includes(s));
    if (missH.length) h.next = missH.join("\n") + "\n" + String(h.next || "");
    if (String(h.old || "").trim() === String(h.next || "").trim()) {
      h.kind = "equal";
      h.value = h.old;
      delete h.id;
      delete h.status;
    }
  }
  return hunks;
}

/** 按 hunk 决定合成最终正文 */
function composeHunks(hunks) {
  return (hunks || [])
    .map((h) => {
      if (h.kind === "equal") return h.value;
      return h.status === "accepted" ? h.next : h.old;
    })
    .join("");
}

/** 修改建议小卡片：紧跟在总结气泡下方，只放进度与操作，不放全文 diff */
function reviewCardHTML() {
  if (
    !pending ||
    pending.doc !== current?.id ||
    pending.conversationId !== conversation().id
  )
    return "";
  const list = (pending.hunks || []).filter((h) => h.kind === "change");
  const done = list.filter((h) => h.status !== "pending").length;
  return `<div class="review-card review-card-summary review-card-inline"><div class="review-card-head"><h3>修改建议 · ${done}/${list.length} 已决定</h3><div class="row"><button type="button" id="accept" class="primary">全部接受</button><button type="button" id="reject">全部拒绝</button></div></div><p class="muted">正文保持原文，可逐条对比接受 / 拒绝，改后卡片可直接手动改。</p></div>`;
}

/** 审阅中的改动列表（仅 change） */
function reviewChanges() {
  return (pending?.hunks || []).filter((h) => h.kind === "change");
}

/** 审阅进度：已决定 / 总数 */
function reviewProgress() {
  const list = reviewChanges();
  const done = list.filter((h) => h.status !== "pending").length;
  return { done, total: list.length };
}

/** 正文顶部审阅进度条已移入格式栏；保留空函数避免旧调用报错 */
function inlineReviewBarHTML() {
  return "";
}

/** 审阅纯文本（无 diff 高亮） */
function reviewPlainHTML(text, empty = "（空段落）") {
  const t = String(text ?? "").trim();
  if (!t) return esc(empty);
  return esc(t).replace(/\n/g, "<br>");
}

/** 改后行：默认可编辑纯文本 */
function reviewNewHTML(h) {
  const t = String(h.next ?? "").trim();
  if (!t) return "";
  return esc(t).replace(/\n/g, "<br>");
}

/** 原文行：hover 时展示的词级 diff 细节 */
function reviewOldDiffHTML(h) {
  return diffHTML(h.old, h.next) || reviewPlainHTML(h.old);
}

/** 未改动段落：按空行分段，保持文章阅读节奏 */
function reviewEqualHTML(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="review-para">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 审阅整页：待决定显示改后+原文；接受/拒绝后只保留最终正文 */
function reviewPageHTML() {
  if (!pending || pending.doc !== current?.id) return "";
  const list = reviewChanges();
  const idOf = (h) => list.findIndex((x) => x.id === h.id);
  let n = 0;
  const body = (pending.hunks || [])
    .map((h) => {
      if (h.kind === "equal") return reviewEqualHTML(h.value);
      const i = idOf(h);
      n = i;
      if (h.status !== "pending") {
        const finalText = h.status === "accepted" ? h.next : h.old;
        const empty = h.status === "accepted" ? "（已删除）" : "（空段落）";
        return `<section class="review-block is-decided is-${h.status}" data-review-hunk="${esc(h.id)}"><div class="review-resolved-wrap"><p class="review-para review-resolved">${reviewPlainHTML(finalText, empty)}</p><div class="review-float" role="group" aria-label="撤销本处决定"><button type="button" class="review-undo" data-review-undo="${esc(h.id)}" title="撤销${h.status === "accepted" ? "接受" : "拒绝"}">↩</button></div></div></section>`;
      }
      return `<section class="review-block" data-review-hunk="${esc(h.id)}"><div class="review-new"><div class="review-new-body" contenteditable="true" role="textbox" aria-label="改后正文，可直接编辑" data-placeholder="（已删除）" data-review-edit="${esc(h.id)}" title="点击直接编辑">${reviewNewHTML(h)}</div><div class="review-float" role="group" aria-label="第 ${i + 1} 处修改操作"><button type="button" class="review-ok" data-review-accept="${esc(h.id)}" title="接受本处（A）">✓</button><button type="button" class="review-no" data-review-reject="${esc(h.id)}" title="拒绝本处（X）">×</button></div></div><div class="review-old"><span class="review-old-plain">${reviewPlainHTML(h.old)}</span><span class="review-old-diff">${reviewOldDiffHTML(h)}</span></div></section>`;
    })
    .join("");
  void n;
  return `<div id="inline-review-list" class="review-page"><h1 class="review-title">${esc(current?.title || "未命名文章")}</h1><div class="review-article">${body}</div></div>`;
}

/** 进入审阅模式：编辑器收起，整页变为审阅界面（类似预览） */
function enterReviewMode() {
  reviewMode = true;
  const list = reviewChanges();
  const first = list.findIndex((h) => h.status === "pending");
  reviewIndex = first >= 0 ? first : 0;
  mountInlineReviewBar();
  scrollReviewToCurrent(false);
  renderPanel();
}

/** 退出审阅模式并恢复编辑器 */
function exitReviewMode() {
  reviewMode = false;
  reviewIndex = 0;
  $("#inline-review-bar")?.remove();
  $("#inline-review-list")?.remove();
  $("#inline-review-diff")?.remove();
  document.querySelector(".paper-wrap .paper")?.classList.remove("is-reviewing");
  const ed = $("#editor");
  if (ed) ed.hidden = false;
  const title = $("#title");
  if (title) title.hidden = false;
  syncFormatbarReviewMode(false);
}

/**
 * 审阅时：隐藏编辑工具，左侧「审阅中 x/n」，右侧全部接受/拒绝/完成。
 * @param {boolean} on
 */
function syncFormatbarReviewMode(on) {
  const bar = document.querySelector(".paper-wrap .formatbar");
  if (!bar) return;
  bar.classList.toggle("is-reviewing", !!on);
  bar.removeAttribute("hidden");
  bar.querySelectorAll(".formatbar-edit-tools").forEach((el) => {
    el.hidden = !!on;
  });
  const spacer = bar.querySelector(".formatbar-spacer");
  if (spacer) spacer.hidden = !!on;
  const reviewTools = bar.querySelector(".formatbar-review-tools");
  if (reviewTools) {
    reviewTools.hidden = !on;
    const tag = reviewTools.querySelector(".formatbar-review-tag");
    if (tag) {
      const { total } = reviewProgress();
      const cur = Math.min(reviewIndex, Math.max(total - 1, 0));
      tag.textContent = total > 0 ? `审阅中 ${cur + 1}/${total}` : "审阅中";
    }
    reviewTools.querySelector(".review-demo-badge")?.remove();
  }
}

/** 将审阅页滚动到当前条目 */
function scrollReviewToCurrent(smooth = true) {
  const list = reviewChanges();
  const cur = list[Math.min(reviewIndex, Math.max(list.length - 1, 0))];
  if (!cur) return;
  document
    .querySelector(`#inline-review-list [data-review-hunk="${CSS.escape(cur.id)}"]`)
    ?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
}

/** 刷新审阅整页，编辑器在后台保持同步 */
function refreshReviewUI() {
  const paper = document.querySelector(".paper-wrap .paper");
  if (!paper || !pending || pending.doc !== current?.id || !reviewMode) return;
  const listEl = $("#inline-review-list");
  const tmp = document.createElement("div");
  tmp.innerHTML = reviewPageHTML();
  const newList = tmp.querySelector("#inline-review-list");
  if (listEl && newList) listEl.replaceWith(newList);
  else if (newList) paper.insertAdjacentElement("afterbegin", newList);
  syncFormatbarReviewMode(true);
  bindInlineReviewBar();
}

/** 绑定审阅条带与逐条卡片事件 */
function bindInlineReviewBar() {
  const wrap = document.querySelector(".paper-wrap");
  const paper = wrap?.querySelector(".paper");
  if (!paper || !pending) return;
  const list = reviewChanges();
  const gotoHunk = (i) => {
    if (!list.length) return;
    reviewIndex = (i + list.length) % list.length;
    refreshReviewUI();
    scrollReviewToCurrent();
  };
  const root = wrap || paper;
  const prevBtn = root.querySelector('[data-inline="prev"]');
  const nextBtn = root.querySelector('[data-inline="next"]');
  const acceptAll = root.querySelector('[data-inline="accept-all"]');
  const rejectAll = root.querySelector('[data-inline="reject-all"]');
  const finishBtn = root.querySelector('[data-inline="finish"]');
  if (prevBtn) prevBtn.onclick = () => gotoHunk(reviewIndex - 1);
  if (nextBtn) nextBtn.onclick = () => gotoHunk(reviewIndex + 1);
  if (acceptAll)
    acceptAll.onclick = () => {
      pending.hunks?.forEach((h) => {
        if (h.kind === "change") h.status = "accepted";
      });
      applyPendingResult(pending.next, "accepted");
    };
  if (rejectAll)
    rejectAll.onclick = () => {
      applyPendingResult(pending.old, "rejected");
    };
  if (finishBtn)
    finishBtn.onclick = () => {
      const undecided = reviewChanges().filter((h) => h.status === "pending");
      if (undecided.length && !confirm(`还有 ${undecided.length} 条未决定，将按拒绝处理并完成。继续？`))
        return;
      undecided.forEach((h) => (h.status = "rejected"));
      const next = composeHunks(pending.hunks);
      const anyAccepted = pending.hunks.some(
        (h) => h.kind === "change" && h.status === "accepted",
      );
      applyPendingResult(next, anyAccepted ? "accepted" : "rejected");
    };
  paper.querySelectorAll("[data-review-accept]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      decideHunk(b.getAttribute("data-review-accept"), true);
    }),
  );
  paper.querySelectorAll("[data-review-reject]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      decideHunk(b.getAttribute("data-review-reject"), false);
    }),
  );
  paper.querySelectorAll("[data-review-undo]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const h = pending.hunks.find((x) => x.id === b.getAttribute("data-review-undo"));
      if (!h) return;
      h.status = "pending";
      reviewIndex = Math.max(0, reviewChanges().findIndex((x) => x.id === h.id));
      if (editor && current) {
        editor.commands.setContent(safeHTML(composeHunks(pending.hunks)));
        sync();
        changed();
      }
      refreshReviewUI();
      renderPanel();
    }),
  );
  paper.querySelectorAll("[data-review-edit]").forEach((el) => {
    const readNext = () =>
      (el.innerText || "").replace(/\u00a0/g, " ").replace(/\n+$/, "");
    const applyLocal = () => {
      const id = el.getAttribute("data-review-edit");
      const h = pending?.hunks.find((x) => x.id === id);
      if (!h) return null;
      h.next = readNext();
      const diff = el
        .closest("[data-review-hunk]")
        ?.querySelector(".review-old-diff");
      if (diff) diff.innerHTML = reviewOldDiffHTML(h);
      return h;
    };
    const commitEditor = () => {
      if (!applyLocal()) return;
      if (editor && current) {
        editor.commands.setContent(safeHTML(composeHunks(pending.hunks)));
        sync();
        changed();
      }
    };
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => e.stopPropagation());
    el.addEventListener("input", () => applyLocal());
    el.addEventListener("blur", commitEditor);
  });
  paper.querySelectorAll("[data-review-hunk]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[contenteditable], button, .review-float")) return;
      const i = reviewChanges().findIndex(
        (x) => x.id === card.getAttribute("data-review-hunk"),
      );
      if (i < 0) return;
      reviewIndex = i;
      syncFormatbarReviewMode(true);
    });
  });
  paper.querySelectorAll("[data-dot]").forEach((d) =>
    d.addEventListener("click", (e) => {
      e.stopPropagation();
      reviewIndex = +d.getAttribute("data-dot") || 0;
      refreshReviewUI();
    }),
  );
  if (!bindInlineReviewBar._key) {
    bindInlineReviewBar._key = (e) => {
      if (!reviewMode || !pending || busy) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const list = reviewChanges();
      const cur = list[Math.min(reviewIndex, Math.max(list.length - 1, 0))];
      if (!cur) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight") {
        e.preventDefault();
        reviewIndex = Math.min(reviewIndex + 1, list.length - 1);
        refreshReviewUI();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        reviewIndex = Math.max(reviewIndex - 1, 0);
        refreshReviewUI();
      } else if (k === "a" || k === "u") {
        e.preventDefault();
        decideHunk(cur.id, true);
      } else if (k === "x" || k === "r") {
        e.preventDefault();
        decideHunk(cur.id, false);
      } else if (k === "e") {
        e.preventDefault();
        document
          .querySelector(
            `#inline-review-list [data-review-hunk="${CSS.escape(cur.id)}"] [data-review-edit]`,
          )
          ?.focus();
      }
    };
    window.addEventListener("keydown", bindInlineReviewBar._key);
  }
}

/** 挂载 / 刷新正文顶部审阅条及其按钮 */
function mountInlineReviewBar() {
  const paper = document.querySelector(".paper-wrap .paper");
  if (!paper) return;
  $("#inline-review-bar")?.remove();
  $("#inline-review-list")?.remove();
  $("#inline-review-diff")?.remove();
  paper.classList.remove("is-reviewing");
  if (!pending || pending.doc !== current?.id || previewMode || !reviewMode) {
    const ed = $("#editor");
    if (ed) ed.hidden = false;
    const title = $("#title");
    if (title) title.hidden = false;
    syncFormatbarReviewMode(false);
    return;
  }
  // 整页审阅：格式栏右侧换成审阅操作，正文改为审阅页
  paper.classList.add("is-reviewing");
  syncFormatbarReviewMode(true);
  const ed = $("#editor");
  if (ed) ed.hidden = true;
  const title = $("#title");
  if (title) title.hidden = true;
  paper.insertAdjacentHTML("afterbegin", reviewPageHTML());
  bindInlineReviewBar();
}

/** 结构保护：改后稿若丢了原文的图片 / 标题 / 代码围栏，自动补回，避免破坏性改写 */
function protectStructure(oldText, nextText) {
  let next = String(nextText || "");
  const dropped = [];
  const imgs = [...String(oldText || "").matchAll(/!\[[^\]]*\]\([^)]+\)/g)].map((m) => m[0]);
  const missingImgs = [...new Set(imgs)].filter((s) => !next.includes(s));
  if (missingImgs.length) {
    next += (next.endsWith("\n") ? "" : "\n") + "\n" + missingImgs.join("\n") + "\n";
    dropped.push(`已保护配图 ${missingImgs.length} 张（改后稿误删，已自动保留在原文位置附近）`);
  }
  const heads = String(oldText || "").split("\n").filter((l) => /^#{1,6}\s/.test(l.trim()));
  const missingHeads = [...new Set(heads)].filter((s) => !next.includes(s.trim()));
  if (missingHeads.length) {
    dropped.push(`标题结构 ${missingHeads.length} 处在改后稿中缺失，已保留原文标题`);
    missingHeads.forEach((h) => {
      if (!next.includes(h.trim())) next = h + "\n" + next;
    });
  }
  const fences = (String(oldText || "").match(/```/g) || []).length;
  const nextFences = (next.match(/```/g) || []).length;
  if (fences % 2 === 0 && fences > 0 && nextFences !== fences) {
    dropped.push("检测到代码块可能被破坏，已尽量保留原文代码围栏");
  }
  return { next, notes: dropped };
}

/** 用一句话总结本次改写，供侧栏展示（不重复全文） */
function summarizeRewrite(oldText, nextText) {
  const hunks = (pending?.hunks || []).filter((h) => h.kind === "change");
  const n = hunks.length;
  let add = 0, del = 0, polish = 0, punct = 0;
  hunks.forEach((h) => {
    add += String(h.next || "").length;
    del += String(h.old || "").length;
    const o = String(h.old || "").trim(), t = String(h.next || "").trim();
    if (o.replace(/[，。！？、；：“”‘’（）《》\s]/g, "") !== t.replace(/[，。！？、；：“”‘’（）《》\s]/g, "")) polish += 1;
    else punct += 1;
  });
  const reasons = [];
  if (polish) reasons.push(`${polish} 处文字润色（措辞更顺、去掉赘字）`);
  if (punct) reasons.push(`${punct} 处标点 / 断句微调`);
  if (pending?.protectNotes?.length) reasons.push(...pending.protectNotes);
  else reasons.push("原文 Markdown、标题层级与配图均已保留，未动大结构");
  const first = hunks[0]?.next?.trim().split("\n").find(Boolean) || "";
  const excerpt = first.length > 48 ? first.slice(0, 48) + "…" : first;
  return `审阅总结：共 ${n} 处修改（新增约 ${add} 字 / 原文约 ${del} 字）。${reasons.join("；")}。${excerpt ? `例如：“${excerpt}”。` : ""}原文未被覆盖，可逐条接受 / 拒绝，完成后点审阅条「完成」。`;
}

/** Agent 模式切换控件（pill） */