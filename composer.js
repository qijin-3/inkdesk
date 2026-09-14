import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
const Tag = Node.create({
  name: "referenceTag",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { refId: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-reference]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-reference": node.attrs.refId,
        class: "inline-reference",
        contenteditable: "false",
        title: node.attrs.label,
      },
      node.attrs.label,
    ];
  },
});
export class Composer {
  constructor(element, session, { changed, send, picker }) {
    this.session = session;
    session.composerRefs ||= {};
    this.editor = new Editor({
      element,
      extensions: [StarterKit, Tag],
      content: session.composerDraft || {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
      editorProps: {
        attributes: {
          id: "instruction",
          role: "textbox",
          "aria-label": "写作指令",
          "data-placeholder": "输入要求，在光标处插入文件或选段标签…",
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
        { type: "referenceTag", attrs: { refId, label: reference.label } },
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
