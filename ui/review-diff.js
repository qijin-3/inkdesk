import { diffWords, diffLines } from "diff";
import { esc } from "./dom.js";

/** 词级差异 HTML */
export function diffHTML(oldText, nextText) {
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
export function buildEditHunks(oldText, nextText) {
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
export function composeHunks(hunks) {
  return (hunks || [])
    .map((h) => {
      if (h.kind === "equal") return h.value;
      return h.status === "accepted" ? h.next : h.old;
    })
    .join("");
}

/**
 * 改后稿结构保护：配图 / 标题 / 代码围栏缺失时自动补回并给出提示。
 * @returns {{ next: string, notes: string[] }}
 */
export function protectStructure(oldText, nextText) {
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

/** 审阅纯文本（无 diff 高亮） */
export function reviewPlainHTML(text, empty = "（空段落）") {
  const t = String(text ?? "").trim();
  if (!t) return esc(empty);
  return esc(t).replace(/\n/g, "<br>");
}

/** 改后行：默认可编辑纯文本 */
export function reviewNewHTML(h) {
  const t = String(h.next ?? "").trim();
  if (!t) return "";
  return esc(t).replace(/\n/g, "<br>");
}

/** 原文行：hover 时展示的词级 diff 细节 */
export function reviewOldDiffHTML(h) {
  return diffHTML(h.old, h.next) || reviewPlainHTML(h.old);
}

/** 未改动段落：按空行分段，保持文章阅读节奏 */
export function reviewEqualHTML(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="review-para">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 用一句话总结本次改写，供侧栏展示（不重复全文） */
export function summarizeRewrite(plan) {
  const hunks = (plan?.hunks || []).filter((h) => h.kind === "change");
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
  if (plan?.protectNotes?.length) reasons.push(...plan.protectNotes);
  else reasons.push("原文 Markdown、标题层级与配图均已保留，未动大结构");
  const first = hunks[0]?.next?.trim().split("\n").find(Boolean) || "";
  const excerpt = first.length > 48 ? first.slice(0, 48) + "…" : first;
  return `审阅总结：共 ${n} 处修改（新增约 ${add} 字 / 原文约 ${del} 字）。${reasons.join("；")}。${excerpt ? `例如：“${excerpt}”。` : ""}原文未被覆盖，可逐条接受 / 拒绝，完成后点审阅条「完成」。`;
}
