import { Composer } from "./composer.js";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { gfm } from "turndown-plugin-gfm";
import { marked } from "marked";
import TurndownService from "turndown";
import { diffWords } from "diff";
import { calendar, validDate, publishSummary } from "./calendar.cjs";
let saveProfileEditor = null;
let composer = null,
  profileTab = "identity";
let heatmapYear = new Date().getFullYear();
let metricsSort = "阅读";
const $ = (s) => document.querySelector(s),
  api = (n, d) => window.desk.call(n, d);

/** 是否在浏览器开发预览模式 */
function isWeb() {
  return !!window.desk?.web;
}

/** 将 inkasset 协议转为网页可访问的路径 */
function assetUrl(src) {
  if (typeof src !== "string") return src;
  if (src.startsWith("inkasset://vault/"))
    return "/api/asset/vault/" + src.slice("inkasset://vault/".length);
  if (src.startsWith("inkasset://local/"))
    return "/api/asset/local/" + src.slice("inkasset://local/".length);
  return src;
}

/** 打开系统文件选择器 */
function pickFiles({ multiple = false, accept = "" } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}

/** 上传项目参考文件（网页用文件选择，桌面走原生对话框） */
async function uploadProjectFiles(docId) {
  if (!isWeb()) return api("project-upload", docId);
  const files = await pickFiles({ multiple: true });
  if (!files.length) return null;
  const payload = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      bytes: [...new Uint8Array(await f.arrayBuffer())],
    })),
  );
  return api("project-upload", { id: docId, files: payload });
}

/** 选择一张图片并返回 bytes 与 MIME */
async function pickImagePayload() {
  const files = await pickFiles({ accept: "image/*" });
  const f = files[0];
  if (!f) return null;
  return {
    bytes: [...new Uint8Array(await f.arrayBuffer())],
    type: f.type,
  };
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state,
  editor,
  page = "write",
  tab = "chat",
  account = "AI",
  current,
  saveTimer,
  busy = false,
  pending = null,
  sourceFiles = [],
  selectedText = "",
  selectionContext = null,
  dirty = false;
let editorHTML = "";
function conversation(doc = current) {
  doc.conversations ||= [];
  if (!doc.conversations.length)
    doc.conversations.push({
      id: crypto.randomUUID(),
      title: "开始聊这篇",
      messages: doc.chat || [],
    });
  let c =
    doc.conversations.find((c) => c.id === doc.activeConversationId) ||
    doc.conversations[0];
  doc.activeConversationId = c.id;
  return c;
}
const td = new TurndownService({ headingStyle: "atx" });
td.use(gfm);
const escapeMarkdown = td.escape.bind(td);
td.escape = (text) =>
  text
    .split(/(!?\[\[[^\]\n]+\]\]|\[![a-z]+\][+-]?)/gi)
    .map((part, i) => (i % 2 ? part : escapeMarkdown(part)))
    .join("");
td.addRule("images", {
  filter: "img",
  replacement: (_, node) =>
    "![" + (node.alt || "图片") + "](" + node.getAttribute("src") + ")",
});
function safeHTML(md) {
  const d = new DOMParser().parseFromString(
    marked.parse(md || ""),
    "text/html",
  );
  d.querySelectorAll(
    "script,iframe,object,embed,style,link,form,input,button",
  ).forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((n) => {
    [...n.attributes].forEach((a) => {
      if (
        a.name.startsWith("on") ||
        a.name === "style" ||
        (["href", "src"].includes(a.name) &&
          !/^(https?:|inkasset:|\/api\/asset\/|data:image\/|[^:]*$)/i.test(
            a.value,
          ))
      )
        n.removeAttribute(a.name);
    });
  });
  return d.body.innerHTML.replace(
    /inkasset:\/\/(vault|local)\/([^"'\s)]+)/g,
    (_, kind, rel) => "/api/asset/" + kind + "/" + rel,
  );
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 3800);
}
async function persist() {
  clearTimeout(saveTimer);
  try {
    const before = JSON.stringify(state);
    await api("save", state);
    if (before === JSON.stringify(state)) dirty = false;
    const n = $("#saved");
    if (n) n.textContent = "已保存到开发副本";
    return true;
  } catch (e) {
    toast("保存失败：" + e.message);
    return false;
  }
}
function changed() {
  const card = document.querySelector('[data-id="' + current.id + '"]');
  if (card) {
    card.querySelector("span").textContent = current.title;
    card.querySelector("small").textContent =
      new Date().toLocaleDateString("zh-CN") +
      " · " +
      current.body.length +
      " 字";
  }
  dirty = true;
  current.updated = new Date().toISOString();
  const n = $("#saved");
  if (n) n.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}
function newDoc() {
  const d = {
    id: crypto.randomUUID(),
    title: "未命名文章",
    body: "",
    account,
    updated: new Date().toISOString(),
    chat: [],
    titles: [],
    prompts: [],
    topics: [],
    checks: [],
    snapshots: [],
  };
  state.documents.unshift(d);
  current = d;
  page = "write";
  pending = null;
  persist();
  render();
}
function sync() {
  if (editor && current && editor.getHTML() !== editorHTML) {
    current.body = td.turndown(editor.getHTML());
    editorHTML = editor.getHTML();
  }
}
function render() {
  saveProfileEditor = null;
  $("#reference-drawer")?.remove();
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  $("#app").innerHTML =
    `<aside class="sidebar"><div class="brand"><span class="brand-icon">i</span> inkdesk <small>写作工作台</small></div><div class="account"><button data-account="AI" class="${account === "AI" ? "active" : ""}">金奇 AI</button><button data-account="Dev" class="${account === "Dev" ? "active" : ""}">金奇 Dev</button></div><nav><button data-page="dashboard" class="${page === "dashboard" ? "chosen" : ""}">◫ <span>数据概览</span></button><button data-page="write" class="${page === "write" ? "chosen" : ""}">▤ <span>写作桌面</span></button><button data-page="topics" class="${page === "topics" ? "chosen" : ""}">✧ <span>选题与灵感</span></button><button data-page="materials">▧ <span>项目素材</span></button><button data-page="archive">▣ <span>已归档</span></button><button data-page="profile">◎ <span>账号人设</span></button></nav><div class="list-head">我的草稿 <button id="new" title="新建文章">＋</button></div><div class="docs">${
      state.documents
        .filter(
          (d) =>
            d.account === account &&
            d.status !== "final" &&
            d.status !== "archive",
        )
        .map(
          (d) =>
            `<button class="doc ${current?.id === d.id ? "selected" : ""}" data-id="${d.id}"><span>${esc(d.title)}</span><small>${new Date(d.updated).toLocaleDateString("zh-CN")} · ${d.body.length} 字</small></button>`,
        )
        .join("") || '<p class="muted">从一个想法开始。</p>'
    }</div><div class="side-bottom"><button id="source">↻ 刷新开发副本</button><button data-page="settings">⚙ 连接与存储</button><span>本地优先 · 你的表达，你做主</span></div></aside><main id="main"></main>`;
  if (page === "write") renderWrite();
  else if (page === "dashboard") renderDashboard();
  else if (page === "topics") renderTopics();
  else if (page === "materials") renderMaterials();
  else if (page === "archive") renderArchive();
  else if (page === "profile") renderProfile();
  else renderSettings();
  $$("[data-page]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        page = b.dataset.page;
        render();
      }),
  );
  $$("[data-account]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        account = b.dataset.account;
        current = state.documents.find((d) => d.account === account);
        pending = null;
        render();
      }),
  );
  $$("[data-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "profile" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        sync();
        persist();
        current = state.documents.find((d) => d.id === b.dataset.id);
        page = "write";
        pending = null;
        render();
      }),
  );
  $("#new").onclick = newDoc;
  $("#source").onclick = refreshVault;
}
function $$(s) {
  return [...document.querySelectorAll(s)];
}
function renderWrite() {
  if (!current) {
    $("#main").innerHTML =
      '<div class="empty"><span class="eyebrow">A SPACE FOR YOUR WORDS</span><h1>把想说的话，写下来。</h1><p>从草稿开始，或导入已有文章。AI 在你需要时帮忙。</p><button class="primary" id="start">＋ 新建文章</button></div>';
    $("#start").onclick = newDoc;
    return;
  }
  $("#main").innerHTML =
    `<header><div><span class="eyebrow">${account === "AI" ? "AI 实践与思考" : "BUILD IN PUBLIC"}</span><span class="crumb"> / 写作桌面</span></div><div class="header-actions"><span id="saved">已保存到本地</span><button id="history">版本</button><button id="save-version">保存版本</button><button id="finalize" class="primary">定稿</button></div></header><div class="workspace"><section class="paper-wrap"><div class="formatbar"><button data-fmt="bold"><b>B</b></button><button data-fmt="italic"><i>I</i></button><button data-fmt="heading">H2</button><button data-fmt="bulletList">☷</button><button data-fmt="blockquote">❝</button><span></span><button id="image">＋ 图片</button><button id="outline">大纲</button><button id="focus">专注</button></div><div id="outline-list" hidden></div><article class="paper"><input id="title" placeholder="给这个想法起个名字" value="${esc(current.title)}"><div class="article-materials"><button id="article-materials">项目参考文件</button>${(current.materials || []).map((p) => `<button data-related="${esc(p)}">${esc(p.split("/").pop().replace(/\.md$/, ""))}</button>`).join("")}</div><div class="byline">金奇 · ${new Date().toLocaleDateString("zh-CN")} <span id="wordcount">${current.body.length} 字</span></div><div id="editor"></div></article><div class="selection-bar"><span id="selection-label">选中正文，让 AI 帮你推敲</span><button id="tag-selection">引用选段</button><button data-task="review">看稿</button><button data-task="rewrite">润色选段</button><button data-task="check">核查</button></div></section><aside class="assistant"><div class="assistant-head"><span>✧ 写作伙伴</span><select id="provider"><option value="cursor">Cursor</option><option value="codex">Codex</option></select></div><div class="tabs">${[
      ["chat", "对话"],
      ["topics", "思路"],
      ["titles", "标题"],
      ["prompts", "配图"],
      ["checks", "核查"],
      ["publish", "发布"],
    ]
      .map(
        ([id, name]) =>
          `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${name}</button>`,
      )
      .join("")}</div><div id="panel"></div></aside></div>`;
  editor = new Editor({
    element: $("#editor"),
    extensions: [StarterKit, Image, TableKit],
    content: safeHTML(current.body),
    onUpdate() {
      sync();
      $("#wordcount").textContent = current.body.length + " 字";
      changed();
    },
    onSelectionUpdate({ editor: e }) {
      const { from, to } = e.state.selection;
      if (to > from)
        selectionContext = {
          from,
          to,
          text: e.state.doc.textBetween(from, to, "\n"),
          version: e.getHTML(),
          doc: current.id,
        };
      selectedText = selectionContext?.text || "";
      $("#selection-label").textContent = selectedText
        ? "已选中 " + selectedText.length + " 字"
        : "选中正文，让 AI 帮你推敲";
    },
    editorProps: {
      handlePaste(view, event) {
        const item = [...(event.clipboardData?.items || [])].find((i) =>
          i.type.startsWith("image/"),
        );
        if (!item) return false;
        const f = item.getAsFile();
        const imageDoc = current,
          imageEditor = editor;
        f.arrayBuffer().then(async (b) => {
          try {
            sync();
            if (!(await persist())) return;
            const src = assetUrl(
              await api("image", {
                articleId: imageDoc.id,
                bytes: Array.from(new Uint8Array(b)),
                type: f.type,
              }),
            );
            if (current === imageDoc && editor === imageEditor)
              editor.chain().focus().setImage({ src }).run();
            else {
              imageDoc.body += "\n\n![图片](" + src + ")";
              await persist();
            }
          } catch (e) {
            toast(e.message);
          }
        });
        return true;
      },
    },
  });
  editorHTML = editor.getHTML();
  selectedText = "";
  selectionContext = null;
  $("#article-materials").onclick = () => {
    sync();
    persist();
    page = "materials";
    render();
  };
  $$("[data-related]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          showMaterial(
            b.dataset.related,
            await api("material-read", b.dataset.related),
          );
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $("#title").oninput = (e) => {
    current.title = e.target.value;
    changed();
  };
  $("#provider").value = state.provider;
  $("#provider").onchange = (e) => {
    state.provider = e.target.value;
    persist();
  };
  $$("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        $$("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
        renderPanel();
      }),
  );
  $$("[data-fmt]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = editor.chain().focus();
        const f = b.dataset.fmt;
        if (f === "heading") c.toggleHeading({ level: 2 }).run();
        else c["toggle" + f[0].toUpperCase() + f.slice(1)]().run();
      }),
  );
  $("#image").onclick = async () => {
    try {
      const imageDoc = current,
        imageEditor = editor;
      sync();
      if (!(await persist())) return;
      let imagePayload = { articleId: imageDoc.id };
      if (isWeb()) {
        const picked = await pickImagePayload();
        if (!picked) return;
        imagePayload = { ...imagePayload, ...picked };
      }
      const src = assetUrl(await api("image", imagePayload));
      if (src) {
        if (current === imageDoc && editor === imageEditor)
          editor.chain().focus().setImage({ src }).run();
        else {
          imageDoc.body += "\n\n![图片](" + src + ")";
          await persist();
        }
      }
    } catch (e) {
      toast(e.message);
    }
  };
  $("#focus").onclick = () => {
    $(".assistant").classList.toggle("hidden");
    $(".sidebar").classList.toggle("hidden");
  };
  $("#outline").onclick = () => {
    const n = $("#outline-list");
    n.hidden = !n.hidden;
    n.innerHTML =
      $$("#editor h1,#editor h2,#editor h3")
        .map(
          (x, i) =>
            `<button data-heading="${i}">${esc(x.textContent)}</button>`,
        )
        .join("") || "<p>添加标题后，这里会显示文章结构。</p>";
    $$("[data-heading]").forEach(
      (b) =>
        (b.onclick = () =>
          $$("#editor h1,#editor h2,#editor h3")[
            +b.dataset.heading
          ].scrollIntoView({ behavior: "smooth" })),
    );
  };
  $("#save-version").onclick = () => {
    sync();
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML =
      '<div class="dialog"><h2>保存一个版本</h2><input id="version-name" placeholder="如：自己的初稿 / 精修版"><div class="row"><button id="version-cancel">取消</button><button id="version-confirm" class="primary">保存版本</button></div></div>';
    document.body.append(modal);
    $("#version-cancel").onclick = () => modal.remove();
    $("#version-confirm").onclick = async () => {
      current.snapshots.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        name: $("#version-name").value.trim() || "手动保存",
        body: current.body,
      });
      dirty = true;
      if (await persist()) {
        modal.remove();
        toast("版本已保存");
      }
    };
  };
  $("#history").onclick = async () => {
    sync();
    if (!(await persist())) return;
    try {
      current.snapshots = await api("versions", current.id);
    } catch (e) {
      return toast(e.message);
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<div class="dialog"><div class="row"><h2>版本与修改记录</h2><button id="close-history">关闭</button></div><p class="muted">记录只保存在本机，不自动发送给 AI。</p><div class="history-items">${
      (current.snapshots || [])
        .map(
          (x, i) =>
            `<div class="result-card"><small>${esc(x.name || "修改前快照")} · ${new Date(x.at).toLocaleString("zh-CN")}</small><div>${esc(x.body.slice(0, 260))}</div><button data-restore="${i}">恢复此版本</button></div>`,
        )
        .reverse()
        .join("") || "<p>接受修改或定稿时，会在这里保存快照。</p>"
    }${(current.decisions || [])
      .slice(-10)
      .reverse()
      .map(
        (x) =>
          `<div class="result-card"><small>${x.action === "accepted" ? "已接受" : "已拒绝"} · ${new Date(x.at).toLocaleString("zh-CN")}</small><div>${esc(x.before)} → ${esc(x.after)}</div></div>`,
      )
      .join("")}</div></div>`;
    document.body.append(modal);
    $("#close-history").onclick = () => modal.remove();
    $$("[data-restore]").forEach(
      (b) =>
        (b.onclick = () => {
          const body = current.snapshots[+b.dataset.restore].body;
          sync();
          current.snapshots.push({
            at: new Date().toISOString(),
            body: current.body,
          });
          editor.commands.setContent(safeHTML(body));
          sync();
          changed();
          pending = null;
          modal.remove();
          toast("版本已恢复，恢复前的正文也已保存");
        }),
    );
  };
  $("#finalize").onclick = async () => {
    if (busy) return toast("请等待 AI 完成后再定稿");
    sync();
    if (!(await persist())) return;
    try {
      let result = await api("finalize", current.id);
      if (isWeb() && result?.needsConfirmation) {
        const ok = confirm(result.message + "\n\n" + result.detail);
        if (!ok) return;
        result = await api("finalize", {
          id: current.id,
          confirmed: true,
          contentSnapshot: result.contentSnapshot,
        });
      }
      if (!result || result.needsConfirmation) return;
      Object.assign(state, result);
      current = state.documents.find((d) => d.account === account);
      pending = null;
      page = "archive";
      render();
      toast("已定稿并移入本账号 Archive，版本与对话已保留");
    } catch (e) {
      toast(e.message);
    }
  };
  $$("[data-task]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => runTask(b.dataset.task);
  });
  $("#tag-selection").onmousedown = (e) => e.preventDefault();
  $("#tag-selection").onclick = tagSelection;
  renderPanel();
}
function renderPanel() {
  if (composer) {
    composer.destroy();
    composer = null;
  }
  $$("[data-task]").forEach((b) => (b.disabled = busy));
  const panel = $("#panel");
  if (!panel) return;
  if (tab === "publish") {
    panel.innerHTML = `<div class="panel-intro"><h3>公众号排版</h3><p>将正文转换为可复制的富文本。</p></div><button id="copy-publish" class="primary wide">复制公众号排版</button><p class="notice">本地图片需在公众号编辑器中上传。复制时会转换为图片占位提示。</p><div class="publish-preview">${safeHTML(current.body)}</div>`;
    $("#copy-publish").onclick = () => copyPublish(current);
    return;
  }
  const key = tab;
  let content = "";
  if (tab === "chat") {
    content =
      conversation()
        .messages.map(
          (m) =>
            `<div class="message ${m.role}"><small>${m.role === "user" ? "你" : "写作伙伴"}</small><div>${m.parts ? m.parts.map((p) => (p.kind === "tag" ? `<span class="inline-reference">${esc(p.label)}</span>` : esc(p.text))).join("") : esc(m.text)}</div></div>`,
        )
        .join("") ||
      '<div class="welcome"><span>✧</span><h3>先保留你的声音。</h3><p>一起聊想法，或选中一段文字推敲。<br>修改先预览，由你决定是否采用。</p></div>';
  } else {
    const labels = {
      topics: ["本篇思路", "围绕表达意图，准备少量可用角度。"],
      titles: ["标题建议", "给同一篇文章，找到更贴切的开头。"],
      prompts: ["配图提示词", "复制到 Lovart，生成后导入正文。"],
      checks: ["内容核查", "来源不足的判断会保留为待核实。"],
    };
    content =
      `<div class="panel-intro"><h3>${labels[key][0]}</h3><p>${labels[key][1]}</p></div>` +
      (current[key] || [])
        .map(
          (x, i) =>
            `<div class="result-card"><small>${new Date(x.at).toLocaleDateString("zh-CN")}</small><div>${esc(x.text)}</div><button data-copy="${i}">复制</button>${key === "titles" ? `<button data-use="${i}">选择标题</button>` : ""}</div>`,
        )
        .join("") +
      `<button class="secondary wide" id="generate">✧ 生成${labels[key][0]}</button>`;
  }
  panel.innerHTML = `${tab === "chat" ? `<div class="conversation-bar"><select id="conversation">${current.conversations.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select><button id="new-conversation" title="为本篇创建新对话">＋ 新对话</button></div>` : ""}<div class="panel-scroll">${
    pending &&
    pending.doc === current.id &&
    pending.conversationId === conversation().id
      ? `<div class="review-card"><h3>修改建议</h3><div class="diff">${diffWords(
          pending.old,
          pending.next,
        )
          .map(
            (p) =>
              `<${p.added ? "ins" : p.removed ? "del" : "span"}>${esc(p.value)}</${p.added ? "ins" : p.removed ? "del" : "span"}>`,
          )
          .join(
            "",
          )}</div><div class="row"><button id="accept" class="primary">接受修改</button><button id="reject">保留原文</button></div></div>`
      : ""
  }${content}</div><div class="composer"><div id="composer-input"></div><div class="composer-tools"><button id="chat-upload">＋ 上传文件</button><button id="chat-reference">@ 项目文件</button><button id="rewrite-tags">改写标签选段</button></div><div><span>${busy ? "正在思考…" : "只在需要时调用 AI"}</span><button id="send" class="primary">${busy ? "停止" : "发送 ↑"}</button></div></div>`;
  if (tab === "chat") {
    $("#conversation").value = conversation().id;
    $("#conversation").onchange = (e) => {
      current.activeConversationId = e.target.value;
      persist();
      renderPanel();
    };
    $("#new-conversation").onclick = () => {
      const c = {
        id: crypto.randomUUID(),
        title: "新对话 " + (current.conversations.length + 1),
        messages: [],
      };
      current.conversations.push(c);
      current.activeConversationId = c.id;
      persist();
      renderPanel();
    };
  }
  $("#send").onclick = () =>
    busy ? api("cancel") : runTask(tab === "chat" ? "chat" : tab);
  composer = new Composer($("#composer-input"), conversation(), {
    changed: () => {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 500);
    },
    send: () => $("#send").click(),
    picker: () => chooseChatFile(),
  });
  $("#chat-reference").onclick = () => chooseChatFile();
  $("#chat-upload").onclick = uploadChatFiles;
  for (const id of ["#chat-upload", "#chat-reference"])
    $(id).onmousedown = (e) => e.preventDefault();
  $("#rewrite-tags").onclick = () => runTask("rewrite-tags");
  if ($("#generate")) $("#generate").onclick = () => runTask(tab);
  $$("[data-copy]").forEach(
    (b) =>
      (b.onclick = () =>
        api("copy", { text: current[key][+b.dataset.copy].text }).then(() =>
          toast("已复制"),
        )),
  );
  $$("[data-use]").forEach(
    (b) =>
      (b.onclick = () => {
        const value = current[key][+b.dataset.use].text
          .split("\n")[0]
          .replace(/^[-*#\d.、\s]+/, "")
          .trim();
        if (value) {
          current.title = value;
          $("#title").value = value;
          changed();
        }
      }),
  );
  if ($("#accept"))
    $("#accept").onclick = () => {
      sync();
      if (current.body !== pending.base) {
        toast("正文已变化，请重新生成建议。");
        pending = null;
        renderPanel();
        return;
      }
      current.decisions ??= [];
      current.decisions.push({
        action: "accepted",
        before: pending.old,
        after: pending.next,
        at: new Date().toISOString(),
      });
      current.snapshots.push({
        at: new Date().toISOString(),
        body: current.body,
      });
      if (pending.edits) {
        let chain = editor.chain().focus();
        for (const e of [...pending.edits].sort((a, b) => b.from - a.from))
          chain = chain.insertContentAt(
            { from: e.from, to: e.to },
            safeHTML(e.next),
          );
        chain.run();
      } else if (pending.from !== pending.to)
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from: pending.from, to: pending.to },
            safeHTML(pending.next),
          )
          .run();
      else editor.commands.setContent(safeHTML(pending.next));
      sync();
      changed();
      pending = null;
      renderPanel();
      toast("已应用，可用 ⌘Z 撤回");
    };
  if ($("#reject"))
    $("#reject").onclick = () => {
      current.decisions ??= [];
      current.decisions.push({
        action: "rejected",
        before: pending.old,
        after: pending.next,
        at: new Date().toISOString(),
      });
      changed();
      pending = null;
      renderPanel();
    };
}
async function runTask(task) {
  if (busy) return toast("请等待当前任务，或停止后重试");
  sync();
  const doc = current;
  const body = doc.body;
  const context =
    selectionContext?.doc === current.id &&
    selectionContext.version === editor.getHTML()
      ? selectionContext
      : null;
  const { from, to } = context || editor.state.selection;
  const selection =
    context?.text || editor.state.doc.textBetween(from, to, "\n");
  let draft;
  try {
    draft = composer?.serialize() || {
      instruction: "",
      display: "",
      parts: [],
      references: [],
    };
  } catch (e) {
    return toast(e.message);
  }
  const instruction = draft.instruction;
  const anchors = draft.references.filter((r) => r.kind === "selection");
  if (anchors.some((r) => r.articleId !== doc.id || r.base !== body))
    return toast("引用选段已过期，请删除标签并重新选中添加");
  if (task === "rewrite-tags") {
    if (!anchors.length) return toast("请先添加正文选段标签");
    const sorted = [...anchors].sort((a, b) => a.from - b.from);
    if (sorted.some((a, i) => i > 0 && a.from < sorted[i - 1].to))
      return toast("选段有重叠，请保留不重叠的标签");
  }
  if (task === "rewrite" && !selection) return toast("请先选中需要润色的段落");
  if (task === "chat" && !instruction) return toast("先写一句想讨论的内容");
  const prompts = {
    "rewrite-tags":
      "仅改写标记的正文选段，文件标签是参考资料。只返回 JSON 数组 [{id,text}]，id 为每个正文选段的引用 ID，text 为该选段修改后的完整文本，保持未标记内容不变。每个选段恰好一个结果。",
    review: "指出最多三个值得修改的问题，解释取舍，不重写。",
    rewrite: "保留原意和个人语气，轻量润色。",
    check:
      "检查事实、案例和专业概念。区分已核实与待核实；没有真实检索证据不得宣称核实完成或编造链接。",
    titles:
      "给出三个标题。只返回 JSON 数组，每项含 title 和 reason 字段，不要代码围栏。",
    prompts:
      "给出两张正文配图的中文提示词，说明对应段落与图意，适合复制到 Lovart。",
    topics: "提炼表达意图，给出三个与本篇相关的可写角度和所需素材。",
    checks: "检查关键事实与推理边界，没有检索证据的条目列为待核实。",
    chat: "",
  };
  const session = conversation(doc);
  if (!session.messages.length)
    session.title = (draft.display || prompts[task]).slice(0, 22);
  session.messages.push({
    role: "user",
    text: draft.display || prompts[task],
    parts: draft.parts.length ? draft.parts : undefined,
  });
  const submittedDraft = session.composerDraft;
  const submittedRefs = session.composerRefs;
  session.composerDraft = null;
  session.composerRefs = {};
  session.composerPosition = 1;
  busy = true;
  await persist();
  if (["review", "rewrite", "check", "rewrite-tags"].includes(task))
    tab = "chat";
  renderPanel();
  const history = session.messages
    .slice(-8, -1)
    .map((x) => x.role + ": " + x.text)
    .join("\n");
  try {
    const result = await api("agent", {
      provider: state.provider,
      model: state.model,
      account: doc.account,
      task,
      articleId: doc.id,
      references: draft.references,
      instruction: (prompts[task] || "") + "\n" + instruction,
      body,
      selection,
      history,
    });
    if (!result) throw Error("Agent 未返回正文");
    session.messages.push({ role: "assistant", text: result });
    if (task === "rewrite-tags") {
      const results = JSON.parse(
        result.replace(/^```(?:json)?\s*|\s*```$/g, ""),
      );
      if (
        !Array.isArray(results) ||
        results.length !== anchors.length ||
        new Set(results.map((x) => x.id)).size !== anchors.length ||
        results.some(
          (x) =>
            !anchors.some((a) => a.refId === x.id) ||
            typeof x.text !== "string",
        )
      )
        throw Error("AI 未返回完整的选段建议，正文保持不变");
      const edits = anchors.map((a) => ({
        ...a,
        old: a.text,
        next: results.find((r) => r.id === a.refId).text,
      }));
      if (doc.id === current?.id)
        pending = {
          doc: doc.id,
          conversationId: session.id,
          base: body,
          edits,
          old: edits.map((x) => x.label + "\n" + x.old).join("\n\n"),
          next: edits.map((x) => x.label + "\n" + x.next).join("\n\n"),
        };
    } else if (task === "rewrite") {
      if (doc.id === current?.id)
        pending = {
          doc: doc.id,
          conversationId: session.id,
          base: body,
          old: selection || body,
          next: result,
          from,
          to,
        };
    } else if (
      ["titles", "prompts", "topics", "checks", "check"].includes(task)
    ) {
      const k = task === "check" ? "checks" : task;
      doc[k] ??= [];
      if (k === "titles") {
        try {
          const items = JSON.parse(
            result.replace(/^```(?:json)?\s*|\s*```$/g, ""),
          );
          if (!Array.isArray(items)) throw Error();
          doc[k].unshift(
            ...items
              .filter((x) => typeof x.title === "string")
              .map((x) => ({
                text: x.title + "\n" + (x.reason || ""),
                at: new Date().toISOString(),
              })),
          );
        } catch {
          doc[k].unshift({ text: result, at: new Date().toISOString() });
        }
      } else doc[k].unshift({ text: result, at: new Date().toISOString() });
    }
    await persist();
  } catch (e) {
    toast(e.message);
    if (!session.composerDraft) {
      session.composerDraft = submittedDraft;
      session.composerRefs = submittedRefs;
    }
    session.messages.push({
      role: "assistant",
      text: "本次未完成：" + e.message,
    });
  } finally {
    busy = false;
    await persist();
    if (page === "write") renderPanel();
  }
}
async function copyPublish(doc) {
  if (!doc) doc = current;
  if (doc === current) sync();
  if (!doc) return;
  const d = new DOMParser().parseFromString(safeHTML(doc.body), "text/html");
  d.querySelectorAll("img").forEach((img) => {
    const p = d.createElement("p");
    p.textContent = "【请上传图片：" + (img.alt || "正文配图") + "】";
    img.replaceWith(p);
  });
  const styles = {
    p: "margin:0 0 20px;line-height:1.9;font-size:16px;color:#333;",
    h1: "font-size:25px;line-height:1.5;margin:28px 0 18px;",
    h2: "font-size:21px;line-height:1.5;margin:28px 0 16px;color:#214f45;",
    h3: "font-size:18px;margin:24px 0 12px;",
    blockquote:
      "border-left:3px solid #648779;padding:8px 16px;margin:20px 0;color:#666;",
    li: "line-height:1.9;margin:8px 0;",
    strong: "font-weight:bold;color:#214f45;",
  };
  Object.entries(styles).forEach(([tag, style]) =>
    d.querySelectorAll(tag).forEach((n) => n.setAttribute("style", style)),
  );
  const html = `<section style="font-family:PingFang SC,Arial,sans-serif;padding:8px;">${d.body.innerHTML}</section>`;
  await api("copy", { html, text: d.body.textContent });
  toast("排版已复制；本地图片请在公众号补入");
}
function renderDashboard() {
  const rows = state.metrics.filter(
    (r) => r["账号"] === account || r["账号"] === "金奇_" + account,
  );
  const sum = (k) =>
    rows.some((r) => r[k] !== null)
      ? rows.reduce((s, r) => s + (r[k] || 0), 0).toLocaleString()
      : "—";
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
  $("#main").innerHTML =
    `<header><div><span class="eyebrow">YOUR WRITING, IN PERSPECTIVE</span></div><button id="metrics" class="primary">刷新归档数据</button></header><section class="dashboard"><div class="page-title"><h1>让每一次表达，都有回响。</h1></div><div class="stats">${[
      ["阅读", "总阅读"],
      ["点赞", "总点赞"],
      ["收藏", "总收藏"],
      ["评论", "总评论"],
      ["涨粉", "文章涨粉合计"],
      ["文章", "总文章数量"],
    ]
      .map(
        ([k, l]) =>
          `<div><small>${l}</small><strong title="${k === "涨粉" ? "汇总文章 YAML 的涨粉字段，不是账号净增粉丝，也不是工作台估算" : ""}">${k === "文章" ? rows.length.toLocaleString() : sum(k)}</strong></div>`,
      )
      .join(
        "",
      )}</div><div id="publishing-calendar" class="dashboard-card"></div><div class="dashboard-card"><div class="row performance-head"><h3>文章表现</h3><select id="metrics-sort" aria-label="文章排序方式">${sortKeys.map(([k, l]) => `<option value="${k}" ${metricsSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>${
      rows.length
        ? `<table><thead><tr><th>文章</th><th>日期</th><th>阅读</th><th>点赞</th><th>收藏</th><th>涨粉</th></tr></thead><tbody>${sorted
            .map(
              (r) =>
                `<tr><td>${esc(r["标题"])}</td><td>${esc(r["日期"])}</td><td>${r["阅读"] ?? "—"}</td><td>${r["点赞"] ?? "—"}</td><td>${r["收藏"] ?? "—"}</td><td>${r["涨粉"] ?? "—"}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : '<div class="empty-data">还没有数据。<p>文章归档后，在 YAML 中填写平台数据即可查看。</p></div>'
    }</div></section>`;
  renderCalendar(rows);
  $("#metrics-sort").onchange = (e) => {
    metricsSort = e.target.value;
    renderDashboard();
  };
  $("#metrics").onclick = async () => {
    try {
      const r = await api("metrics");
      if (r) {
        state.metrics = r;
        renderDashboard();
        toast("已重新读取归档 YAML");
      }
    } catch (e) {
      toast(e.message);
    }
  };
}
function renderTopics() {
  const docs = state.documents.filter(
    (d) => d.account === account && d.topics?.length,
  );
  $("#main").innerHTML =
    `<header><span class="eyebrow">IDEAS TO COME BACK TO</span></header><section class="dashboard"><div class="page-title"><h1>值得继续聊的想法。</h1><p>每一个角度都与原来的文章关联，随时回来继续写。</p></div><div class="topic-grid">${docs.map((d) => `<div class="result-card"><h3>${esc(d.title)}</h3><div>${esc(d.topics[0].text)}</div><button class="primary" data-open="${d.id}">继续这篇文章 →</button></div>`).join("") || '<div class="empty-data">打开一篇文章，在「思路」面板生成或讨论选题。</div>'}</div></section>`;
  $$("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        current = state.documents.find((d) => d.id === b.dataset.open);
        page = "write";
        tab = "topics";
        render();
      }),
  );
}
function renderSettings() {
  $("#main").innerHTML =
    `<header><span class="eyebrow">YOUR TOOLS, YOUR CHOICE</span></header><section class="dashboard settings"><h1>连接与存储</h1><p>编辑与保存不依赖 AI 订阅。仅在你调用时连接 Agent。</p><div class="dashboard-card"><h3>Agent 连接</h3><label>默认 Agent<select id="setting-provider"><option value="cursor">Cursor ${state.agents.cursor ? "· 已找到 CLI" : "· 未安装"}</option><option value="codex">Codex ${state.agents.codex ? "· 已找到 CLI" : "· 未安装"}</option></select></label><label>模型（留空沿用 CLI 默认）<input id="model" value="${esc(state.model)}" placeholder="可选模型 ID"></label><p>复用 CLI 登录。若未登录，请先在终端执行 agent login 或 codex login。此版本不保存账号凭据。</p><button class="primary" id="save-settings">保存设置</button></div><div class="dashboard-card"><h3>本地数据</h3>${state.warnings?.length ? `<p class="notice">${state.warnings.map(esc).join("<br>")}</p>` : ""}<p>${esc(state.dataPath)}</p><h3>Content_OS 来源</h3><p>${esc(state.source || "尚未选择")}</p><p>开发阶段直接读写独立副本；正文在 02_Drafts，定稿后移动到 03_Archive，图片在 Attachment/文章名，素材在 00_wiki，版本和对话在 _system/inkdesk。上线后再配置正式目录。</p></div></section>`;
  $("#setting-provider").value = state.provider;
  $("#save-settings").onclick = () => {
    state.provider = $("#setting-provider").value;
    state.model = $("#model").value.trim();
    persist();
    toast("设置已保存");
  };
}
async function refreshVault() {
  if (busy) return toast("AI 正在回复，请结束后刷新");
  sync();
  const apply = (result) => {
    const id = current?.id;
    Object.assign(state, result);
    current =
      state.documents.find((d) => d.id === id) ||
      state.documents.find((d) => d.account === account);
    dirty = false;
    pending = null;
    render();
    toast(
      state.warnings?.length
        ? "部分文件未读取，请在存储设置查看错误"
        : "已读取开发副本",
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
  m.innerHTML = `<div class="dialog"><div class="row"><h2>${esc(rel.split("/").pop())}</h2><button id="close-material">关闭</button></div><div class="material-preview">${safeHTML(body)}</div>${current ? '<p class="notice">选中素材文字后，可将选段插入当前草稿。未选中文字时仅插入素材链接。</p><button id="insert-material" class="primary">插入到草稿末尾</button>' : ""}</div>`;
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
function renderArchive() {
  $("#main").innerHTML =
    `<header><span class="eyebrow">已归档 · 最终版本</span></header><section class="dashboard"><h1>已经写完的文章。</h1><p>金奇 ${account} · 按发布时间从近到远排列</p><table class="archive-table"><thead><tr><th>文章标题</th><th>发布时间</th><th>体裁</th><th>阅读 / 观看</th><th>收藏</th><th>操作</th></tr></thead><tbody>${
      (state.archives || [])
        .filter((d) => d.account === account)
        .sort((a, b) =>
          String(b.fields["发布时间"] || "").localeCompare(
            String(a.fields["发布时间"] || ""),
          ),
        )
        .map(
          (d) =>
            `<tr><td>${esc(d.title)}</td><td>${esc(d.fields["发布时间"] || "尚未填写")}</td><td>${esc(d.fields["体裁"] || "—")}</td><td>${esc(d.fields["观看量"] ?? d.fields["阅读"] ?? "—")}</td><td>${esc(d.fields["收藏"] ?? "—")}</td><td><button data-archive="${esc(d.path)}">查看全文</button></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="6">定稿确认后，文章会出现在这里。</td></tr>'
    }</tbody></table></section>`;
  $$("[data-archive]").forEach(
    (b) =>
      (b.onclick = async () => {
        const d = state.archives.find((d) => d.path === b.dataset.archive);
        const m = document.createElement("div");
        m.className = "modal";
        m.innerHTML = `<div class="dialog"><div class="row"><h2>${esc(d.title)}</h2><button id="close-archive">关闭</button></div><div class="material-preview">${safeHTML(d.body)}</div><button id="copy-archive" class="primary">复制公众号排版</button><button id="archive-history">查看关联记录</button><div id="archive-records"></div></div>`;
        document.body.append(m);
        $("#close-archive").onclick = () => m.remove();
        $("#copy-archive").onclick = () => copyPublish(d);
        $("#archive-history").onclick = async () => {
          try {
            const record = await api("archive-records", d.path);
            $("#archive-records").innerHTML =
              `<h3>版本 ${record.versions.length} · 对话 ${record.conversations.length}</h3>${record.versions.map((v) => `<details><summary>${esc(v.name)} · ${esc(v.at)}</summary><pre>${esc(v.body)}</pre></details>`).join("")}${record.conversations.map((c) => `<details><summary>${esc(c.title)}</summary>${c.messages.map((m) => `<p><b>${m.role === "user" ? "你" : "写作伙伴"}</b>：${esc(m.text)}</p>`).join("")}</details>`).join("")}<p>关联素材：${esc(record.materials.join("、") || "无")}</p>`;
          } catch (e) {
            toast(e.message);
          }
        };
      }),
  );
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
      { type: "referenceTag", attrs: { refId, label: reference.label } },
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
    const refs = await api("project-refs", doc.id);
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><div class="row"><h2>在光标处引用文件</h2><button id="close-picker">关闭</button></div><p>有文件标签时，本次只使用标签中的文件资料。</p><input id="reference-search" placeholder="搜索本项目文件"><div id="reference-options" class="material-cards"></div></div>`;
    document.body.append(m);
    $("#close-picker").onclick = () => m.remove();
    const list = () => {
      $("#reference-options").innerHTML =
        refs
          .filter((r) =>
            r.name
              .toLowerCase()
              .includes($("#reference-search").value.toLowerCase()),
          )
          .map(
            (r) =>
              `<button class="material-card" data-pick-ref="${r.id}" ${r.status === "ready" ? "" : "disabled"}><strong>${esc(r.name)}</strong><small>${r.characters} 字 · ${r.status === "ready" ? "引用此文件" : esc(r.error)}</small></button>`,
          )
          .join("") || "<p>暂无文件，可先从对话框上传。</p>";
      $$("[data-pick-ref]").forEach(
        (b) =>
          (b.onclick = () => {
            const r = refs.find((r) => r.id === b.dataset.pickRef);
            m.remove();
            c.composerPosition = insertionPosition;
            putTag({ kind: "file", fileId: r.id, label: r.name }, doc, c);
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
function openPreview({ title, text, path: rel, reference, doc = current }) {
  $("#reference-drawer")?.remove();
  const n = document.createElement("aside");
  n.id = "reference-drawer";
  n.className = "reference-drawer";
  n.innerHTML = `<div class="row"><h3>${esc(title)}</h3><button id="close-drawer">关闭</button></div>${rel && /\.(png|jpe?g|gif|webp)$/i.test(rel) ? `<img class="preview-image" src="${esc(assetUrl("inkasset://vault/" + encodeURIComponent(rel)))}">` : ""}<pre id="reference-text">${esc(text)}</pre>${reference ? '<div class="drawer-actions"><button id="cite-file">引用文件</button><button id="cite-file-range" class="primary">引用所选文字</button><small>先选中预览文字，可引用对应行。</small></div>' : ""}`;
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
    $("#cite-file-range").onmousedown = (e) => e.preventDefault();
    $("#cite-file-range").onclick = () => {
      const selection = window.getSelection(),
        pre = $("#reference-text");
      if (!selection?.rangeCount || selection.isCollapsed)
        return toast("先在预览中选择文字");
      const range = selection.getRangeAt(0);
      if (
        !pre.contains(range.startContainer) ||
        !pre.contains(range.endContainer)
      )
        return toast("请选择这份素材中的文字");
      const before = range.cloneRange();
      before.selectNodeContents(pre);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().split("\n").length;
      const end =
        start + range.toString().replace(/\n$/, "").split("\n").length - 1;
      putTag(
        {
          kind: "file",
          fileId: reference.id,
          startLine: start,
          endLine: end,
          label: reference.name + " L" + start + "–" + end,
        },
        doc,
      );
      n.remove();
    };
  }
}
async function renderMaterials() {
  const doc = current;
  $("#main").innerHTML =
    `<header><span class="eyebrow">写作项目 · 参考素材</span></header><section class="dashboard"><h1>这篇文章的素材。</h1><div class="row"><select id="material-project">${state.documents
      .filter((d) => d.account === account)
      .map((d) => `<option value="${d.id}">${esc(d.title)}</option>`)
      .join(
        "",
      )}</select><button id="upload-reference" class="primary" ${doc ? "" : "disabled"}>＋ 上传文件</button></div><p>点击卡片在右侧预览；可把文件或选定行引用到对话中。没有文件标签时，AI 使用勾选的项目资料。</p><div id="project-files" class="material-cards"></div><div id="legacy-materials" class="material-cards"></div></section>`;
  $("#material-project").value = doc?.id || "";
  $("#material-project").onchange = (e) => {
    $("#reference-drawer")?.remove();
    current = state.documents.find((d) => d.id === e.target.value);
    renderMaterials();
  };
  if (!doc) {
    $("#project-files").innerHTML = "<p>请先创建一篇草稿。</p>";
    return;
  }
  const draw = (refs) => {
    if (page !== "materials" || current?.id !== doc.id) return;
    $("#project-files").innerHTML =
      refs
        .map(
          (r) =>
            `<article class="material-card"><button class="card-open" data-ref-preview="${r.id}"><span class="file-icon">${esc(r.name.split(".").pop().toUpperCase())}</span><strong>${esc(r.name)}</strong><small>${(r.bytes / 1024).toFixed(1)} KB · ${r.characters} 字</small><p>${r.status === "ready" ? (r.ocr ? "已提取图片文字" : "已提取参考文字") : esc(r.error)}</p></button><label><input type="checkbox" data-ref-toggle="${r.id}" ${r.enabled ? "checked" : ""} ${r.status === "ready" ? "" : "disabled"}> 默认供 AI 参考</label></article>`,
        )
        .join("") || "<p>上传采访稿、报告、图片或其他参考文件。</p>";
    $$("[data-ref-toggle]").forEach(
      (b) =>
        (b.onchange = async () => {
          try {
            draw(
              await api("project-toggle", {
                articleId: doc.id,
                id: b.dataset.refToggle,
                enabled: b.checked,
              }),
            );
          } catch (e) {
            toast(e.message);
          }
        }),
    );
    $$("[data-ref-preview]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const r = await api("project-read", {
              articleId: doc.id,
              id: b.dataset.refPreview,
            });
            openPreview({
              title: r.name,
              text: r.text || r.error,
              path: r.path,
              reference: r.status === "ready" ? r : null,
              doc,
            });
          } catch (e) {
            toast(e.message);
          }
        }),
    );
  };
  $("#upload-reference").onclick = async () => {
    const b = $("#upload-reference");
    b.disabled = true;
    b.textContent = "正在提取文字…";
    try {
      if (!(await persist())) return;
      const list = await uploadProjectFiles(doc.id);
      if (list) draw(list);
    } catch (e) {
      toast(e.message);
    } finally {
      if (b.isConnected) {
        b.disabled = false;
        b.textContent = "＋ 上传文件";
      }
    }
  };
  try {
    draw(await api("project-refs", doc.id));
  } catch (e) {
    toast(e.message);
  }
  if ($("#legacy-materials")) {
    $("#legacy-materials").innerHTML = (doc.materials || [])
      .map(
        (rel) =>
          `<button class="material-card" data-legacy="${esc(rel)}"><strong>${esc(rel.split("/").pop())}</strong><small>此前关联的素材</small></button>`,
      )
      .join("");
    $$("[data-legacy]").forEach(
      (b) =>
        (b.onclick = async () =>
          openPreview({
            title: b.dataset.legacy.split("/").pop(),
            text: await api("material-read", b.dataset.legacy),
            doc,
          })),
    );
  }
}
async function renderProfile() {
  const a = account;
  $("#main").innerHTML = '<section class="dashboard">读取账号模型…</section>';
  try {
    let model = await api("model-load", a);
    if (page !== "profile" || account !== a) return;
    const draw = () => {
      const definition = model.definitions.find((d) => d.id === profileTab);
      $("#main").innerHTML =
        `<header><span class="eyebrow">金奇 ${a} · 账号模型</span></header><section class="dashboard profile-manager"><h1>保持自己的声音，逐步验证有效的表达。</h1><p>固定四个内容模块，一份当前设定。旧文档仅作历史资料，不再与当前设定同时生效。</p><nav class="model-tabs">${[...model.definitions, { id: "history", title: "迭代记录" }].map((d) => `<button data-model-tab="${d.id}" class="${profileTab === d.id ? "active" : ""}">${d.title}</button>`).join("")}</nav><div id="model-content">${
          definition
            ? `<h2>${definition.title}</h2><p>${{ identity: "只维护我是谁、写给谁、希望提供什么价值。", voice: "维护自然的表达偏好与必要边界，避免把每篇文章写成规则检查表。", examples: "保留我认可的真实经历和范文片段，并写清出处与为什么像我。", learning: "用有来源的数据观察指导下一次小实验；最多保留三个，过时就替换。" }[profileTab]}</p><textarea id="model-text" rows="15" maxlength="${definition.limit}">${esc(model.modules[profileTab])}</textarea><div class="row"><button id="save-model" class="primary">保存当前模块</button><small>${definition.limit} 字以内</small></div>${profileTab === "learning" ? `<p class="notice">当前账号有 ${state.metrics.filter((r) => r["账号"] === a).length} 篇归档数据。单篇波动不代表表达方式的因果效果。</p>` : ""}${
                profileTab === "examples"
                  ? `<details><summary>查看旧 Profile 资料（只读）</summary><div class="material-cards">${model.legacy
                      .filter((f) => f.editable)
                      .map(
                        (f) =>
                          `<button class="material-card" data-model-legacy="${esc(f.path)}"><strong>${esc(f.path)}</strong></button>`,
                      )
                      .join("")}</div></details>`
                  : ""
              }`
            : `<button id="iterate-model" class="primary">✧ 根据新文章和数据提出调整</button><p>向当前 ${esc(state.provider)} 提供本账号模型、最近 12 篇文章及 YAML；长文每篇前 3000 字。只建议替换现有模块内容。</p><div>${model.proposals.map((p) => `<div class="result-card"><small>${esc(p.at)} · ${p.status === "pending" ? "待审阅" : p.status === "applied" ? "已采纳" : "已保留原设定"}</small><p>${p.changes.map((c) => esc(model.definitions.find((d) => d.id === c.module)?.title)).join("、")}</p><button data-model-proposal="${p.id}">查看建议</button></div>`).join("") || "<p>还没有 AI 调整建议。</p>"}</div><h3>历史版本</h3>${model.history.map((h) => `<div class="result-card"><small>${esc(h.at)} · ${esc(h.reason)}</small><details><summary>查看当时的设定</summary><pre>${esc(model.definitions.map((d) => d.title + "\n" + h.modules[d.id]).join("\n\n"))}</pre></details><button data-model-restore="${h.id}">恢复此版本</button></div>`).join("")}`
        }</div></section>`;
      const save = async () => {
        if (!definition || $("#model-text").value === model.modules[profileTab])
          return true;
        try {
          model = await api("model-save", {
            account: a,
            hash: model.hash,
            modules: { ...model.modules, [profileTab]: $("#model-text").value },
          });
          toast("当前设定已保存，上一版已留存");
          return true;
        } catch (e) {
          toast(e.message);
          return false;
        }
      };
      saveProfileEditor = save;
      $$("[data-model-tab]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (!(await save())) return;
            profileTab = b.dataset.modelTab;
            draw();
          }),
      );
      if ($("#save-model")) $("#save-model").onclick = save;
      $$("[data-model-legacy]").forEach(
        (b) =>
          (b.onclick = async () => {
            const f = await api("profile-read", {
              account: a,
              path: b.dataset.modelLegacy,
            });
            openPreview({ title: f.path, text: f.text });
          }),
      );
      $$("[data-model-proposal]").forEach(
        (b) =>
          (b.onclick = () =>
            showModelProposal(
              model.proposals.find((p) => p.id === b.dataset.modelProposal),
              model,
            )),
      );
      $$("[data-model-restore]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              model = await api("model-restore", {
                account: a,
                hash: model.hash,
                id: b.dataset.modelRestore,
              });
              draw();
              toast("已恢复；恢复前的设定也已保留");
            } catch (e) {
              toast(e.message);
            }
          }),
      );
      if ($("#iterate-model"))
        $("#iterate-model").onclick = async () => {
          if (busy) return toast("请等待当前 AI 任务");
          const b = $("#iterate-model");
          busy = true;
          b.disabled = true;
          b.textContent = "正在生成调整建议…";
          try {
            if (!(await persist())) return;
            const proposal = await api("agent", {
              provider: state.provider,
              model: state.model,
              account: a,
              task: "model-iterate",
              body: "",
              instruction:
                "让表达更符合我实际写出的文章，并根据原始数据提出少量可检验的调整。",
            });
            model = await api("model-load", a);
            showModelProposal(proposal, model);
          } catch (e) {
            toast(e.message);
          } finally {
            busy = false;
            if (b.isConnected) {
              b.disabled = false;
              b.textContent = "✧ 根据新文章和数据提出调整";
            }
          }
        };
    };
    draw();
  } catch (e) {
    toast(e.message);
  }
}
function showModelProposal(p, model) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="dialog proposal-dialog"><div class="row"><h2>调整现有账号模块</h2><button id="close-model-proposal">关闭</button></div>${p.changes
    .map(
      (c) =>
        `<h3>${esc(model.definitions.find((d) => d.id === c.module).title)}</h3><p>${esc(c.reason)}</p><small>来源：${c.sources.map(esc).join("；")}</small><details><summary>查看差异</summary><div class="diff">${diffWords(
          c.before,
          c.content,
        )
          .map(
            (x) =>
              `<${x.added ? "ins" : x.removed ? "del" : "span"}>${esc(x.value)}</${x.added ? "ins" : x.removed ? "del" : "span"}>`,
          )
          .join(
            "",
          )}</div></details><textarea data-model-edit="${c.module}" rows="8" ${p.status !== "pending" ? "readonly" : ""}>${esc(c.content)}</textarea>`,
    )
    .join(
      "",
    )}${p.status === "pending" ? '<div class="row"><button id="reject-model">保留原设定</button><button id="apply-model" class="primary">采纳修改</button></div>' : ""}</div>`;
  document.body.append(m);
  $("#close-model-proposal").onclick = () => m.remove();
  const decide = async (apply) => {
    try {
      await api("model-decide", {
        account: p.account,
        id: p.id,
        apply,
        edits: Object.fromEntries(
          $$("[data-model-edit]").map((x) => [x.dataset.modelEdit, x.value]),
        ),
      });
      m.remove();
      if (page === "profile") renderProfile();
    } catch (e) {
      toast(e.message);
    }
  };
  if ($("#apply-model")) {
    $("#apply-model").onclick = () => decide(true);
    $("#reject-model").onclick = () => decide(false);
  }
}

function renderCalendar(rows) {
  const local = new Date(),
    today = [
      local.getFullYear(),
      String(local.getMonth() + 1).padStart(2, "0"),
      String(local.getDate()).padStart(2, "0"),
    ].join("-");
  const years = [
    ...new Set([
      local.getFullYear(),
      ...rows
        .map((r) => validDate(r["日期"]))
        .filter(Boolean)
        .map((d) => +d.slice(0, 4)),
    ]),
  ].sort((a, b) => b - a);
  const c = calendar(rows, heatmapYear, today);
  const node = $("#publishing-calendar");
  if (!node) return;
  /** 生成热力格悬停提示：日期、篇数与当日文章标题 */
  const heatTip = (d) => {
    const head = `${d.date}${d.date === today ? " · 今天" : ""} · ${d.count} 篇${d.future ? "（未来日期）" : ""}`;
    return d.titles.length ? head + "\n" + d.titles.join("\n") : head;
  };
  const summary = publishSummary(rows, today);
  const summaryText = summary
    ? `您已写作 ${summary.writingDays} 天，共发布 ${summary.published} 篇，平均 ${summary.avgDays} 天发布一篇，上一次更新是在 ${summary.daysSinceLast} 天前`
    : "暂无有效发布记录";
  node.innerHTML = `<div class="row"><h3>发布热力图</h3><select id="heatmap-year" aria-label="热力图年份">${years.map((y) => `<option ${y === heatmapYear ? "selected" : ""}>${y}</option>`).join("")}</select></div><p>${summaryText}</p><div class="heatmap-scroll"><div class="heatmap-grid" role="group" aria-label="每日发布数量">${"<span></span>".repeat(c.offset)}${c.days.map((d) => `<button class="heatmap-day level-${Math.min(d.count, 4)} ${d.future ? "future" : ""} ${d.date === today ? "is-today" : ""}" ${d.date === today ? 'aria-current="date"' : ""} data-heat-date="${d.date}" title="${esc(heatTip(d))}" aria-label="${esc(heatTip(d).replace(/\n/g, "，"))}"></button>`).join("")}</div></div>`;
  $("#heatmap-year").onchange = (e) => {
    heatmapYear = +e.target.value;
    renderCalendar(rows);
  };
}
window.addEventListener("beforeunload", () => {
  sync();
  if (dirty) window.desk.flush(state);
});
state = await api("load");
current = state.documents.find((d) => d.account === account);
render();
