import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { I } from "./icons.js";

const REF_KINDS = new Set(["file", "selection", "skill"]);

/** @param {string} kind */
function normalizeRefKind(kind) {
  return REF_KINDS.has(kind) ? kind : "file";
}

/** @param {string} kind */
function refKindIcon(kind) {
  const k = normalizeRefKind(kind);
  if (k === "skill") return I.sparkles({ size: 12 });
  if (k === "selection") return I.quote({ size: 12 });
  return I.paperclip({ size: 12 });
}

/**
 * 聊天记录 / 静态 HTML 中的引用标签。
 * @param {string} kind
 * @param {string} label
 */
export function referenceChipHTML(kind, label) {
  const k = normalizeRefKind(kind);
  const text = String(label ?? "");
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<span class="inline-reference inline-reference-${k}" title="${esc}"><span class="inline-reference-icon" aria-hidden="true">${refKindIcon(k)}</span><span class="inline-reference-label">${esc}</span></span>`;
}

/** 为旧草稿节点补全 kind，便于着色与图标 */
function withRefKinds(draft, refs) {
  if (!draft || typeof draft !== "object") return draft;
  const clone = structuredClone(draft);
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n?.type === "referenceTag" && n.attrs) {
        const ref = refs?.[n.attrs.refId];
        n.attrs.kind = normalizeRefKind(ref?.kind || n.attrs.kind || "file");
      }
      if (n?.content) walk(n.content);
    }
  };
  walk(clone.content);
  return clone;
}

const Tag = Node.create({
  name: "referenceTag",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      refId: { default: "" },
      label: { default: "" },
      kind: { default: "file" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-reference]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            refId: el.getAttribute("data-reference") || "",
            label: el.getAttribute("title") || el.textContent || "",
            kind: normalizeRefKind(el.getAttribute("data-kind") || "file"),
          };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const kind = normalizeRefKind(node.attrs.kind);
    return [
      "span",
      {
        "data-reference": node.attrs.refId,
        "data-kind": kind,
        class: `inline-reference inline-reference-${kind}`,
        contenteditable: "false",
        title: node.attrs.label,
      },
      ["span", { class: "inline-reference-icon", "aria-hidden": "true" }],
      ["span", { class: "inline-reference-label" }, node.attrs.label],
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const kind = normalizeRefKind(node.attrs.kind);
      const dom = document.createElement("span");
      dom.className = `inline-reference inline-reference-${kind}`;
      dom.contentEditable = "false";
      dom.dataset.reference = node.attrs.refId || "";
      dom.dataset.kind = kind;
      dom.title = node.attrs.label || "";
      const icon = document.createElement("span");
      icon.className = "inline-reference-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = refKindIcon(kind);
      const label = document.createElement("span");
      label.className = "inline-reference-label";
      label.textContent = node.attrs.label || "";
      dom.append(icon, label);
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "referenceTag") return false;
          const nextKind = normalizeRefKind(updated.attrs.kind);
          dom.className = `inline-reference inline-reference-${nextKind}`;
          dom.dataset.reference = updated.attrs.refId || "";
          dom.dataset.kind = nextKind;
          dom.title = updated.attrs.label || "";
          icon.innerHTML = refKindIcon(nextKind);
          label.textContent = updated.attrs.label || "";
          return true;
        },
      };
    };
  },
});
export class Composer {
  constructor(element, session, { changed, send, picker }) {
    this.session = session;
    session.composerRefs ||= {};
    this.editor = new Editor({
      element,
      extensions: [StarterKit, Tag],
      content: withRefKinds(
        session.composerDraft || {
          type: "doc",
          content: [{ type: "paragraph" }],
        },
        session.composerRefs,
      ),
      editorProps: {
        attributes: {
          id: "instruction",
          role: "textbox",
          "aria-label": "写作指令",
          "data-placeholder": "输入要求，用 + 插入文件或技能标签…",
        },
        handleKeyDown: (_, e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
            return true;
          }
          if (e.key === "@") {
            e.preventDefault();
            picker();
            return true;
          }
          return false;
        },
      },
      onUpdate: () => {
        session.composerDraft = this.editor.getJSON();
        session.composerPosition = this.editor.state.selection.from;
        changed();
      },
      onSelectionUpdate: () => {
        if (this.editor?.isFocused)
          session.composerPosition = this.editor.state.selection.from;
      },
    });
    const p = Math.min(
      session.composerPosition || 1,
      this.editor.state.doc.content.size,
    );
    this.editor.commands.setTextSelection(p);
  }
  insert(reference) {
    const refId = crypto.randomUUID();
    this.session.composerRefs[refId] = { ...reference, refId };
    const pos = Math.min(
      this.session.composerPosition || 1,
      this.editor.state.doc.content.size,
    );
    this.editor
      .chain()
      .focus()
      .insertContentAt(pos, [
        {
          type: "referenceTag",
          attrs: {
            refId,
            label: reference.label,
            kind: normalizeRefKind(reference.kind),
          },
        },
        { type: "text", text: " " },
      ])
      .run();
  }
  serialize() {
    const parts = [],
      refs = [];
    let instruction = "",
      display = "";
    this.editor.state.doc.descendants((node) => {
      if (node.type.name === "referenceTag") {
        const r = this.session.composerRefs[node.attrs.refId];
        if (!r) throw Error("引用已失效，请重新添加");
        refs.push(r);
        parts.push({ kind: "tag", label: r.label, reference: r });
        instruction += "[引用 " + r.refId + "]";
        display += "[" + r.label + "]";
        return false;
      }
      if (node.isText) {
        parts.push({ kind: "text", text: node.text });
        instruction += node.text;
        display += node.text;
      }
      if (node.type.name === "hardBreak") {
        instruction += "\n";
        display += "\n";
        parts.push({ kind: "text", text: "\n" });
      }
      if (node.type.name === "paragraph" && instruction) {
        instruction += "\n";
        display += "\n";
        parts.push({ kind: "text", text: "\n" });
      }
    });
    return { parts, references: refs, instruction, display };
  }
  destroy() {
    this.editor.destroy();
  }
}
