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
