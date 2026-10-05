import { mountAgentUsage } from "./agent-usage-ui.js";
import { toolBlockHtml, activityLine } from "./ui/tool-block.js";
import { $,
  $$,
  api,
  esc,
  formatBytes,
  toast,
  hideToast,
  isWeb,
  assetUrl,
} from "./ui/dom.js";
import { mountSkillsSettings, skillAvailableFor } from "./skills-ui.js";
import { bindSocialPreview } from "./social-layout.js";
import { Composer, referenceChipHTML } from "./composer.js";
import { I } from "./icons.js";
import { asterHtml, mountAster, setAsterState } from "./aster.js";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { gfm } from "turndown-plugin-gfm";
import TurndownService from "turndown";
import { calendar, validDate, publishSummary } from "./calendar.cjs";
import {
  promptText,
  askText,
  askConfirm,
  askCreateAccount,
  askAccountMode,
} from "./ui/dialog.js";
import { showContextMenu } from "./ui/popover.js";
import {
  groupNames,
  groupChipTone,
  groupChipHtml,
  publishedGroup,
  backupPathFor,
  groupOptionsHtml,
} from "./ui/groups.js";
import { draftsSidebarHtml, draftProjectOf } from "./ui/draft-projects.js";
import { createDocStore } from "./store/doc-store.js";
import { time } from "./ui/perf.js";
import {
  sameAccount,
  accountInitial,
  accountLabelOf,
  accountAvatarHtml,
  accountModeOf,
  accountModeLabel,
  normalizeAccountMode,
} from "./ui/accounts.js";
import { formatJsonPreview, inferMaterialKind, uint8ToBase64 } from "./ui/materials-meta.js";
import { formatDelta } from "./ui/metrics.js";
import { resolveBackupPlan } from "./services/backup-plan.js";
import {
  blockPlainText,
  sanitizeRichHTML,
  splitWechatH1,
  safeHTML,
  sanitizeHtmlPreview,
} from "./ui/html.js";
import { publishHTMLInner } from "./ui/publish.js";
import { showUnmatchedMatcher } from "./ui/import-match.js";
import {
  materialPreviewCardHTML,
  materialDrawerBodyHTML,
} from "./ui/materials-view.js";
import { conversation } from "./ui/conversation.js";
import {
  AGENT_PROVIDERS,
  settingsSection,
  settingsPanel,
  settingsField,
  agentLogoSvg,
  agentInstalled,
  ensureAgentsEnabledStore,
  agentEnabled,
  installedAgentProviders,
  selectableAgentProviders,
  railProviderId,
  railModelLabel,
  ensureAgentModelsStore,
  getAgentModelList,
  setAgentModelList,
  agentSuggestionIds,
  agentListItemHtml,
  agentModelsPanelHtml,
  getAgentHttp,
  setAgentHttp,
  removeAgentHttp,
  ensureAgentHttpStore,
  connectedAgentProviders,
  providerMeta,
} from "./ui/agent-store.js";
import {
  promptConnectProvider,
  addProviderFromCatalog,
} from "./ui/provider-connect.js";
import {
  WECHAT_BLUE,
  WECHAT_BLUE_SOFT,
  WECHAT_SERIF,
  WECHAT_SERIF_PUBLISH,
  WECHAT_SANS,
  WECHAT_BLOCK_W,
  WECHAT_BLOCK_SCALE,
  normalizeHeadingText,
  wechatWrapLines,
  wechatBlockCanvas,
  renderWechatH1Png,
  renderWechatH2Png,
  renderWechatQuotePng,
  replaceWithWechatBlockImage,
} from "./ui/wechat-png.js";
import {
  diffHTML,
  buildEditHunks,
  composeHunks,
  protectStructure,
  summarizeRewrite,
  reviewPlainHTML,
  reviewNewHTML,
  reviewOldDiffHTML,
  reviewEqualHTML,
  reviewPageHTML,
  reviewCardHTML,
  reviewProgress,
} from "./ui/review-diff.js";
import reviewDemoFixture from "./fixtures/review-demo.json";
let saveProfileEditor = null;
let composer = null,
  profileTab = "identity",
  /** 账号详情子页：详情(人设) | 设定 | 技能 */
  accountDetailTab = "detail";
let heatmapYear = new Date().getFullYear();
let metricsSort = "阅读";
/** 仪表盘已发布文章多选路径 */
let publishedSelection = new Set();
let materialsFilter = "all";
/** 文档保存协议：防抖 timer 与冲突标志由 store 拥有 */
const docStore = createDocStore({
  getState: () => state,
  getCurrent: () => current,
  isReviewDemo: () => reviewDemoActive,
  isDirty: () => dirty,
  setDirty: (v) => {
    dirty = v;
  },
  api,
  toast,
  setSavedStatus,
  onExternalConflict: (msg) => showSaveConflictDialog(msg),
  queryCard: (id) => document.querySelector('[data-id="' + id + '"]'),
});
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

/** 上传项目参考文件（网页用文件选择，桌面走原生对话框；可传入拖拽文件） */
async function uploadProjectFiles(docId, droppedFiles) {
  const list = droppedFiles?.length ? [...droppedFiles] : null;
  if (list?.length) {
    if (!isWeb() && window.desk?.pathForFile) {
      const filePaths = list
        .map((f) => window.desk.pathForFile(f))
        .filter(Boolean);
      if (filePaths.length)
        return api("project-upload", { id: docId, filePaths });
    }
    const files = await Promise.all(
      list.map(async (f) => ({
        name: f.name,
        bytes: [...new Uint8Array(await f.arrayBuffer())],
      })),
    );
    return api("project-upload", { id: docId, files });
  }
  if (!isWeb()) return api("project-upload", docId);
  const picked = await pickFiles({ multiple: true });
  if (!picked.length) return null;
  const files = await Promise.all(
    picked.map(async (f) => ({
      name: f.name,
      bytes: [...new Uint8Array(await f.arrayBuffer())],
    })),
  );
  return api("project-upload", { id: docId, files });
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
let state,
  editor,
  page = "dashboard",
  tab = "chat",
  account = "",
  /** 设置页子 Tab：配置 | 账号 */
  settingsTab = "config",
  /** 模型设置子页：当前打开的 Agent id，null 为总览 */
  agentDetailId = null,
  /** 模型子页 Tab：连接 | 使用统计 */
  agentDetailTab = "connection",
  current,
  busy = false,
  pending = null,
  sourceFiles = [],
  selectedText = "",
  selectionContext = null,
  selectionDragging = false,
  dirty = false,
  /** Agent 输出模式：对话 | 编辑全文 */
  agentMode = "chat";
/** 侧栏草稿项目文件夹（含空目录），按当前账号缓存 */
let draftProjects = [];
/** 侧栏已收起的项目名 */
let collapsedProjects = new Set();
/** 流式输出：当前累积文本与订阅卸载函数 */
let streamText = "",
  /** 流式消息是否处于思考等待期（未收到首个文本块） */
  streamThinking = false,
  unsubProgress = null,
  /** 本次任务收到的 tool 事件（按 id 去重，流式展示用，不持久化） */
  streamTools = [],
  unsubAgentEvent = null,
  /** 审阅模式：改后稿落正文后，逐条对比审阅 */
  reviewMode = false,
  reviewIndex = 0;
/** 开发环境审阅 UI 演示：用固定范例进入审阅，不写回仓库 */
let reviewDemoActive = false;
let editorHTML = "";
let previewMode = false;
let previewDocId = null;
let socialPreviewCtl = null;
/** 预览子分栏：公众号 / 小红书 */
let previewPane = "wechat";
/** 仪表盘已发布文章的排版预览（path/title/body） */
let publishedPreview = null;
/** 写作伙伴侧栏是否展开；仅草稿写作可用，默认收起 */
let assistantOpen = false;
/** 右侧栏模式：写作伙伴 / 本文素材 */
let railMode = "assistant";
/** 文章大纲面板是否打开（关闭时为与 byline 同宽的小卡片） */
let outlineOpen = false;
/** 文章大纲是否展开全部层级（默认仅最高级） */
let outlineExpanded = false;
/** 磁盘冲突中：抑制重复 toast，直到用户刷新或放弃（标志位由 docStore 拥有） */
/** Aster FAB 卸载（眨眼 / 视线跟随） */
let unmountAster = null;
/** 侧栏头像 Aster 卸载 */
let unmountAsterRail = null;

/**
 * 当前仓库已注册账号列表。
 */
function accountList() {
  return state?.accounts || [];
}

/** 当前账号模式（缺省小红书）。 */
function currentAccountMode() {
  return accountModeOf(accountList(), account);
}

/** 当前是否为 X 模式账号。 */
function isXAccount() {
  return currentAccountMode() === "x";
}


/**
 * 打开账号详情页并切到指定子 tab。
 * @param {string} accountId
 * @param {"detail"|"settings"|"skills"} [tab]
 */
async function openAccountDetail(accountId, tab = "detail") {
  if (page === "account" && saveProfileEditor && !(await saveProfileEditor()))
    return;
  account = accountId;
  accountDetailTab = tab;
  page = "account";
  render();
}


/**
 * 保证当前选中账号仍在列表中。
 */
function ensureAccount() {
  const list = accountList();
  if (!list.length) {
    account = "";
    return;
  }
  const hit = list.find((a) => sameAccount(a.id, account));
  account = hit ? hit.id : list[0].id;
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
/**
 * 标题内 Shift+Enter（&lt;br&gt;）用 HTML 原样保留，避免 ATX 标题把软换行吃掉。
 * 忽略 ProseMirror 自动追加的 trailingBreak。
 */
td.addRule("headingSoftBreak", {
  filter: (node) => {
    if (!/^H[1-6]$/.test(node.nodeName)) return false;
    const brs = node.querySelectorAll?.("br");
    if (!brs || !brs.length) return false;
    for (let i = 0; i < brs.length; i++) {
      const cls = brs[i].getAttribute?.("class") || "";
      if (!cls.includes("ProseMirror-trailingBreak")) return true;
    }
    return false;
  },
  replacement: (_content, node) => {
    const level = node.nodeName.charAt(1);
    const clone = node.cloneNode(true);
    const brs = clone.querySelectorAll("br");
    for (let i = brs.length - 1; i >= 0; i--) {
      const cls = brs[i].getAttribute?.("class") || "";
      if (cls.includes("ProseMirror-trailingBreak"))
        brs[i].parentNode?.removeChild(brs[i]);
    }
    if (!clone.querySelector("br")) {
      const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
      return `\n\n${"#".repeat(+level)} ${text}\n\n`;
    }
    const els = clone.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      els[i].removeAttribute("class");
      els[i].removeAttribute("style");
      els[i].removeAttribute("id");
      els[i].removeAttribute("draggable");
    }
    return `\n\n<h${level}>${clone.innerHTML}</h${level}>\n\n`;
  },
});






/**
 * 预览用正文 HTML：优先编辑器快照（保留标题软换行与原始图片地址）。
 * @returns {string}
 */
function articleSourceHTML() {
  if (current?.richHTML) return sanitizeRichHTML(current.richHTML);
  return safeHTML(current?.body || "");
}



/**
 * 补全预览字段：类型、图片地址、文本摘要。
 * @param {object} r
 */
async function hydrateMaterialPreview(r) {
  const kind = r.kind || inferMaterialKind(r.name);
  const asset =
    r.asset ||
    (kind === "image" && r.path
      ? "inkasset://vault/" + encodeURIComponent(r.path)
      : "");
  if (kind === "image") return { ...r, kind, asset };
  if (r.preview) return { ...r, kind, asset };
  try {
    const full = await api("materials-read", r.id);
    return {
      ...r,
      ...full,
      kind: full.kind || kind,
      asset: full.asset || asset,
      preview: String(full.text || "").slice(0, 600),
    };
  } catch {
    return { ...r, kind, asset };
  }
}


/**
 * 保存当前仓库快照（防抖由 docStore 拥有，见 store/doc-store.js）。
 * @returns {Promise<boolean>}
 */
async function persist() {
  return docStore.persist();
}

/**
 * 在 byline 字数旁显示保存状态；空字符串时隐藏。
 * @param {string} text
 */
function setSavedStatus(text) {
  const n = $("#saved");
  if (!n) return;
  n.textContent = text;
  n.hidden = !text;
}

/**
 * 磁盘与编辑器内容冲突时，只提示一次并引导刷新。
 * @param {string} msg
 */
function showSaveConflictDialog(msg) {
  if (docStore.saveConflict) return;
  docStore.saveConflict = true;
  setSavedStatus("保存已暂停");
  toast("保存失败：" + msg);
  if ($("#save-conflict-modal")) return;
  const m = document.createElement("div");
  m.id = "save-conflict-modal";
  m.className = "modal";
  m.innerHTML =
    '<div class="dialog"><h2>文章已在外部修改</h2><p>磁盘上的草稿与当前编辑器不一致。继续自动保存会覆盖外部改动，因此已暂停保存。</p><p class="muted">常见原因：在 Obsidian / 其他编辑器中改过同一篇，或另一窗口也打开了 Aster*。</p><div class="row"><button type="button" id="conflict-keep">先留在编辑器</button><button type="button" id="conflict-reload" class="primary">备份未保存内容并刷新</button></div></div>';
  document.body.append(m);
  $("#conflict-keep").onclick = () => m.remove();
  $("#conflict-reload").onclick = async () => {
    try {
      const result = await api("recover-refresh", state);
      docStore.saveConflict = false;
      m.remove();
      await applyAccountState(result);
      toast("已从磁盘重新加载");
    } catch (err) {
      toast(err.message);
    }
  };
}
function changed() {
  docStore.markChanged();
}
function newDoc() {
  if (!account) return toast("请先在设置中添加账号");
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
    const html = editor.getHTML();
    current.richHTML = html;
    current.body = td.turndown(html);
    editorHTML = html;
  }
}
function render() {
  saveProfileEditor = null;
  if (!pending || pending.doc !== current?.id) {
    reviewMode = false;
    reviewIndex = 0;
  }
  $("#reference-drawer")?.remove();
  $("#published-drawer")?.remove();
  $("#topic-drawer")?.remove();
  $("#outline-popover")?.remove();
  removeArticleOutline();
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }
  if (page !== "write") {
    previewMode = false;
    previewDocId = null;
  }
  if (page !== "published-preview") publishedPreview = null;
  $("#app").innerHTML =
    `<aside class="sidebar"><div class="account">${
      accountList()
        .map(
          (a) =>
            `<button type="button" class="account-avatar-btn ${sameAccount(account, a.id) ? "active" : ""}" data-account="${esc(a.id)}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${accountAvatarHtml(a)}</button>`,
        )
        .join("") || `<p class="account-empty">请在设置中添加账号</p>`
    }</div><nav><button data-page="dashboard" class="${page === "dashboard" || page === "published-preview" ? "chosen" : ""}">${I.dashboard()} <span>仪表盘</span></button><button data-page="topics" class="${page === "topics" ? "chosen" : ""}">${I.lightbulb()} <span>灵感库</span></button><button data-page="materials" class="${page === "materials" ? "chosen" : ""}">${I.library()} <span>素材库</span></button><button data-page="settings" class="${page === "settings" || page === "account" ? "chosen" : ""}">${I.settings()} <span>设置</span></button></nav><div class="list-head">我的草稿 <span class="list-head-actions"><button type="button" id="new-folder" title="新建文件夹" aria-label="新建文件夹">${I.folderClosed({ size: 16 })}</button><button type="button" id="new" title="新建文章" aria-label="新建文章">${I.plus()}</button></span></div><div class="docs" data-drop-project="">${draftsSidebarHtml(
      state.documents.filter(
        (d) =>
          sameAccount(d.account, account) &&
          d.status !== "final" &&
          d.status !== "archive",
      ),
      current?.id,
      {
        closed: I.folderClosed({
          size: 14,
          stroke: 1.75,
          className: "docs-project-icon",
        }),
        open: I.folder({
          size: 14,
          stroke: 1.75,
          className: "docs-project-icon",
        }),
      },
      { collapsed: collapsedProjects, projects: draftProjects },
    )}</div></aside><main id="main"></main><div class="workspace-resizer hidden" id="workspace-resizer" title="拖动调整宽度"></div><aside class="assistant hidden" id="rail"></aside>`;
  unmountAster?.();
  unmountAster = null;
  clearAsterRail();
  if (page === "write") renderWrite();
  else if (page === "dashboard") renderDashboard();
  else if (page === "published-preview") renderPublishedPreview();
  else if (page === "topics") renderTopics();
  else if (page === "materials") renderMaterials();
  else if (page === "account") renderAccountDetail();
  else if (page === "agent") renderAgentDetail();
  else renderSettings();
  // 写作预览 / 已发布预览自行收起侧栏并绑定小红书；勿再 destroy 掉进行中的排版
  if (page !== "write" && page !== "published-preview") renderAssistantRail();
  bindWorkspaceResize();
  $$("[data-page]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "account" &&
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
  $$("[data-account]").forEach((b) => {
    b.onclick = async () => {
      if (
        page === "account" &&
        saveProfileEditor &&
        !(await saveProfileEditor())
      )
        return;
      sync();
      persist();
      account = b.dataset.account;
      publishedSelection = new Set();
      current = state.documents.find((d) => sameAccount(d.account, account));
      pending = null;
      loadCollapsedProjects();
      await refreshDraftProjects();
      render();
    };
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const id = b.dataset.account;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "详情",
          run: () => openAccountDetail(id, "detail"),
        },
        {
          label: "设定",
          run: () => openAccountDetail(id, "settings"),
        },
        {
          label: "技能",
          run: () => openAccountDetail(id, "skills"),
        },
      ]);
    };
  });
  $$("[data-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          page === "account" &&
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
  $("#new-folder")?.addEventListener("click", () => createDraftFolder());
  bindDraftProjectUi();
  $$(".doc").forEach((b) => {
    b.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "删除草稿",
          danger: true,
          run: () => deleteDraft(b.dataset.id),
        },
      ]);
    };
  });
}

/**
 * 读取当前账号侧栏文件夹收起状态。
 */
function loadCollapsedProjects() {
  try {
    const raw = localStorage.getItem(
      "inkdesk-draft-collapsed:" + (account || ""),
    );
    collapsedProjects = new Set(JSON.parse(raw || "[]"));
  } catch {
    collapsedProjects = new Set();
  }
}

/**
 * 持久化侧栏文件夹收起状态。
 */
function saveCollapsedProjects() {
  try {
    localStorage.setItem(
      "inkdesk-draft-collapsed:" + (account || ""),
      JSON.stringify([...collapsedProjects]),
    );
  } catch {
    /* ignore */
  }
}

/**
 * 刷新当前账号的草稿项目文件夹列表。
 */
async function refreshDraftProjects() {
  if (!account) {
    draftProjects = [];
    return;
  }
  try {
    draftProjects = (await api("draft-projects", { account })) || [];
  } catch {
    draftProjects = [];
  }
}

/**
 * 绑定侧栏项目展开/收起、右键删除、拖拽移动。
 */
function bindDraftProjectUi() {
  $$("[data-toggle-project]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.dataset.toggleProject;
      if (!name) return;
      if (collapsedProjects.has(name)) collapsedProjects.delete(name);
      else collapsedProjects.add(name);
      saveCollapsedProjects();
      const project = btn.closest(".docs-project");
      const collapsed = collapsedProjects.has(name);
      project?.classList.toggle("is-collapsed", collapsed);
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.title = collapsed ? "展开" : "收起";
      btn.querySelector(".lucide")?.remove();
      btn.insertAdjacentHTML(
        "afterbegin",
        collapsed
          ? I.folderClosed({
              size: 14,
              stroke: 1.75,
              className: "docs-project-icon",
            })
          : I.folder({
              size: 14,
              stroke: 1.75,
              className: "docs-project-icon",
            }),
      );
    };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.dataset.toggleProject;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "删除文件夹",
          danger: true,
          run: () => deleteDraftFolder(name),
        },
      ]);
    };
  });

  $$(".doc[draggable]").forEach((b) => {
    b.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/inkdesk-doc", b.dataset.id);
      e.dataTransfer.setData("text/plain", "inkdesk-doc:" + b.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      b.classList.add("dragging");
    });
    b.addEventListener("dragend", () => {
      b.classList.remove("dragging");
      $$(".is-drop-target").forEach((el) =>
        el.classList.remove("is-drop-target"),
      );
    });
  });

  const dropTargets = [
    $(".docs"),
    ...$$(".docs-project[data-drop-project]"),
  ].filter(Boolean);
  for (const el of dropTargets) {
    el.addEventListener("dragenter", (e) => {
      if (!isDraftDocDrag(e)) return;
      e.preventDefault();
      el.classList.add("is-drop-target");
    });
    el.addEventListener("dragover", (e) => {
      if (!isDraftDocDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("is-drop-target");
    });
    el.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.classList.remove("is-drop-target");
    });
    el.addEventListener("drop", async (e) => {
      if (!isDraftDocDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("is-drop-target");
      const id =
        e.dataTransfer.getData("text/inkdesk-doc") ||
        String(e.dataTransfer.getData("text/plain") || "").replace(
          /^inkdesk-doc:/,
          "",
        );
      if (!id) return;
      const project =
        el.dataset.dropProject === undefined ? "" : el.dataset.dropProject;
      await moveDraftToProject(id, project || null);
    });
  }
}

function isDraftDocDrag(e) {
  const types = [...(e.dataTransfer?.types || [])];
  return types.includes("text/inkdesk-doc") || types.includes("text/plain");
}

/**
 * 新建草稿项目文件夹。
 */
async function createDraftFolder() {
  if (!account) return toast("请先在设置中添加账号");
  const name = await promptText("新建文件夹", {
    placeholder: "例如：AI游戏系列",
    okLabel: "创建",
  });
  if (!name) return;
  sync();
  try {
    await persist();
    const result = await api("draft-project-create", { account, name });
    Object.assign(state, result);
    await refreshDraftProjects();
    collapsedProjects.delete(result.project || name);
    saveCollapsedProjects();
    render();
    toast("已创建文件夹");
  } catch (e) {
    toast(e.message);
  }
}

/**
 * 删除草稿项目文件夹（先确认是否清除其中文件）。
 * @param {string} name
 */
async function deleteDraftFolder(name) {
  if (!account || !name) return;
  const count = state.documents.filter(
    (d) =>
      sameAccount(d.account, account) &&
      d.status !== "final" &&
      d.status !== "archive" &&
      draftProjectOf(d) === name,
  ).length;
  const ok = count
    ? await askConfirm(
        "删除文件夹",
        `「${name}」内有 ${count} 篇草稿。删除文件夹将同时清除其中全部文件，且不可恢复。确定继续？`,
      )
    : await askConfirm("删除文件夹", `确定删除空文件夹「${name}」？`);
  if (!ok) return;
  sync();
  try {
    await persist();
    const result = await api("draft-project-delete", { account, name });
    Object.assign(state, result);
    if (current && draftProjectOf(current) === name) {
      current =
        state.documents.find((d) => sameAccount(d.account, account)) ||
        state.documents[0] ||
        null;
      page = current ? "write" : "dashboard";
    }
    collapsedProjects.delete(name);
    saveCollapsedProjects();
    await refreshDraftProjects();
    dirty = false;
    pending = null;
    render();
    toast(count ? `已删除文件夹及 ${count} 篇草稿` : "已删除文件夹");
  } catch (e) {
    toast(e.message);
  }
}

/**
 * 拖拽移动草稿到项目（null/空 = 根目录）。
 * @param {string} id
 * @param {string|null} project
 */
async function moveDraftToProject(id, project) {
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  const currentProject = draftProjectOf(doc);
  const next = project || null;
  if ((currentProject || null) === next) return;
  sync();
  try {
    await persist();
    const result = await api("draft-move", { id, project: next });
    Object.assign(state, result);
    current = state.documents.find((d) => d.id === id) || current;
    await refreshDraftProjects();
    if (next) {
      collapsedProjects.delete(next);
      saveCollapsedProjects();
    }
    dirty = false;
    render();
    toast(next ? `已移到「${next}」` : "已移到根目录");
  } catch (e) {
    toast(e.message);
  }
}

/**
 * Composer「+」菜单：添加文件 / 素材，以及本次技能开关（GPT 风格分区）。
 * @param {HTMLElement} anchor
 */
async function openComposerAddMenu(anchor) {
  if ($("#composer-add-menu")) {
    dismissActiveComposerMenu();
    $("#composer-add-menu")?.remove();
    return;
  }
  dismissActiveComposerMenu();

  const doc = current;
  const acc = doc?.account || account;
  /** @type {{ id: string, name: string, description?: string }[]} */
  let skills = [];
  try {
    const data = await api("skills-list", { account: acc });
    skills = (data.items || [])
      .filter((x) =>
        skillAvailableFor(x.binding ?? data.bindings?.[x.id], data.account),
      )
      .sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), "zh"),
      );
  } catch (e) {
    /* 技能加载失败时仍可添加文件 */
  }

  const skillRows = skills.length
    ? skills
        .map(
          (x) =>
            `<button type="button" class="composer-add-item" data-skill-id="${esc(x.id)}" data-skill-name="${esc(x.name)}" title="${esc(x.description || x.name)}">${I.sparkles({ size: 16 })}<span class="composer-add-item-text"><span class="composer-add-item-title">${esc(x.name)}</span>${x.description ? `<span class="composer-add-item-hint">${esc(x.description)}</span>` : ""}</span></button>`,
        )
        .join("")
    : `<p class="composer-add-empty">暂无可用技能</p>`;

  const menu = document.createElement("div");
  menu.id = "composer-add-menu";
  menu.className = "composer-add-menu";
  menu.innerHTML = `
    <div class="composer-add-section-label">添加</div>
    <button type="button" class="composer-add-item" data-add="local">${I.paperclip({ size: 16 })}<span class="composer-add-item-text"><span class="composer-add-item-title">本地文件</span><span class="composer-add-item-hint">从电脑选择文件</span></span></button>
    <button type="button" class="composer-add-item" data-add="library">${I.library({ size: 16 })}<span class="composer-add-item-text"><span class="composer-add-item-title">素材库</span><span class="composer-add-item-hint">引用已有素材</span></span></button>
    <div class="composer-add-section-label">技能</div>
    <div class="composer-add-skills">${skillRows}</div>`;
  document.body.append(menu);

  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    let top = rect.top - mh - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - mh - 8);
    menu.style.left = left + "px";
    menu.style.top = Math.max(8, top) + "px";
  };
  place();

  /** @type {((e: Event) => void) | null} */
  let onDocPointer = null;
  const close = () => {
    menu.remove();
    if (onDocPointer) {
      document.removeEventListener("pointerdown", onDocPointer, true);
      onDocPointer = null;
    }
    if (activeComposerMenuDismiss === close) activeComposerMenuDismiss = null;
  };
  activeComposerMenuDismiss = close;
  onDocPointer = (ev) => {
    if (menu.contains(/** @type {Node} */ (ev.target))) return;
    if (anchor.contains(/** @type {Node} */ (ev.target))) return;
    close();
  };
  document.addEventListener("pointerdown", onDocPointer, true);

  menu.querySelector('[data-add="local"]').onclick = (e) => {
    e.stopPropagation();
    close();
    uploadChatFiles();
  };
  menu.querySelector('[data-add="library"]').onclick = (e) => {
    e.stopPropagation();
    close();
    chooseChatFile();
  };
  menu.querySelectorAll("[data-skill-id]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const skillId = btn.getAttribute("data-skill-id") || "";
      const name = btn.getAttribute("data-skill-name") || skillId;
      if (!skillId) return;
      close();
      putTag({ kind: "skill", skillId, label: name });
    };
  });
}

/**
 * 删除指定草稿，并刷新界面。
 * @param {string} id
 */
async function deleteDraft(id) {
  if (busy) return toast("请等待 AI 完成后再删除");
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  if (!confirm(`确定删除草稿「${doc.title}」？此操作不可恢复。`)) return;
  sync();
  try {
    await persist();
    const result = await api("draft-delete", id);
    Object.assign(state, result);
    if (current?.id === id) {
      current =
        state.documents.find((d) => sameAccount(d.account, account)) ||
        state.documents[0] ||
        null;
      page = current ? "write" : "dashboard";
    }
    dirty = false;
    pending = null;
    render();
    toast("草稿已删除");
  } catch (e) {
    toast(e.message);
  }
}


/**
 * 增强公众号预览 DOM：中英标题拆分，并写入关键元素内联样式（避免 CSS 缓存/继承干扰）。
 */
function enhanceWechatPreview(root = $("#article-preview")) {
  if (!root) return;
  root.querySelectorAll("h1").forEach(splitWechatH1);
  const h2Style = `display:inline-block;max-width:100%;box-sizing:border-box;margin:16px 0 14px;padding:8px 10px;background:${WECHAT_BLUE};color:#ffffff;font-family:${WECHAT_SERIF};font-size:20px;font-weight:800;line-height:1.25;`;
  root.querySelectorAll("h2").forEach((h2) => {
    h2.setAttribute("style", h2Style);
    // 子节点（如 strong）不得继承正文黑字/无衬线，否则看起来像「二级标题没变」
    h2.querySelectorAll("*").forEach((el) => {
      el.setAttribute(
        "style",
        `color:#ffffff;font-family:${WECHAT_SERIF};font-size:20px;font-weight:800;`,
      );
    });
  });
  root.querySelectorAll("blockquote").forEach((bq) => {
    bq.setAttribute(
      "style",
      `display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:start;border:0;margin:20px 0;padding:8px;background:${WECHAT_BLUE_SOFT};color:${WECHAT_BLUE};font-family:${WECHAT_SERIF};font-size:15px;font-weight:800;line-height:1.7;`,
    );
    if (!bq.querySelector(".wechat-quote-mark")) {
      const mark = document.createElement("span");
      mark.className = "wechat-quote-mark";
      mark.textContent = "“";
      mark.setAttribute(
        "style",
        `grid-column:1;grid-row:1;font-family:${WECHAT_SERIF};font-size:23px;font-weight:800;line-height:1;color:${WECHAT_BLUE};`,
      );
      bq.prepend(mark);
    }
    bq.querySelectorAll("p, strong").forEach((el) => {
      el.style.fontFamily =
        "寒蝉锦书宋Compact, Songti SC, STSong, 华文宋体, 宋体, SimSun, serif";
      el.style.fontWeight = "800";
      el.style.color = WECHAT_BLUE;
      if (el.tagName === "P") el.style.gridColumn = "2";
    });
  });
}

/**
 * 将 Markdown 转为公众号排版 HTML。
 * 二级标题不用 h2 着色（微信会重置标题色），改为 section + span。
 * 宋体栈不含寒蝉，避免微信丢弃整段 font-family 后退化成黑体。
 * @param {string} md
 * @param {{ keepImages?: boolean, blockImages?: boolean }} [opts]
 *   keepImages：保留正文图；blockImages：H1/H2/引用渲染为图片（草稿推送）
 */
async function publishHTML(...a) { return time("publishHTML", publishHTMLInner, ...a); }

/**
 * 生成小红书分页用的正文 HTML；优先编辑器快照。
 */
function socialSourceHTML() {
  const html = editor ? editor.getHTML() : articleSourceHTML();
  const d = new DOMParser().parseFromString(html, "text/html");
  if (!isWeb())
    d.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src?.startsWith("/api/asset/"))
        img.src = src
          .replace("/api/asset/vault/", "inkasset://vault/")
          .replace("/api/asset/local/", "inkasset://local/");
    });
  return d.body.innerHTML;
}

/**
 * 已发布文章预览用正文 HTML。
 * @param {string} [md]
 */
function publishedSourceHTML(md = publishedPreview?.body) {
  const html = safeHTML(md || "");
  const d = new DOMParser().parseFromString(html, "text/html");
  if (!isWeb())
    d.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src?.startsWith("/api/asset/"))
        img.src = src
          .replace("/api/asset/vault/", "inkasset://vault/")
          .replace("/api/asset/local/", "inkasset://local/");
    });
  return d.body.innerHTML;
}

/**
 * 进入或退出预览模式，并重建写作页。
 */
function togglePreview() {
  if (isXAccount()) return;
  sync();
  // 进入预览前再刷一次快照，保证标题软换行 / 图片地址与编辑器一致
  if (editor && current) {
    current.richHTML = editor.getHTML();
    current.body = td.turndown(current.richHTML);
    editorHTML = current.richHTML;
  }
  previewMode = !previewMode;
  previewDocId = previewMode ? current.id : null;
  if (editor) {
    editor.destroy();
    editor = null;
  }
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }
  renderWrite();
}

/** @type {(() => void) | null} */
let closeVersionDropdown = null;

/**
 * 绑定写作页与预览页共用的页眉操作（预览切换、保存、版本历史）。
 */
function bindArticleHeader() {
  if ($("#layout")) $("#layout").onclick = togglePreview;
  $("#save-version").onclick = async () => {
    closeVersionDropdown?.();
    sync();
    current.snapshots.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      name: "手动保存",
      body: current.body,
    });
    dirty = true;
    if (await persist()) toast("已保存");
  };
  $("#version-menu").onclick = (e) => {
    e.stopPropagation();
    if ($("#version-dropdown")) {
      closeVersionDropdown?.();
      return;
    }
    openVersionHistoryMenu();
  };
}

/**
 * 在「保存」旁展开版本历史下拉；支持恢复某次快照。
 */
async function openVersionHistoryMenu() {
  closeVersionDropdown?.();
  sync();
  if (!(await persist())) return;
  try {
    current.snapshots = await api("versions", current.id);
  } catch (e) {
    return toast(e.message);
  }
  const anchor = $("#save-split");
  if (!anchor) return;
  const menu = document.createElement("div");
  menu.id = "version-dropdown";
  menu.className = "version-dropdown";
  const snaps = current.snapshots || [];
  menu.innerHTML = `<div class="version-dropdown-head"><strong>版本历史</strong></div><div class="history-items">${
    snaps
      .map(
        (x, i) =>
          `<div class="version-dropdown-item"><small>${esc(new Date(x.at).toLocaleString("zh-CN"))}</small><button type="button" data-restore="${i}">恢复</button></div>`,
      )
      .reverse()
      .join("") ||
    '<p class="muted version-dropdown-empty">还没有版本。点击「保存」会留下快照。</p>'
  }</div>`;
  document.body.append(menu);
  menu.onclick = (e) => e.stopPropagation();
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(280, rect.width + 40);
  menu.style.width = width + "px";
  let left = rect.right - width;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = rect.bottom + 6;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
  requestAnimationFrame(() => {
    const h = menu.getBoundingClientRect().height;
    if (top + h > window.innerHeight - 12)
      menu.style.top = Math.max(12, rect.top - h - 6) + "px";
  });
  $("#version-menu")?.setAttribute("aria-expanded", "true");
  const close = () => {
    if (closeVersionDropdown === close) closeVersionDropdown = null;
    menu.remove();
    $("#version-menu")?.setAttribute("aria-expanded", "false");
    window.removeEventListener("click", close);
    window.removeEventListener("resize", close);
  };
  closeVersionDropdown = close;
  menu.querySelectorAll("[data-restore]").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const body = current.snapshots[+b.dataset.restore].body;
      sync();
      current.snapshots.push({
        at: new Date().toISOString(),
        body: current.body,
      });
      if (editor) {
        editor.commands.setContent(safeHTML(body));
        sync();
      } else current.body = body;
      changed();
      pending = null;
      close();
      toast("版本已恢复，恢复前的正文也已保存");
      if (previewMode) renderWrite();
    };
  });
  setTimeout(() => {
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
  }, 0);
}

/**
 * 绑定全局右侧栏「已发布」按钮（定稿归档）。
 */
function bindFinalize() {
  const btn = $("#finalize");
  if (!btn) return;
  btn.onclick = async () => {
    if (!current) return toast("请先打开一篇草稿");
    if (busy) return toast("请等待 AI 完成后再发布");
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
      current = state.documents.find((d) => sameAccount(d.account, account));
      pending = null;
      page = "dashboard";
      render();
      toast("已发布并移入本账号 Archive，版本与对话已保留");
    } catch (e) {
      toast(e.message);
    }
  };
}

/**
 * 按当前上下文同步 Aster 表情：thinking > idea > watching > idle。
 */
function syncAsterFace() {
  let face = "idle";
  if (busy) face = "thinking";
  else if (
    pending &&
    pending.doc === current?.id &&
    (pending.hunks?.length || pending.edits?.length || pending.next)
  )
    face = "idea";
  else {
    const sel = editor?.state?.selection;
    if (sel && sel.to > sel.from) face = "watching";
  }
  $$(".aster").forEach((el) => setAsterState(el, face));
}

/** 卸下侧栏 Aster 头像 */
function clearAsterRail() {
  unmountAsterRail?.();
  unmountAsterRail = null;
}

/**
 * 同步右侧栏与分隔条显隐：仅草稿写作可用；写作伙伴默认收起；预览时收起侧栏。
 */
function syncRailVisibility() {
  const rail = $("#rail");
  const resizer = $("#workspace-resizer");
  const draftWriting = page === "write" && !!current;
  if (!rail) return;
  if (!draftWriting || previewMode) {
    rail.classList.add("hidden");
    resizer?.classList.add("hidden");
    $(".aster-dock")?.classList.add("hidden");
    return;
  }
  rail.classList.toggle("hidden", !assistantOpen);
  resizer?.classList.toggle("hidden", !assistantOpen);
  $(".aster-dock")?.classList.toggle("hidden", assistantOpen);
  const toggle = $("#toggle-assistant");
  if (toggle) {
    toggle.setAttribute(
      "aria-pressed",
      assistantOpen && railMode === "assistant" ? "true" : "false",
    );
    syncAsterFace();
  }
  $("#article-materials")?.classList.toggle(
    "primary",
    assistantOpen && railMode === "materials",
  );
  requestAnimationFrame(() => $("#article-outline")?._place?.());
}

/**
 * 展开写作伙伴（若当前在草稿写作中）。
 */
function openAssistant() {
  if (page !== "write" || !current || previewMode) return;
  const already =
    assistantOpen &&
    railMode === "assistant" &&
    $("#panel")?.dataset.ready &&
    $("#rail")?.dataset.railMode === "assistant";
  railMode = "assistant";
  if (already) {
    syncRailVisibility();
    return;
  }
  assistantOpen = true;
  renderAssistantRail();
}

/**
 * 打开右侧栏并显示当前文章的素材库。
 */
function openArticleMaterials() {
  if (page !== "write" || !current || previewMode) return;
  sync();
  persist();
  railMode = "materials";
  assistantOpen = true;
  renderAssistantRail();
}

/**
 * 渲染右侧栏：草稿写作且已展开→写作伙伴/素材；预览时不占用侧栏。
 */
function renderAssistantRail() {
  const rail = $("#rail");
  if (!rail) return;
  clearAsterRail();
  if (composer) {
    composer.destroy();
    composer = null;
  }
  if (socialPreviewCtl) {
    socialPreviewCtl.destroy();
    socialPreviewCtl = null;
  }

  const draftWriting = page === "write" && !!current;
  if (!draftWriting || previewMode) {
    rail.innerHTML = "";
    rail.classList.remove("preview-mode");
    delete rail.dataset.railMode;
    syncRailVisibility();
    return;
  }

  rail.classList.remove("preview-mode");

  // 默认收起：未展开时不挂载对话，节省资源
  if (!assistantOpen) {
    rail.innerHTML = "";
    delete rail.dataset.railMode;
    syncRailVisibility();
    return;
  }

  if (railMode === "materials") {
    rail.dataset.railMode = "materials";
    rail.innerHTML = `<div class="assistant-head"><span>${I.library()} 素材</span><div class="assistant-head-actions"><button type="button" id="upload-article-material" class="ghost icon-btn" title="上传" aria-label="上传">${I.upload({ size: 18 })}</button><button type="button" id="close-assistant" class="ghost icon-btn" title="收起" aria-label="收起">${I.panelClose({ size: 18 })}</button></div></div><div id="panel" data-ready="1" class="article-materials-panel"><div id="article-material-list" class="material-cards"></div></div>`;
    $("#close-assistant").onclick = () => {
      assistantOpen = false;
      syncRailVisibility();
    };
    bindArticleMaterialsPanel();
    syncRailVisibility();
    return;
  }

  rail.dataset.railMode = "assistant";
  rail.innerHTML = `<div class="assistant-head">${asterHtml({ size: 32, id: "aster-rail", button: false })}<select id="conversation" class="assistant-conversation" aria-label="对话">${conversationOptionsHTML()}</select><div class="assistant-head-actions"><button type="button" id="new-conversation" class="ghost icon-btn" title="为本篇创建新对话" aria-label="新对话">${I.plus({ size: 18 })}</button><button type="button" id="close-assistant" class="ghost icon-btn" title="收起" aria-label="收起">${I.panelClose({ size: 18 })}</button></div></div><div id="panel" data-ready="1"></div>`;
  unmountAsterRail = mountAster($("#aster-rail"));
  syncAsterFace();

  $("#close-assistant").onclick = () => {
    assistantOpen = false;
    syncRailVisibility();
  };
  bindConversationHead();
  $$("#rail [data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        $$("#rail [data-tab]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        renderPanel();
      }),
  );
  renderPanel();
  syncRailVisibility();
}

/** 对话下拉选项 HTML */
function conversationOptionsHTML() {
  if (!current?.conversations?.length) return "";
  return current.conversations
    .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`)
    .join("");
}

/** 绑定头栏对话切换 / 新建 */
function bindConversationHead() {
  const sel = $("#conversation");
  const neu = $("#new-conversation");
  if (!current || !sel) return;
  sel.innerHTML = conversationOptionsHTML();
  sel.value = conversation(current).id;
  sel.onchange = (e) => {
    current.activeConversationId = e.target.value;
    persist();
    renderPanel();
  };
  if (neu)
    neu.onclick = () => {
      const c = {
        id: crypto.randomUUID(),
        title: "新对话 " + (current.conversations.length + 1),
        messages: [],
      };
      current.conversations.push(c);
      current.activeConversationId = c.id;
      persist();
      bindConversationHead();
      renderPanel();
    };
}

/**
 * 绑定本文素材侧栏：列表、上传、预览、拖拽导入。
 */
function bindArticleMaterialsPanel() {
  const listEl = $("#article-material-list");
  const uploadBtn = $("#upload-article-material");
  const panel =
    $("#panel.article-materials-panel") || $(".article-materials-panel");
  const doc = current;
  if (!listEl || !doc) return;

  /** 刷新当前文章关联的素材卡片 */
  const draw = async () => {
    if (
      page !== "write" ||
      !current ||
      current.id !== doc.id ||
      railMode !== "materials"
    )
      return;
    try {
      const raw = await api("project-refs", doc.id);
      const refs = await Promise.all(raw.map(hydrateMaterialPreview));
      if (!listEl.isConnected) return;
      listEl.innerHTML =
        refs.map((r) => materialPreviewCardHTML(r)).join("") ||
        '<p class="empty-data">拖拽文件到此处，或点击上方上传</p>';
      $$("#article-material-list [data-ref-preview]").forEach(
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
                doc,
              });
            } catch (e) {
              toast(e.message);
            }
          }),
      );
      $$("#article-material-list [data-material]").forEach((card) => {
        card.oncontextmenu = (e) => {
          e.preventDefault();
          const id = card.dataset.material;
          showContextMenu(e.clientX, e.clientY, [
            {
              label: "删除素材",
              danger: true,
              run: async () => {
                if (!confirm("确定删除此素材？将从所有文章解除引用。")) return;
                try {
                  await api("materials-delete", id);
                  toast("素材已删除");
                  draw();
                } catch (err) {
                  toast(err.message);
                }
              },
            },
          ]);
        };
      });
    } catch (e) {
      toast(e.message);
    }
  };

  /** 导入一批文件（按钮选择或拖拽） */
  const importFiles = async (files) => {
    if (!files?.length) return;
    toast("正在导入 " + files.length + " 个文件…");
    if (uploadBtn) uploadBtn.disabled = true;
    panel?.classList.add("is-uploading");
    try {
      if (!(await persist())) return;
      await uploadProjectFiles(doc.id, files);
      await draw();
      toast("已导入 " + files.length + " 个文件");
    } catch (e) {
      toast(e.message);
    } finally {
      if (uploadBtn?.isConnected) uploadBtn.disabled = false;
      panel?.classList.remove("is-uploading");
    }
  };

  uploadBtn.onclick = async () => {
    uploadBtn.disabled = true;
    try {
      if (!(await persist())) return;
      await uploadProjectFiles(doc.id);
      await draw();
    } catch (e) {
      toast(e.message);
    } finally {
      if (uploadBtn.isConnected) uploadBtn.disabled = false;
    }
  };

  if (panel && !panel.dataset.dropBound) {
    panel.dataset.dropBound = "1";
    let dragDepth = 0;
    /** 是否为从系统拖入的文件 */
    const isFileDrag = (dt) => !!dt && [...(dt.types || [])].includes("Files");
    panel.addEventListener("dragenter", (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth += 1;
      if (dragDepth === 1) toast("松开即可导入到素材", { sticky: true });
    });
    panel.addEventListener("dragover", (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    panel.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideToast();
    });
    panel.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      const files = [...(e.dataTransfer?.files || [])].filter(
        (f) => f && f.size > 0,
      );
      if (!files.length) return toast("没有可导入的文件");
      importFiles(files);
    });
  }

  draw();
}

/**
 * 切换预览子分栏（公众号 / 小红书），并同步操作按钮显隐。
 * @param {"wechat"|"social"} pane
 */
function setPreviewPane(pane) {
  previewPane = pane === "social" ? "social" : "wechat";
  const wrap = $(".paper-wrap");
  if (!wrap) return;
  wrap.querySelectorAll("[data-preview-pane]").forEach((btn) => {
    const on = btn.dataset.previewPane === previewPane;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  wrap.querySelectorAll("[data-pane]").forEach((el) => {
    el.hidden = el.dataset.pane !== previewPane;
  });
}

/** 移除正文大纲（预览态不展示）。 */
function removeArticleOutline() {
  const outline = $("#article-outline");
  outline?._teardown?.();
  if (outline) {
    outline.hidden = true;
    outline.innerHTML = "";
    delete outline._teardown;
    delete outline._place;
  }
}

/**
 * 渲染预览模式：顶栏分栏切换公众号 / 小红书；侧栏收起。
 */
function renderPreview(...a) { return time("renderPreview", renderPreviewInner, ...a); }
function renderPreviewInner() {
  previewDocId = current.id;
  removeArticleOutline();
  if (previewPane !== "social") previewPane = "wechat";
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(current.title || "未命名文章")}</h1></div><div class="header-actions"><div class="save-split" id="save-split"><button type="button" id="save-version">保存</button><button type="button" id="version-menu" aria-label="版本历史" aria-haspopup="true" aria-expanded="false">${I.chevronDown({ size: 14 })}</button></div><button id="layout" class="primary">退出预览</button><button id="finalize" class="primary">已发布</button></div></header><div class="workspace preview-mode"><section class="paper-wrap"><div class="paper-meta-dock"><div class="paper-meta-stack"><aside id="article-outline" class="article-outline" hidden></aside><div class="paper-meta byline" aria-label="文章信息">${new Date().toLocaleDateString("zh-CN")} <span id="wordcount">${current.body.length} 字</span><span id="saved" hidden></span></div></div></div><div class="formatbar preview-toolbar"><div class="preview-tabs" role="tablist" aria-label="预览分栏"><button type="button" role="tab" data-preview-pane="wechat" class="${previewPane === "wechat" ? "active" : ""}" aria-selected="${previewPane === "wechat"}">公众号</button><button type="button" role="tab" data-preview-pane="social" class="${previewPane === "social" ? "active" : ""}" aria-selected="${previewPane === "social"}">小红书</button></div><span></span><button type="button" id="social-export" disabled>${I.imageDown()} 导出图片</button><button type="button" id="copy-publish">${I.copy()} 复制排版</button><button type="button" id="push-wechat">${I.send()} 推送到公众号</button></div><div class="preview-pane" data-pane="wechat" ${previewPane !== "wechat" ? "hidden" : ""}><article class="paper wechat-preview"><h1 class="preview-title">${esc(current.title || "未命名文章")}</h1><div id="article-preview">${articleSourceHTML()}</div></article></div><div class="preview-pane preview-pane-social" data-pane="social" ${previewPane !== "social" ? "hidden" : ""}><p id="social-status" class="social-pane-status">正在排版…</p><div id="social-pages"></div></div></section></div>`;
  bindArticleHeader();
  bindFinalize();
  enhanceWechatPreview();
  $$("[data-preview-pane]").forEach((btn) => {
    btn.onclick = () => setPreviewPane(btn.dataset.previewPane);
  });
  $("#copy-publish").onclick = () => copyPublish(current);
  $("#push-wechat").onclick = () => pushWechatDraft(current);
  // 先收起侧栏（会 destroy 旧 ctl），再绑定本页小红书排版
  renderAssistantRail();
  socialPreviewCtl = bindSocialPreview($(".paper-wrap") || document, {
    html: socialSourceHTML(),
    title: current.title,
    api,
    web: isWeb(),
  });
}

/**
 * 渲染已发布文章的排版预览（公众号 / 小红书），与草稿预览同结构。
 * X 模式仅展示正文只读，无排版分栏与公众号推送。
 */
function renderPublishedPreview(...a) { return time("renderPublishedPreview", renderPublishedPreviewInner, ...a); }
function renderPublishedPreviewInner() {
  if (!publishedPreview) {
    page = "dashboard";
    return renderDashboard();
  }
  removeArticleOutline();
  const doc = {
    title: publishedPreview.title,
    body: publishedPreview.body,
  };
  const html = publishedSourceHTML(doc.body);
  if (isXAccount()) {
    $("#main").innerHTML =
      `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(doc.title || "未命名文章")}</h1><div class="byline">${esc(publishedPreview.path.split("/").pop())} <span>${(doc.body || "").length} 字</span></div></div><div class="header-actions"><button type="button" id="published-backup">${I.folder()} 本地同步</button><button type="button" id="published-to-draft">移回草稿</button><button id="layout" class="primary">返回</button></div></header><div class="workspace preview-mode"><section class="paper-wrap"><article class="paper"><h1 class="preview-title">${esc(doc.title || "未命名文章")}</h1><div id="article-preview">${html}</div></article></section></div>`;
    $("#layout").onclick = () => {
      publishedPreview = null;
      page = "dashboard";
      render();
    };
    $("#published-to-draft").onclick = () =>
      movePublishedToDraft(publishedPreview.path);
    $("#published-backup").onclick = () =>
      backupPublishedArticle(publishedPreview.path);
    renderAssistantRail();
    return;
  }
  if (previewPane !== "social") previewPane = "wechat";
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(doc.title || "未命名文章")}</h1><div class="byline">${esc(publishedPreview.path.split("/").pop())} <span>${(doc.body || "").length} 字</span></div></div><div class="header-actions"><button type="button" id="published-backup">${I.folder()} 本地同步</button><button type="button" id="published-to-draft">移回草稿</button><button id="layout" class="primary">退出预览</button></div></header><div class="workspace preview-mode"><section class="paper-wrap"><div class="formatbar preview-toolbar"><div class="preview-tabs" role="tablist" aria-label="预览分栏"><button type="button" role="tab" data-preview-pane="wechat" class="${previewPane === "wechat" ? "active" : ""}" aria-selected="${previewPane === "wechat"}">公众号</button><button type="button" role="tab" data-preview-pane="social" class="${previewPane === "social" ? "active" : ""}" aria-selected="${previewPane === "social"}">小红书</button></div><span></span><button type="button" id="social-export" disabled>${I.imageDown()} 导出图片</button><button type="button" id="copy-publish">${I.copy()} 复制排版</button><button type="button" id="push-wechat">${I.send()} 推送到公众号</button></div><div class="preview-pane" data-pane="wechat" ${previewPane !== "wechat" ? "hidden" : ""}><article class="paper wechat-preview"><h1 class="preview-title">${esc(doc.title || "未命名文章")}</h1><div id="article-preview">${html}</div></article></div><div class="preview-pane preview-pane-social" data-pane="social" ${previewPane !== "social" ? "hidden" : ""}><p id="social-status" class="social-pane-status">正在排版…</p><div id="social-pages"></div></div></section></div>`;
  $("#layout").onclick = () => {
    publishedPreview = null;
    page = "dashboard";
    render();
  };
  $("#published-to-draft").onclick = () =>
    movePublishedToDraft(publishedPreview.path);
  $("#published-backup").onclick = () =>
    backupPublishedArticle(publishedPreview.path);
  enhanceWechatPreview();
  $$("[data-preview-pane]").forEach((btn) => {
    btn.onclick = () => setPreviewPane(btn.dataset.previewPane);
  });
  $("#copy-publish").onclick = () => copyPublish(doc);
  $("#push-wechat").onclick = () => pushWechatDraft(doc);
  renderAssistantRail();
  socialPreviewCtl = bindSocialPreview($(".paper-wrap") || document, {
    html,
    title: doc.title,
    api,
    web: isWeb(),
  });
}

function renderWrite(...a) { return time("renderWrite", renderWriteInner, ...a); }
function renderWriteInner() {
  if (!current) {
    $("#main").innerHTML =
      `<div class="empty"><span class="eyebrow">A SPACE FOR YOUR WORDS</span><h1>把想说的话，写下来。</h1><p>从草稿开始，或导入已有文章。AI 在你需要时帮忙。</p><button class="primary" id="start">${I.plus()} 新建文章</button></div>`;
    $("#start").onclick = newDoc;
    renderAssistantRail();
    return;
  }
  if (previewMode && previewDocId && previewDocId !== current.id)
    previewMode = false;
  tab = "chat";
  if (previewMode) {
    if (isXAccount()) {
      previewMode = false;
      previewDocId = null;
    } else {
      renderPreview();
      return;
    }
  }
  unmountAster?.();
  unmountAster = null;
  const previewBtn = isXAccount()
    ? ""
    : `<button id="layout">预览</button>`;
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">${esc(current.title || "未命名文章")}</h1></div><div class="header-actions"><div class="save-split" id="save-split"><button type="button" id="save-version">保存</button><button type="button" id="version-menu" aria-label="版本历史" aria-haspopup="true" aria-expanded="false">${I.chevronDown({ size: 14 })}</button></div>${previewBtn}<button id="finalize" class="primary">已发布</button></div></header><div class="workspace"><div class="paper-stage"><section class="paper-wrap"><div class="paper-meta-dock"><div class="paper-meta-stack"><aside id="article-outline" class="article-outline" hidden></aside><div class="paper-meta byline" aria-label="文章信息">${new Date().toLocaleDateString("zh-CN")} <span id="wordcount">${current.body.length} 字</span><span id="saved" hidden></span></div></div></div><div class="formatbar"><div class="formatbar-edit-tools"><button data-fmt="bold" title="加粗">${I.bold()}</button><button data-fmt="italic" title="斜体">${I.italic()}</button><button data-fmt="heading1" title="一级标题">${I.h1()}</button><button data-fmt="heading" title="二级标题">${I.h2()}</button><button data-fmt="bulletList" title="列表">${I.list()}</button><button data-fmt="blockquote" title="引用">${I.quote()}</button><button id="image" title="插入图片">${I.image()}</button></div><span class="formatbar-spacer"></span><div class="formatbar-edit-tools formatbar-edit-end"><select id="article-group" class="article-group-inline" aria-label="文章分组" title="分组影响本地同步默认路径">${groupOptionsHtml(state, current.group)}</select><div class="review-menu"><button type="button" id="toggle-review" title="审阅" aria-haspopup="true" aria-expanded="false">${I.eye()} 审阅</button><div class="selection-bar" hidden><span id="selection-label">选中正文，让 AI 帮你推敲</span><button id="tag-selection">${I.tags()} 引用选段</button></div></div><button id="focus" title="专注">${I.focus()} 专注</button><button id="article-materials" title="本文素材">${I.library()} 素材</button></div><div class="formatbar-review-tools" hidden><span class="formatbar-review-tag" aria-live="polite">审阅中</span><span class="formatbar-review-spacer"></span><button type="button" data-inline="accept-all">全部接受</button><button type="button" data-inline="reject-all">全部拒绝</button><button type="button" data-inline="finish" class="primary">完成</button></div></div><article class="paper"><input id="title" placeholder="给这个想法起个名字" value="${esc(current.title)}"><div id="editor"></div></article></section><div class="aster-dock">${asterHtml({ size: 48, state: "idle" })}</div></div><div id="selection-float" class="selection-float" hidden><button type="button" id="selection-float-add">${I.chat({ size: 14 })}<span>添加到 AI 对话</span></button></div></div>`;
  unmountAster = mountAster($("#toggle-assistant"));
  syncAsterFace();
  const onSelectionScroll = () => {
    if (editor && !selectionDragging) placeSelectionFloat(editor);
  };
  editor = new Editor({
    element: $("#editor"),
    extensions: [StarterKit, Image, TableKit],
    content: current.richHTML
      ? sanitizeRichHTML(current.richHTML)
      : safeHTML(current.body),
    onUpdate() {
      sync();
      $("#wordcount").textContent = current.body.length + " 字";
      changed();
    },
    onDestroy() {
      window.removeEventListener("scroll", onSelectionScroll, true);
      window.removeEventListener("resize", onSelectionScroll);
      hideSelectionFloat();
    },
    onSelectionUpdate({ editor: e }) {
      const { from, to } = e.state.selection;
      if (to > from) {
        selectionContext = {
          from,
          to,
          text: e.state.doc.textBetween(from, to, "\n"),
          version: e.getHTML(),
          doc: current.id,
        };
      } else {
        selectionContext = null;
      }
      selectedText = selectionContext?.text || "";
      const label = $("#selection-label");
      if (label)
        label.textContent = selectedText
          ? "已选中 " + selectedText.length + " 字"
          : "选中正文，让 AI 帮你推敲";
      if (!selectionDragging) placeSelectionFloat(e);
      else hideSelectionFloat();
      syncAsterFace();
    },
    editorProps: {
      handleDOMEvents: {
        mousedown: () => {
          selectionDragging = true;
          hideSelectionFloat();
          return false;
        },
        mouseup: () => {
          selectionDragging = false;
          if (editor) placeSelectionFloat(editor);
          return false;
        },
        keyup: () => {
          selectionDragging = false;
          if (editor) placeSelectionFloat(editor);
          return false;
        },
      },
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
  selectionDragging = false;
  hideSelectionFloat();
  window.addEventListener("scroll", onSelectionScroll, true);
  window.addEventListener("resize", onSelectionScroll);
  $("#article-materials").onclick = () => {
    if (assistantOpen && railMode === "materials") {
      assistantOpen = false;
      syncRailVisibility();
      return;
    }
    openArticleMaterials();
  };
  $("#title").oninput = (e) => {
    current.title = e.target.value;
    changed();
  };
  $("#article-group").onchange = async (e) => {
    const value = e.target.value.trim();
    if (value === "__new__") {
      e.target.value = current.group || "";
      const name = await promptText("新建分组", {
        placeholder: "例如：公众号、小红书",
        okLabel: "创建",
      });
      if (!name) return;
      try {
        const result = await api("group-upsert", { name });
        state.groups = result.groups || state.groups;
        current.group = name;
        changed();
        await persist();
        const sel = $("#article-group");
        if (sel) {
          sel.innerHTML =
            groupOptionsHtml(state, current.group) +
            `<option value="__new__">＋ 新建分组…</option>`;
          sel.value = current.group;
        }
        toast(`已创建并选用「${name}」`);
      } catch (err) {
        toast(err.message || "创建失败");
      }
      return;
    }
    current.group = value || null;
    changed();
  };
  // 在下拉末尾追加「新建分组」
  {
    const sel = $("#article-group");
    if (sel) {
      const opt = document.createElement("option");
      opt.value = "__new__";
      opt.textContent = "＋ 新建分组…";
      sel.append(opt);
    }
  }
  $$("[data-fmt]").forEach(
    (b) =>
      (b.onclick = () => {
        const c = editor.chain().focus();
        const f = b.dataset.fmt;
        if (f === "heading1") c.toggleHeading({ level: 1 }).run();
        else if (f === "heading") c.toggleHeading({ level: 2 }).run();
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
    $(".sidebar").classList.toggle("hidden");
  };
  /** 切换审阅按钮下方工具条显示 */
  $("#toggle-review").onclick = () => {
    const bar = $(".selection-bar");
    const btn = $("#toggle-review");
    if (!bar || !btn) return;
    const open = bar.hasAttribute("hidden");
    if (open) bar.removeAttribute("hidden");
    else bar.setAttribute("hidden", "");
    btn.classList.toggle("is-active", open);
    btn.setAttribute("aria-pressed", open ? "true" : "false");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  $("#toggle-assistant").onclick = () => {
    if (assistantOpen && railMode === "assistant") {
      assistantOpen = false;
      syncRailVisibility();
      return;
    }
    railMode = "assistant";
    assistantOpen = true;
    renderAssistantRail();
  };
  bindArticleHeader();
  bindFinalize();
  $$("[data-task]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      openAssistant();
      runTask(b.dataset.task);
    };
  });
  $("#tag-selection").onmousedown = (e) => e.preventDefault();
  $("#tag-selection").onclick = () => {
    openAssistant();
    tagSelection();
  };
  const floatAdd = $("#selection-float-add");
  if (floatAdd) {
    floatAdd.onmousedown = (e) => e.preventDefault();
    floatAdd.onclick = () => {
      openAssistant();
      tagSelection();
      hideSelectionFloat();
    };
  }
  mountArticleOutline();
  mountInlineReviewBar();
  renderAssistantRail();
}

/** 隐藏正文选区浮窗 */
function hideSelectionFloat() {
  const float = $("#selection-float");
  if (float) float.hidden = true;
}

/**
 * 将「添加到 AI 对话」浮窗定位到当前选区附近。
 * @param {import('@tiptap/core').Editor} e
 */
function placeSelectionFloat(e) {
  const float = $("#selection-float");
  if (!float || !e) return;
  const { from, to, empty } = e.state.selection;
  if (empty || to <= from || previewMode) {
    float.hidden = true;
    return;
  }
  float.hidden = false;
  const start = e.view.coordsAtPos(from);
  const end = e.view.coordsAtPos(to);
  const w = float.offsetWidth || 140;
  const h = float.offsetHeight || 36;
  let left = (start.left + end.right) / 2 - w / 2;
  let top = Math.min(start.top, end.top) - h - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  if (top < 8) top = Math.max(start.bottom, end.bottom) + 8;
  float.style.left = `${left}px`;
  float.style.top = `${top}px`;
}

/**
 * 在左下角 meta 卡片上方挂载大纲：可收起为小卡片；打开后默认仅最高级。
 */
function mountArticleOutline() {
  const stack = $(".paper-meta-stack");
  if (!stack || !editor) return;
  let nav = $("#article-outline");
  if (!nav) {
    nav = document.createElement("aside");
    nav.id = "article-outline";
    stack.prepend(nav);
  }
  nav._teardown?.();

  /** 最小宽度与 byline 卡片对齐（收起/展开均生效） */
  const syncChipWidth = () => {
    const byline = stack.querySelector(".paper-meta.byline");
    if (!byline) {
      nav.style.minWidth = "";
      nav.style.width = "";
      return;
    }
    const w = Math.round(byline.getBoundingClientRect().width);
    nav.style.minWidth = w + "px";
    nav.style.width = outlineOpen ? "" : w + "px";
  };

  /** 根据编辑器标题刷新锚点 */
  const refresh = () => {
    const root = $("#editor");
    if (!root) return;
    const headings = [...root.querySelectorAll("h1, h2, h3")].map((el) => ({
      el,
      level: el.tagName === "H1" ? 1 : el.tagName === "H2" ? 2 : 3,
      text: el.textContent.trim() || "（空标题）",
    }));
    if (!headings.length) {
      nav.hidden = true;
      nav.innerHTML = "";
      nav.style.width = "";
      nav.style.minWidth = "";
      return;
    }
    const topLevel = Math.min(...headings.map((h) => h.level));
    const hasDeeper = headings.some((h) => h.level > topLevel);
    nav.hidden = false;
    nav.className =
      "article-outline" +
      (outlineOpen ? "" : " is-collapsed") +
      (outlineExpanded ? " is-expanded" : "");

    if (!outlineOpen) {
      nav.innerHTML = `<button type="button" class="outline-chip" title="展开大纲" aria-label="展开大纲" aria-expanded="false">${I.outline({ size: 14 })} 大纲</button>`;
      nav.querySelector(".outline-chip").onclick = (e) => {
        e.stopPropagation();
        outlineOpen = true;
        refresh();
      };
      requestAnimationFrame(syncChipWidth);
      return;
    }

    const rows = headings
      .map((h, i) => {
        const isTop = h.level === topLevel;
        const hidden = !outlineExpanded && !isTop ? " hidden" : "";
        return `<button type="button" class="outline-row level-${h.level}${isTop ? " is-top" : ""}"${hidden} data-heading="${i}" title="${esc(h.text)}"><span class="outline-label">${esc(h.text)}</span></button>`;
      })
      .join("");
    const deeperToggle = hasDeeper
      ? `<button type="button" class="outline-toggle" aria-expanded="${outlineExpanded ? "true" : "false"}" title="${outlineExpanded ? "收起下级标题" : "展开全部标题"}" aria-label="${outlineExpanded ? "收起下级标题" : "展开全部标题"}">${I.chevronDown({ size: 14 })}</button>`
      : "";
    nav.innerHTML = `<div class="outline-head"><span class="outline-title">大纲</span><button type="button" class="outline-collapse" title="收起大纲" aria-label="收起大纲">${I.chevronDown({ size: 14 })}</button></div><div class="outline-track">${rows}</div>${deeperToggle}`;
    requestAnimationFrame(syncChipWidth);

    nav.querySelector(".outline-collapse").onclick = (e) => {
      e.stopPropagation();
      outlineOpen = false;
      outlineExpanded = false;
      refresh();
    };
    nav.querySelector(".outline-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      outlineExpanded = !outlineExpanded;
      refresh();
    });
    nav.querySelectorAll("[data-heading]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        headings[+b.dataset.heading]?.el?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      };
    });
  };

  nav._teardown = () => {};
  nav._place = syncChipWidth;

  editor.on("update", refresh);
  refresh();
}

/**
 * 绑定主内容区与全局右侧栏之间的拖拽调宽，并恢复上次宽度。
 */
function bindWorkspaceResize() {
  const resizer = $("#workspace-resizer");
  const aside = $("#rail") || $(".assistant");
  if (!resizer || !aside) return;

  /** 将宽度限制在可用范围内 */
  const clamp = (w) => {
    const cap =
      (previewMode && page === "write") || page === "published-preview"
        ? 640
        : 560;
    const max = Math.max(280, window.innerWidth - 480);
    return Math.min(Math.max(Math.round(w), 280), Math.min(cap, max));
  };

  const stored = Number(localStorage.getItem("inkdesk-assistant-width"));
  if (Number.isFinite(stored) && stored > 0)
    aside.style.width = clamp(stored) + "px";

  let startX = 0;
  let startW = 0;

  /** 拖拽过程中更新面板宽度 */
  const onMove = (e) => {
    aside.style.width = clamp(startW + (startX - e.clientX)) + "px";
  };

  /** 结束拖拽并记住宽度 */
  const onUp = () => {
    resizer.classList.remove("dragging");
    document.body.classList.remove("resizing-workspace");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    localStorage.setItem(
      "inkdesk-assistant-width",
      String(Math.round(aside.getBoundingClientRect().width)),
    );
  };

  resizer.onpointerdown = (e) => {
    if (aside.classList.contains("hidden")) return;
    e.preventDefault();
    startX = e.clientX;
    startW = aside.getBoundingClientRect().width;
    resizer.classList.add("dragging");
    document.body.classList.add("resizing-workspace");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}

/** 审阅中的改动列表（仅 change，保留供有状态调用方使用） */
function reviewChanges() {
  return (pending?.hunks || []).filter((h) => h.kind === "change");
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
      const { total } = reviewProgress(pending);
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
  tmp.innerHTML = reviewPageHTML(pending, current?.title);
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
  paper.insertAdjacentHTML("afterbegin", reviewPageHTML(pending, current?.title));
  bindInlineReviewBar();
}


/** Agent 模式切换控件（pill） */
function agentModeHTML() {
  const edit = agentMode === "edit";
  const label = edit ? "编辑" : "对话";
  const modeIcon = edit ? I.pen({ size: 14 }) : I.chat({ size: 14 });
  return `<div class="agent-mode"><button type="button" id="agent-output" class="agent-mode-trigger" title="${label}" aria-label="输出模式：${label}" aria-haspopup="listbox" aria-expanded="false" data-mode="${agentMode}">${modeIcon}${I.chevronDown({ size: 12 })}</button><div id="agent-mode-menu" class="agent-mode-menu" hidden role="listbox"><button type="button" role="option" data-value="chat" aria-selected="${!edit}">${I.chat({ size: 14 })}<span>对话</span></button><button type="button" role="option" data-value="edit" aria-selected="${edit}">${I.pen({ size: 14 })}<span>编辑</span></button></div></div>`;
}

/** @type {null | (() => void)} */
let activeComposerMenuDismiss = null;

/** 关闭当前打开的 composer 下拉（模式 / 模型） */
function dismissActiveComposerMenu() {
  const fn = activeComposerMenuDismiss;
  activeComposerMenuDismiss = null;
  fn?.();
}

/**
 * 绑定模式菜单：点击外部或其他下拉时关闭。
 */
function bindAgentModeMenu() {
  const root = $(".agent-mode");
  const modeBtn = $("#agent-output");
  const modeMenu = $("#agent-mode-menu");
  if (!root || !modeBtn || !modeMenu) return;

  /** @type {((e: Event) => void) | null} */
  let onDocPointer = null;

  const closeMode = () => {
    modeMenu.setAttribute("hidden", "");
    modeBtn.setAttribute("aria-expanded", "false");
    if (onDocPointer) {
      document.removeEventListener("pointerdown", onDocPointer, true);
      onDocPointer = null;
    }
    if (activeComposerMenuDismiss === closeMode) activeComposerMenuDismiss = null;
  };

  modeBtn.onclick = (e) => {
    e.stopPropagation();
    const willOpen = modeMenu.hasAttribute("hidden");
    dismissActiveComposerMenu();
    if (!willOpen) return;
    modeMenu.removeAttribute("hidden");
    modeBtn.setAttribute("aria-expanded", "true");
    activeComposerMenuDismiss = closeMode;
    onDocPointer = (ev) => {
      if (root.contains(/** @type {Node} */ (ev.target))) return;
      closeMode();
    };
    document.addEventListener("pointerdown", onDocPointer, true);
  };

  modeMenu.querySelectorAll("[data-value]").forEach((opt) => {
    opt.onclick = (e) => {
      e.stopPropagation();
      agentMode = opt.dataset.value === "edit" ? "edit" : "chat";
      closeMode();
      renderPanel();
    };
  });
}

/** 将 pending 合成结果写入编辑器（审阅模式：逐条决定后汇总应用） */
function applyPendingResult(nextText, action) {
  if (!pending) return false;
  if (reviewDemoActive) {
    pending = null;
    exitReviewMode();
    toast(
      action === "accepted"
        ? "演示：已模拟接受（未写入仓库）"
        : "演示：已模拟拒绝（未写入仓库）",
    );
    queueMicrotask(() => {
      if (loadReviewDemo({ silent: true })) render();
    });
    return true;
  }
  sync();
  current.decisions ??= [];
  current.decisions.push({
    action,
    before: pending.old,
    after: nextText,
    at: new Date().toISOString(),
  });
  if (action === "accepted") {
    current.snapshots.push({
      at: new Date().toISOString(),
      body: pending.base,
    });
    if (editor && current.body !== nextText) {
      editor.commands.setContent(safeHTML(nextText));
      sync();
    }
    changed();
    toast("已接受改后稿，可用 ⌘Z 撤回");
  } else {
    current.snapshots.push({
      at: new Date().toISOString(),
      body: current.body,
    });
    if (editor) {
      editor.commands.setContent(safeHTML(pending.old));
      sync();
    }
    changed();
    toast("已恢复改前稿");
  }
  pending = null;
  exitReviewMode();
  renderPanel();
  syncAsterFace();
  return true;
}

/** 接受/拒绝单个 hunk；正文实时跟随（接受即改后段，拒绝即原文段），审阅模式不自动退出 */
function decideHunk(id, accept) {
  if (!pending?.hunks) return;
  const hunk = pending.hunks.find((h) => h.id === id && h.kind === "change");
  if (!hunk || hunk.status !== "pending") return;
  hunk.status = accept ? "accepted" : "rejected";
  if (editor && current) {
    editor.commands.setContent(safeHTML(composeHunks(pending.hunks)));
    sync();
    changed();
  }
  const list = reviewChanges();
  const nextPending = list.findIndex((h) => h.status === "pending");
  reviewIndex = nextPending >= 0 ? nextPending : Math.min(reviewIndex, Math.max(list.length - 1, 0));
  refreshReviewUI();
  renderPanel();
  const left = list.some((h) => h.status === "pending");
  if (left) {
    scrollReviewToCurrent();
    return;
  }
  toast("全部已决定，点审阅条的「完成」汇总应用，或继续撤销某条。");
  scrollReviewToCurrent(false);
}

function renderPanel() {
  if (previewMode) return;
  if (composer) {
    composer.destroy();
    composer = null;
  }
  $$("[data-task]").forEach((b) => (b.disabled = busy));
  const panel = $("#panel");
  if (!panel) return;
  tab = "chat";
  const key = tab;
  let content = "";
  let docChip = "";
  if (tab === "chat") {
    docChip = `<div class="conversation-doc-chip" title="${esc(current?.id || "")}"><span class="conversation-doc-chip-icon">${I.file({ size: 14 })}</span><span class="conversation-doc-chip-text">${esc(current?.title || "未命名文章")}</span></div>`;
    content =
      conversation(current)
        .messages.map(
          (m) =>
            `<div class="message ${m.role}"><small class="message-role">${m.role === "user" ? "你" : "aster"}</small><div>${m.parts ? m.parts.map((p) => (p.kind === "tag" ? referenceChipHTML(p.reference?.kind || "file", p.label) : esc(p.text))).join("") : esc(m.text)}</div></div>`,
        )
        .join("") || "";
    if (busy) content += streamBubbleHTML();
    {
      const card = reviewCardHTML(pending, current?.id, conversation(current).id);
      if (card) content += card;
    }
  }
  panel.innerHTML = `<div class="panel-scroll">${content}</div><div class="composer-dock">${docChip}<div class="composer agent-composer"><div id="composer-input"></div><div class="composer-tools"><button id="chat-upload" class="icon-btn" title="添加" aria-label="添加" aria-haspopup="menu">${I.plus()}</button>${agentModeHTML()}${modelPickerHTML()}<button id="send" class="primary icon-btn" title="${busy ? "停止生成" : "发送（⌘Enter）"}" aria-label="${busy ? "停止生成" : "发送"}">${busy ? "■" : I.send()}</button></div></div></div>`;
  bindConversationHead();
  $("#send").onclick = () =>
    busy ? api("cancel") : runTask(agentMode === "edit" ? "rewrite" : "chat");
  bindAgentModeMenu();
  bindModelPicker();
  composer = new Composer($("#composer-input"), conversation(current), {
    changed: () => {
      dirty = true;
      docStore.deferPersist();
    },
    send: () => $("#send").click(),
    picker: () => chooseChatFile(),
  });
  $("#chat-upload").onclick = (e) => {
    e.stopPropagation();
    openComposerAddMenu(e.currentTarget);
  };
  $("#chat-upload").onmousedown = (e) => e.preventDefault();
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
  $$("[data-hunk-accept]").forEach(
    (b) => (b.onclick = () => decideHunk(b.dataset.hunkAccept, true)),
  );
  $$("[data-hunk-reject]").forEach(
    (b) => (b.onclick = () => decideHunk(b.dataset.hunkReject, false)),
  );
  if ($("#accept"))
    $("#accept").onclick = () => {
      if (!pending) return;
      if (pending.hunks) {
        pending.hunks.forEach((h) => {
          if (h.kind === "change") h.status = "accepted";
        });
        applyPendingResult(composeHunks(pending.hunks), "accepted");
        return;
      }
      applyPendingResult(pending.next, "accepted");
    };
  if ($("#reject"))
    $("#reject").onclick = () => {
      if (!pending) return;
      applyPendingResult(pending.old, "rejected");
    };
}
/** 流式气泡 HTML：思考动画或逐字输出 */
function streamBubbleHTML() {
  if (streamThinking)
    return `<div class="message assistant is-streaming" id="stream-bubble"><small class="message-role">aster · 思考中</small><div class="thinking"><span></span><span></span><span></span></div></div>`;
  return `<div class="message assistant is-streaming" id="stream-bubble"><small class="message-role">aster · 输出中</small><div class="stream-text">${esc(streamText)}<span class="stream-caret"></span></div></div>`;
}

/** 将面板滚动到底部（流式输出跟随） */
function scrollPanelToBottom() {
  const scroller = document.querySelector("#panel .panel-scroll");
  const bubble = $("#stream-bubble");
  if (bubble) bubble.scrollIntoView({ block: "end" });
  else if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

/** 增量更新流式气泡，避免整页重绘 */
function paintStreamBubble() {
  const bubble = $("#stream-bubble");
  if (!bubble) return;
  if (streamThinking) return;
  const activity = streamTools.length ? activityLine(streamTools.map((t) => ({ type: "tool_start", tool: t }))) : "aster · 输出中";
  bubble.querySelector(".message-role").textContent = activity;
  const body = bubble.querySelector(".stream-text");
  const tools = streamTools.map((t) => toolBlockHtml(t, t.state || "running")).join("");
  if (body) {
    body.childNodes[0]?.remove;
    body.innerHTML = `${esc(streamText)}<span class="stream-caret"></span>${tools}`;
  } else {
    bubble.innerHTML = `<small class="message-role">${esc(activity)}</small><div class="stream-text">${esc(streamText)}<span class="stream-caret"></span>${tools}</div>`;
  }
  bindToolToggles(bubble);
  scrollPanelToBottom();
}

// ponytail: onclick 赋值天然去重，比委托少一个全局监听
function bindToolToggles(root) {
  root?.querySelectorAll("[data-tool-toggle]").forEach((b) => {
    b.onclick = () => {
      const out = b.parentElement?.querySelector(".tool-output");
      if (out) out.hidden = !out.hidden;
    };
  });
}

// ponytail: tool 事件按 id 合并为一张卡；历史消息仍只存文本，升级 paths 再说
function trackToolEvent(e) {
  const t = e?.tool || {};
  const id = t.id || t.name + streamTools.length;
  const i = streamTools.findIndex((x) => (x.id || x.name) === id);
  const next = { id, name: t.name, args: t.args ?? t.argsDelta ?? "", output: t.output || "", state: e.type === "tool_end" ? "done" : "running" };
  if (i >= 0) streamTools[i] = { ...streamTools[i], ...next };
  else streamTools.push(next);
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
  const skillIds = [
    ...new Set(
      draft.references
        .filter((r) => r.kind === "skill" && r.skillId)
        .map((r) => r.skillId),
    ),
  ];
  if (anchors.some((r) => r.articleId !== doc.id || r.base !== body))
    return toast("引用选段已过期，请删除标签并重新选中添加");
  if (task === "chat" && !instruction && !skillIds.length)
    return toast("先写一句想讨论的内容");
  if (task === "rewrite" && !instruction && !skillIds.length)
    return toast("先写一句修改要求，或选用技能");
  const prompts = {
    rewrite: "按所选技能和用户要求修改全文，只输出修改后的完整正文。",
    chat: "",
  };
  const session = conversation(doc);
  if (!session.messages.length)
    session.title = (draft.display || "运行所选技能").slice(0, 14);
  session.messages.push({
    role: "user",
    text: draft.display || "运行所选技能",
    skillIds,
    parts: draft.parts.length ? draft.parts : undefined,
  });
  const submittedDraft = session.composerDraft;
  const submittedRefs = session.composerRefs;
  session.composerDraft = null;
  session.composerRefs = {};
  session.composerPosition = 1;
  busy = true;
  streamText = "";
  streamThinking = true;
  syncAsterFace();
  await persist();
  if (["review", "rewrite", "check"].includes(task)) tab = "chat";
  renderPanel();
  scrollPanelToBottom();
  unsubProgress?.();
  unsubAgentEvent?.();
  streamTools = [];
  unsubAgentEvent =
    typeof window.desk?.agentEvent === "function"
      ? window.desk.agentEvent((e) => {
          if (!e || typeof e !== "object") return;
          if (current?.id !== doc.id) return;
          if (e.type === "usage" || e.type === "done") return;
          if (e.type?.startsWith("tool")) {
            if (streamThinking) {
              streamThinking = false;
              const bubble = $("#stream-bubble");
              if (bubble)
                bubble.innerHTML = `<small class="message-role">aster · 输出中</small><div class="stream-text"></div>`;
            }
            trackToolEvent(e);
            paintStreamBubble();
          }
        })
      : null;
  unsubProgress =
    typeof window.desk?.progress === "function"
      ? window.desk.progress((chunk) => {
          if (typeof chunk !== "string" || !chunk) return;
          if (current?.id !== doc.id) return;
          streamText += chunk;
          if (streamThinking) {
            streamThinking = false;
            const bubble = $("#stream-bubble");
            if (bubble)
              bubble.innerHTML = `<small class="message-role">aster · 输出中</small><div class="stream-text"></div>`;
          }
          paintStreamBubble();
        })
      : null;
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
      title: doc.title,
      conversationId: session.id,
      skillIds,
      references: draft.references,
      instruction: (prompts[task] || "") + "\n" + instruction,
      body,
      // 编辑模式始终改全文，不把当前选区当作改写范围
      selection: task === "rewrite" ? "" : selection,
      history,
    });
    if (!result) throw Error("Agent 未返回正文");
    if (task === "rewrite" && doc.id === current?.id) {
      const guarded = protectStructure(body, result);
      pending = {
        doc: doc.id,
        conversationId: session.id,
        base: body,
        old: body,
        next: guarded.next,
        hunks: buildEditHunks(body, guarded.next),
        protectNotes: guarded.notes,
      };
      // 非破坏式审阅：正文保持原文（pending 未决定时合成结果即原文），改后只在审阅页对比；侧栏只留总结小卡片
      session.messages.push({ role: "assistant", text: summarizeRewrite(pending) });
      current.snapshots.push({ at: new Date().toISOString(), body });
      if (editor) {
        editor.commands.setContent(safeHTML(composeHunks(pending.hunks)));
        sync();
      } else {
        current.body = composeHunks(pending.hunks);
        changed();
      }
      enterReviewMode();
    } else {
      const suffix = streamTools.length
        ? `\n\n（调用工具 ${streamTools.length} 次：${[...new Set(streamTools.map((t) => t.name).filter(Boolean))].join("、")}）`
        : "";
      session.messages.push({ role: "assistant", text: result + suffix });
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
    unsubProgress?.();
    unsubProgress = null;
    unsubAgentEvent?.();
    unsubAgentEvent = null;
    streamThinking = false;
    busy = false;
    syncAsterFace();
    await persist();
    // 防止切换文章后旧请求的回复渲染到新文章的侧栏
    if (current?.id !== doc.id) return;
    if (page === "write") renderPanel();
  }
}
async function copyPublish(doc) {
  if (!doc) doc = current;
  if (doc === current) sync();
  if (!doc) return;
  const html = await publishHTML(doc.body);
  const d = new DOMParser().parseFromString(html, "text/html");
  await api("copy", { html, text: d.body.textContent });
  toast("排版已复制；本地图片请在公众号补入");
}

/**
 * 推送当前文章到微信公众号草稿箱（上传正文图与封面后 draft/add）。
 * H1/H2/引用会先画成图片再上传，保证公众号样式一致。
 * @param {object} [doc]
 */
async function pushWechatDraft(doc) {
  if (!doc) doc = current;
  if (doc === current) sync();
  if (!doc) return;
  if (isWeb()) return toast("草稿推送仅支持桌面端");
  const btn = $("#push-wechat");
  if (btn) btn.disabled = true;
  try {
    toast("正在生成标题图并推送…");
    const result = await api("wechat-draft-push", {
      account: doc.account,
      title: doc.title || "未命名文章",
      html: await publishHTML(doc.body, {
        keepImages: true,
        blockImages: true,
      }),
    });
    toast(
      `已推送到草稿箱「${result.title}」` +
        (result.imageCount ? `（上传 ${result.imageCount} 张图）` : ""),
    );
  } catch (e) {
    toast(e.message || "推送失败");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 选择笔记数据表（小红书 xlsx / X Analytics CSV） */
async function pickNoteTable() {
  const xMode = isXAccount();
  if (!isWeb()) {
    const filePath = await api("pick-note-table", { mode: currentAccountMode() });
    return filePath ? { filePath } : null;
  }
  const files = await pickFiles({
    accept: xMode
      ? ".csv,text/csv"
      : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const f = files[0];
  if (!f) return null;
  return {
    bytes: [...new Uint8Array(await f.arrayBuffer())],
  };
}

/** 弹窗询问当前粉丝量 */
function askFollowers(defaultVal) {
  return new Promise((resolve) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="dialog"><h2>更新账号数据</h2><p>请输入当前粉丝量（将显示在仪表盘）</p><input id="follower-input" type="number" min="0" step="1" value="${esc(defaultVal ?? "")}" placeholder="例如 12000"><div class="row"><button type="button" id="cancel-followers">取消</button><button type="button" id="confirm-followers" class="primary">继续</button></div></div>`;
    document.body.append(m);
    const input = $("#follower-input");
    input.focus();
    $("#cancel-followers").onclick = () => {
      m.remove();
      resolve(null);
    };
    $("#confirm-followers").onclick = () => {
      const n = Number(String(input.value).replace(/,/g, "").trim());
      m.remove();
      resolve(Number.isFinite(n) && n >= 0 ? n : null);
    };
  });
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

function renderDashboard(...a) { return time("renderDashboard", renderDashboardInner, ...a); }
function renderDashboardInner() {
  const rows = state.metrics.filter((r) => sameAccount(r["账号"], account));
  const deltas = state.metricDeltas?.[account] || null;
  const xMode = isXAccount();
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
  const sortKeys = xMode
    ? [
        ["曝光", "按曝光"],
        ["点赞", "按点赞"],
        ["回复", "按回复"],
        ["转发", "按转发"],
        ["日期", "按日期"],
      ]
    : [
        ["阅读", "按阅读量"],
        ["收藏", "按收藏"],
        ["点赞", "按点赞"],
        ["涨粉", "按涨粉"],
        ["日期", "按日期"],
      ];
  const allowedSort = new Set(sortKeys.map(([k]) => k));
  if (!allowedSort.has(metricsSort)) metricsSort = xMode ? "曝光" : "阅读";
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
  const statCards = xMode
    ? [
        ["粉丝量", "粉丝量"],
        ["曝光", "总曝光"],
        ["互动", "总互动"],
        ["点赞", "总点赞"],
        ["回复", "总回复"],
        ["转发", "总转发"],
        ["文章", "总帖子数量"],
      ]
    : [
        ["粉丝量", "粉丝量"],
        ["阅读", "总阅读"],
        ["点赞", "总点赞"],
        ["收藏", "总收藏"],
        ["评论", "总评论"],
        ["涨粉", "文章涨粉合计"],
        ["文章", "总文章数量"],
      ];
  const tableHead = xMode
    ? "<th>帖子</th><th>分组</th><th>日期</th><th>曝光</th><th>点赞</th><th>回复</th><th>转发</th>"
    : "<th>文章</th><th>分组</th><th>日期</th><th>阅读</th><th>点赞</th><th>收藏</th><th>涨粉</th>";
  const tableRow = (r) => {
    const on = publishedSelection.has(r.path);
    const g =
      typeof r["分组"] === "string" && r["分组"].trim()
        ? r["分组"].trim()
        : "";
    const cells = xMode
      ? `<td>${r["曝光"] ?? "—"}${cellDelta(r.path, "曝光")}</td><td>${r["点赞"] ?? "—"}${cellDelta(r.path, "点赞")}</td><td>${r["回复"] ?? "—"}${cellDelta(r.path, "回复")}</td><td>${r["转发"] ?? "—"}${cellDelta(r.path, "转发")}</td>`
      : `<td>${r["阅读"] ?? "—"}${cellDelta(r.path, "阅读")}</td><td>${r["点赞"] ?? "—"}${cellDelta(r.path, "点赞")}</td><td>${r["收藏"] ?? "—"}${cellDelta(r.path, "收藏")}</td><td>${r["涨粉"] ?? "—"}${cellDelta(r.path, "涨粉")}</td>`;
    return `<tr class="${on ? "is-selected" : ""}"><td class="published-check"><input type="checkbox" data-select-published="${esc(r.path)}" aria-label="选择 ${esc(r["标题"])}" ${on ? "checked" : ""}></td><td><button type="button" class="title-preview" data-published="${esc(r.path)}">${esc(r["标题"])}</button></td><td class="published-group">${g ? groupChipHtml(g) : "—"}</td><td>${esc(r["日期"])}</td>${cells}</tr>`;
  };
  const emptyHint = xMode
    ? '<div class="empty-data">还没有数据。<p>帖子归档后，导入 X Analytics CSV 或在 YAML 中填写曝光/互动等字段即可查看。</p></div>'
    : '<div class="empty-data">还没有数据。<p>文章归档后，在 YAML 中填写平台数据即可查看。</p></div>';
  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">让每一次表达，都有回响。</h1></div><div class="header-actions"><button type="button" id="refresh-dashboard" class="ghost icon-btn" title="从磁盘同步本地数据" aria-label="刷新">${I.refresh({ size: 18 })}</button><button id="import-notes" class="primary">更新数据</button></div></header><section class="dashboard"><div class="stats">${statCards
      .map(
        ([k, l]) =>
          `<div><small>${l}</small><strong title="${k === "涨粉" ? "汇总文章 YAML 的涨粉字段，不是账号净增粉丝，也不是工作台估算" : k === "粉丝量" ? "导入数据时填写的当前粉丝量" : ""}">${k === "文章" ? rows.length.toLocaleString() : k === "粉丝量" ? (state.followers?.[account] != null ? Number(state.followers[account]).toLocaleString() : "—") : sum(k)}${deltaMark(k)}</strong></div>`,
      )
      .join(
        "",
      )}</div><div id="publishing-calendar" class="dashboard-card"></div><div class="dashboard-card"><div class="row performance-head"><h3>已发布</h3><div id="published-bulk" class="published-bulk" ${selectedCount ? "" : "hidden"}><span class="published-bulk-count">已选 ${selectedCount}</span><button type="button" id="bulk-group">${I.tags()} 设置分组</button><button type="button" id="bulk-backup">${I.folder()} 本地同步</button><button type="button" id="bulk-to-draft">移回草稿</button><button type="button" class="ghost" id="bulk-clear">取消选择</button></div><select id="metrics-sort" aria-label="文章排序方式">${sortKeys.map(([k, l]) => `<option value="${k}" ${metricsSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>${
      rows.length
        ? `<table class="published-table"><thead><tr><th class="published-check"><input type="checkbox" id="published-select-all" aria-label="全选" ${allSelected ? "checked" : ""} ${selectedCount && !allSelected ? 'data-indeterminate="1"' : ""}></th>${tableHead}</tr></thead><tbody>${sorted
            .map(tableRow)
            .join("")}</tbody></table>`
        : emptyHint
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
  const openLabel = xMode ? "查看" : "预览";
  $$("[data-published]").forEach((b) => {
    b.onclick = () => openPublishedPreview(b.dataset.published);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const rel = b.dataset.published;
      showContextMenu(e.clientX, e.clientY, [
        { label: openLabel, run: () => openPublishedPreview(rel) },
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
    ...new Set(list.map((rel) => publishedGroup(state, rel) || "")),
  ];
  const selected = currentGroups.length === 1 ? currentGroups[0] || "" : "";
  $("#group-set-modal")?.remove();
  const m = document.createElement("div");
  m.id = "group-set-modal";
  m.className = "modal";
  m.innerHTML = `<div class="dialog"><h2>设置分组</h2><label>分组<select id="group-set-select">${groupOptionsHtml(state, selected)}</select></label><label>或新建分组<input id="group-set-new" placeholder="输入新分组名称" autocomplete="off"></label><div class="row"><button type="button" id="group-set-cancel">取消</button><button type="button" class="primary" id="group-set-ok">保存</button></div></div>`;
  document.body.append(m);
  $("#group-set-cancel").onclick = () => m.remove();
  $("#group-set-ok").onclick = async () => {
    const created = $("#group-set-new")?.value.trim() || "";
    const picked = $("#group-set-select")?.value || "";
    const group = created || picked || null;
    try {
      if (created) {
        await applyAccountState(await api("group-upsert", { name: created }));
      }
      await applyAccountState(await api("article-set-group", { paths: list, group }));
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
  const plan = resolveBackupPlan(state, { paths, account, preview: publishedPreview });
  if (!plan) return;
  const { list, accountId, singleGroup, mixedGroups, defaultPath, perPathDefaults,
    allHaveDefault, label, rememberTarget, defaultHint } = plan;

  /** @param {string} destDir @param {boolean} [remember] */
  const runBackup = async (destDir, remember) => {
    let ok = 0;
    for (const rel of list) {
      await api("published-backup", { rel, destDir });
      ok += 1;
    }
    if (remember && singleGroup && destDir !== defaultPath) {
      await applyAccountState(
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
      await applyAccountState(
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
  const apply = async (result) => {
    page = "dashboard";
    await applyAccountState(result);
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
        await apply(await api("recover-refresh", state));
        m.remove();
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  try {
    await apply(await api("refresh"));
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


async function setAgentEnabled(id, on) {
  ensureAgentsEnabledStore(state);
  state.agentsEnabled = { ...state.agentsEnabled, [id]: !!on };
  if (!on && state.provider === id) {
    const fallback = selectableAgentProviders(state)[0];
    if (fallback) {
      state.provider = fallback.id;
      state.model = "";
    }
  }
  await persist();
}


/**
 * 侧栏 Agent / 模型联级选择器 HTML。
 */
function modelPickerHTML() {
  const provider = railProviderId(state);
  const p = providerMeta(state, provider);
  const label = railModelLabel(state, provider);
  const agents = selectableAgentProviders(state);
  const agentRows = agents.length
    ? agents
        .map((agent) => {
          const models =
            agent.id === "zcode" ? [] : getAgentModelList(state, agent.id);
          const usingAgent = state.provider === agent.id;
          const modelBtns = [
            `<button type="button" role="menuitemradio" class="model-picker-option" data-provider="${agent.id}" data-model="" aria-checked="${usingAgent && !state.model}">${usingAgent && !state.model ? "✓ " : ""}默认</button>`,
            ...models.map(
              (m) =>
                `<button type="button" role="menuitemradio" class="model-picker-option" data-provider="${agent.id}" data-model="${esc(m)}" aria-checked="${usingAgent && state.model === m}">${usingAgent && state.model === m ? "✓ " : ""}${esc(m)}</button>`,
            ),
          ].join("");
          return `<div class="model-picker-agent" data-agent="${agent.id}">
            <button type="button" class="model-picker-agent-btn" role="menuitem" aria-haspopup="menu" aria-expanded="false">
              <span class="model-picker-logo">${agentLogoSvg(agent.id, 16)}</span>
              <span class="model-picker-agent-name">${esc(agent.label)}</span>
              ${usingAgent ? `<span class="model-picker-current">使用中</span>` : ""}
              ${I.chevronRight({ size: 12 })}
            </button>
            <div class="model-picker-submenu" hidden role="menu">${modelBtns}</div>
          </div>`;
        })
        .join("")
    : `<p class="model-picker-empty">暂无可用的 Agent</p>`;
  return `<div class="model-picker" id="model-picker">
    <button type="button" id="model-picker-trigger" class="model-picker-trigger" title="${esc(p?.label || "")} · ${esc(label)}" aria-label="选择模型：${esc(label)}" aria-haspopup="menu" aria-expanded="false">
      <span class="model-picker-logo">${agentLogoSvg(provider, 16)}</span>
      <span class="model-picker-label">${esc(label)}</span>
      ${I.chevronDown({ size: 12 })}
    </button>
    <div id="model-picker-menu" class="model-picker-menu" hidden role="menu">${agentRows}</div>
  </div>`;
}

/**
 * 绑定侧栏模型联级菜单：一级 Agent，二级已添加模型（含默认）。
 * 菜单使用 fixed 定位，避免被 composer / rail 裁切。
 */
function bindModelPicker() {
  const root = $("#model-picker");
  const trigger = $("#model-picker-trigger");
  const menu = $("#model-picker-menu");
  if (!root || !trigger || !menu) return;

  /** @type {((e: Event) => void) | null} */
  let onDocPointer = null;

  const clearFixed = (el) => {
    el.style.position = "";
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.bottom = "";
    el.style.zIndex = "";
    el.classList.remove("is-fixed");
  };

  const closeAll = () => {
    menu.setAttribute("hidden", "");
    trigger.setAttribute("aria-expanded", "false");
    clearFixed(menu);
    root.querySelectorAll(".model-picker-submenu").forEach((el) => {
      el.setAttribute("hidden", "");
      clearFixed(el);
    });
    root.querySelectorAll(".model-picker-agent-btn").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
    if (onDocPointer) {
      document.removeEventListener("pointerdown", onDocPointer, true);
      onDocPointer = null;
    }
    if (activeComposerMenuDismiss === closeAll) activeComposerMenuDismiss = null;
  };

  const placeMenu = () => {
    const rect = trigger.getBoundingClientRect();
    menu.classList.add("is-fixed");
    menu.style.position = "fixed";
    menu.style.zIndex = "200";
    menu.style.left = "auto";
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.top = "auto";
    menu.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  };

  const placeSubmenu = (agentEl) => {
    const sub = agentEl.querySelector(".model-picker-submenu");
    const btn = agentEl.querySelector(".model-picker-agent-btn");
    if (!sub || !btn) return;
    sub.classList.add("is-fixed");
    sub.style.position = "fixed";
    sub.style.zIndex = "201";
    const btnRect = btn.getBoundingClientRect();
    const subW = sub.offsetWidth || 160;
    const subH = sub.offsetHeight || 40;
    let left = btnRect.left - subW - 4;
    if (left < 8) left = Math.min(btnRect.right + 4, window.innerWidth - subW - 8);
    let top = btnRect.bottom - subH;
    if (top < 8) top = 8;
    if (top + subH > window.innerHeight - 8)
      top = Math.max(8, window.innerHeight - subH - 8);
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
    sub.style.right = "auto";
    sub.style.bottom = "auto";
  };

  const openSubmenu = (agentEl) => {
    root.querySelectorAll(".model-picker-agent").forEach((el) => {
      const sub = el.querySelector(".model-picker-submenu");
      const btn = el.querySelector(".model-picker-agent-btn");
      const open = !!agentEl && el === agentEl;
      if (sub) {
        if (open) {
          sub.removeAttribute("hidden");
          placeSubmenu(el);
        } else {
          sub.setAttribute("hidden", "");
          clearFixed(sub);
        }
      }
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  };

  trigger.onclick = (e) => {
    e.stopPropagation();
    const willOpen = menu.hasAttribute("hidden");
    dismissActiveComposerMenu();
    if (!willOpen) return;
    menu.removeAttribute("hidden");
    trigger.setAttribute("aria-expanded", "true");
    activeComposerMenuDismiss = closeAll;
    placeMenu();
    const active = root.querySelector(
      `.model-picker-agent[data-agent="${CSS.escape(railProviderId(state))}"]`,
    );
    if (active) openSubmenu(active);
    onDocPointer = (ev) => {
      const t = /** @type {Node} */ (ev.target);
      if (root.contains(t) || menu.contains(t)) return;
      if (
        [...root.querySelectorAll(".model-picker-submenu")].some((s) =>
          s.contains(t),
        )
      )
        return;
      closeAll();
    };
    document.addEventListener("pointerdown", onDocPointer, true);
  };

  root.querySelectorAll(".model-picker-agent").forEach((agentEl) => {
    const btn = agentEl.querySelector(".model-picker-agent-btn");
    if (!btn) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      const sub = agentEl.querySelector(".model-picker-submenu");
      const opening = sub?.hasAttribute("hidden");
      openSubmenu(opening ? agentEl : null);
    };
    agentEl.onmouseenter = () => openSubmenu(agentEl);
  });

  root.querySelectorAll(".model-picker-option[data-provider]").forEach((opt) => {
    opt.onclick = async (e) => {
      e.stopPropagation();
      const provider = opt.getAttribute("data-provider") || "";
      const model = opt.getAttribute("data-model") || "";
      if (!provider || !agentInstalled(state, provider) || !agentEnabled(state, provider)) {
        toast("该 Agent 不可用");
        return;
      }
      state.provider = provider;
      state.model = model;
      closeAll();
      await persistAgentModels();
      const label = railModelLabel(state, provider);
      const logo = trigger.querySelector(".model-picker-logo");
      const text = trigger.querySelector(".model-picker-label");
      if (logo) logo.innerHTML = agentLogoSvg(provider, 16);
      if (text) text.textContent = label;
      const agentLabel = providerMeta(state, provider)?.label || "";
      trigger.title = `${agentLabel} · ${label}`;
      trigger.setAttribute("aria-label", `选择模型：${label}`);
      root.querySelectorAll(".model-picker-option[data-provider]").forEach((btn) => {
        const on =
          btn.getAttribute("data-provider") === provider &&
          (btn.getAttribute("data-model") || "") === model;
        btn.setAttribute("aria-checked", on ? "true" : "false");
        const raw = (btn.getAttribute("data-model") || "") || "默认";
        const name = btn.getAttribute("data-model") ? raw : "默认";
        btn.textContent = on ? `✓ ${name}` : name;
      });
      root.querySelectorAll(".model-picker-agent").forEach((el) => {
        const mark = el.querySelector(".model-picker-current");
        const isOn = el.getAttribute("data-agent") === provider;
        if (isOn && !mark) {
          const name = el.querySelector(".model-picker-agent-name");
          name?.insertAdjacentHTML(
            "afterend",
            `<span class="model-picker-current">使用中</span>`,
          );
        } else if (!isOn && mark) mark.remove();
      });
    };
  });
}


function openAgentDetail(id, tab = "connection") {
  agentDetailId = id;
  agentDetailTab = tab;
  page = "agent";
  render();
}



function setModelRowStatus(provider, model, text, kind = "") {
  const root =
    $(`[data-agent-body="${provider}"]`) ||
    $(`.agent-card[data-agent="${provider}"]`) ||
    document;
  const el = [...root.querySelectorAll("[data-model-status]")].find(
    (n) => n.getAttribute("data-model-status") === model,
  );
  if (!el) return;
  el.textContent = text || "";
  el.dataset.kind = kind;
}

async function persistAgentModels() {
  ensureAgentModelsStore(state);
  ensureAgentHttpStore(state);
  return persist();
}

async function fillAgentCard(p, refresh = false) {
  const body = $(`[data-agent-body="${p.id}"]`);
  if (!body) return;
  if (p.http) {
    let info = null;
    try {
      info = await api("agent-models", { provider: p.id, refresh });
    } catch (e) {
      info = { models: [], source: "", error: e.message || "读取失败" };
    }
    body.innerHTML = agentModelsPanelHtml(state, p, info);
    bindAgentModelControls(p);
    return;
  }
  let info = { models: [], selectable: p.id !== "zcode", current: "" };
  try {
    info = await api("agent-models", { provider: p.id, refresh });
  } catch (e) {
    info = {
      models: [],
      selectable: p.id !== "zcode",
      current: "",
      error: e.message || "读取失败",
    };
  }
  body.innerHTML = agentModelsPanelHtml(state, p, info);
  bindAgentModelControls(p);
}

function bindAgentModelControls(p) {
  if (p.http) {
    const panel = $(`[data-agent-body="${p.id}"]`) || document;
    const saveBtn = panel.querySelector(`[data-agent-http-save="${p.id}"]`);
    const keyInput = panel.querySelector(`[data-agent-http-key="${p.id}"]`);
    // 已存 Key 用脱敏占位展示；聚焦时清空以便改写
    if (keyInput?.dataset.keySaved === "1") {
      keyInput.onfocus = () => {
        if (keyInput.dataset.keySaved !== "1") return;
        keyInput.value = "";
        keyInput.dataset.keySaved = "0";
        keyInput.placeholder = "输入新 Key，留空则保持已存";
      };
    }
    if (saveBtn)
      saveBtn.onclick = async () => {
        const base =
          panel.querySelector(`[data-agent-http-base="${p.id}"]`)?.value.trim() ||
          "";
        const typed = keyInput?.value || "";
        const prev = getAgentHttp(state, p.id);
        // 脱敏占位未改时不算新 Key；禁止把 •••• 占位写进仓库
        const keepingMask =
          keyInput?.dataset.keySaved === "1" ||
          /^[•*·]{2,}/.test(typed);
        const apiKey = (
          keepingMask || !typed ? prev.apiKey || "" : typed
        )
          .trim()
          .replace(/[\u200b-\u200d\ufeff]/g, "");
        if (!apiKey) return toast("请先填写 API Key");
        if (/^[•*·]/.test(apiKey))
          return toast("请重新粘贴完整 API Key（不要保存脱敏占位）");
        setAgentHttp(state, p.id, {
          ...prev,
          baseURL: base.replace(/\/$/, ""),
          apiKey,
        });
        state.agents = { ...state.agents, [p.id]: true };
        const ok = await persistAgentModels();
        if (!ok) return;
        const mask = "••••" + apiKey.slice(-4);
        if (keyInput) {
          keyInput.dataset.keySaved = "1";
          keyInput.dataset.keyMask = mask;
          keyInput.value = mask;
          keyInput.placeholder = "已保存，留空不改动";
          keyInput.onfocus = () => {
            if (keyInput.dataset.keySaved !== "1") return;
            keyInput.value = "";
            keyInput.dataset.keySaved = "0";
            keyInput.placeholder = "输入新 Key，留空则保持已存";
          };
        }
        const label = keyInput
          ?.closest("label")
          ?.querySelector(".settings-field-label");
        if (label) label.textContent = `API Key（已存 ${mask}）`;
        toast("已保存，可点测试连通验证");
        fillAgentCard(p);
      };
    const testHttp = panel.querySelector(`[data-agent-test-default="${p.id}"]`);
    if (testHttp) testHttp.onclick = () => runAgentDefaultTest(p.id);
    panel.querySelectorAll(`[data-agent-remove="${p.id}"]`).forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm(`移除供应商 ${p.label}？将同时清除本地 Key 与模型。`)) return;
        removeAgentHttp(state, p.id);
        await persistAgentModels();
        toast("已移除供应商");
        agentDetailId = null;
        page = "settings";
        settingsTab = "agents";
        render();
      };
    });
  }
  const refresh = $(`[data-agent-refresh="${p.id}"]`);
  if (refresh) refresh.onclick = async () => { refresh.disabled = true; refresh.textContent = "刷新中…"; await fillAgentCard(p, true); };
  const useDefault = $(`[data-agent-cli-default="${p.id}"]`);
  if (useDefault)
    useDefault.onclick = async () => {
      if (!agentEnabled(state, p.id)) await setAgentEnabled(p.id, true);
      state.provider = p.id;
      state.model = "";
      await persistAgentModels();
      render();
    };

  const addBtn = $(`[data-agent-add-model="${p.id}"]`);
  const pick = $(`[data-agent-pick="${p.id}"]`);
  const preset = $(`[data-agent-preset="${p.id}"]`);
  if (preset && pick)
    preset.onchange = () => {
      if (preset.value) pick.value = preset.value;
    };
  const addModel = async () => {
    const value = (pick?.value || "").trim();
    if (!value) return toast("请输入或选择模型 ID");
    const next = [...getAgentModelList(state, p.id), value];
    setAgentModelList(state, p.id, next);
    await persistAgentModels();
    if (pick) pick.value = "";
    if (preset) preset.value = "";
    toast("已添加模型");
    fillAgentCard(p);
  };
  if (addBtn) addBtn.onclick = addModel;
  if (pick)
    pick.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addModel();
      }
    };

  $$(`[data-agent-use="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      if (!agentEnabled(state, p.id)) await setAgentEnabled(p.id, true);
      if (state.provider !== p.id) state.provider = p.id;
      state.model = model;
      await persistAgentModels();
      toast(`已使用 ${model}`);
      render();
    };
  });

  $$(`[data-agent-remove-model="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      setAgentModelList(state, 
        p.id,
        getAgentModelList(state, p.id).filter((m) => m !== model),
      );
      if (state.provider === p.id && state.model === model) state.model = "";
      await persistAgentModels();
      fillAgentCard(p);
    };
  });

  $$(`[data-agent-test-model="${p.id}"]`).forEach((btn) => {
    btn.onclick = async () => {
      const model = btn.dataset.model || "";
      btn.disabled = true;
      setModelRowStatus(p.id, model, "测试中…", "pending");
      try {
        const result = await api("agent-test", { provider: p.id, model });
        if (result.ok) {
          const ms = result.latencyMs != null ? `${result.latencyMs}ms` : "ok";
          setModelRowStatus(p.id, model, ms, "ok");
          toast(`${p.label} · ${model} 连通正常`);
        } else {
          setModelRowStatus(p.id, model, result.error || "失败", "err");
          toast(result.error || "连接失败");
        }
      } catch (e) {
        setModelRowStatus(p.id, model, e.message || "失败", "err");
        toast(e.message || "连接失败");
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function runAgentDefaultTest(id) {
  const p = providerMeta(state, id);
  if (!p?.http && !agentInstalled(state, id)) return toast("未找到该 CLI");
  const btn =
    $(`[data-agent-test-default="${id}"]`) || $("#agent-test-default");
  if (btn) btn.disabled = true;
  toast(`${p?.label || id}：测试${p?.http ? "连通" : " CLI 默认"}…`);
  try {
    const result = await api("agent-test", { provider: id, model: "" });
    if (result.ok) {
      toast(
        `${p?.label || id} 默认连通正常` +
          (result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""),
      );
    } else toast(result.error || "连接失败");
  } catch (e) {
    toast(e.message || "连接失败");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 就地刷新模型列表（不开整页 render，保留 #main 滚动位置） */
function refreshAgentCardList() {
  const list = $(".agent-card-list");
  if (!list) return false;
  list.innerHTML = connectedAgentProviders(state)
    .map((p) => agentListItemHtml(state, p))
    .join("");
  bindAgentListControls();
  return true;
}

function bindAgentListControls() {
  $$("[data-open-agent]").forEach((item) => {
    const open = () => openAgentDetail(item.dataset.openAgent);
    item.onclick = (e) => {
      if (e.target.closest("[data-agent-enable], [data-agent-remove], .agent-switch, .agent-remove-btn")) return;
      open();
    };
    item.onkeydown = (e) => {
      if (e.target.closest("[data-agent-enable], [data-agent-remove], .agent-switch")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };
  });
  $$("[data-agent-remove]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-agent-remove") || "";
      if (!id) return;
      const meta = providerMeta(state, id);
      if (!confirm(`移除供应商 ${meta?.label || id}？将同时清除本地 Key 与模型。`)) return;
      removeAgentHttp(state, id);
      await persistAgentModels();
      toast("已移除供应商");
      render();
    };
  });
  $$("[data-agent-enable]").forEach((input) => {
    input.onclick = (e) => e.stopPropagation();
    input.onchange = async () => {
      const id = input.getAttribute("data-agent-enable") || "";
      if (!id) return;
      input.disabled = true;
      try {
        await setAgentEnabled(id, input.checked);
        if (!refreshAgentCardList()) render();
      } catch (e) {
        input.checked = !input.checked;
        toast(e.message || "保存失败");
        input.disabled = false;
      }
    };
  });
}

async function mountAgentsSettings() {
  try {
    const next = await api("load");
    if (next?.agents) state.agents = next.agents;
    if (next?.agentModels) state.agentModels = next.agentModels;
    if (next?.agentHttp) state.agentHttp = next.agentHttp;
    if (next?.agentsEnabled) state.agentsEnabled = next.agentsEnabled;
  } catch {
    /* keep cached */
  }
  ensureAgentModelsStore(state);
  ensureAgentsEnabledStore(state);

  bindAgentListControls();
  mountAgentUsage($("#agent-usage"), api, connectedAgentProviders(state), {
    mode: "overview",
  });
  const addBtn = $("#add-agent-provider");
  if (addBtn)
    addBtn.onclick = async () => {
      const pick = await promptConnectProvider(state);
      if (!pick) return;
      const id = await addProviderFromCatalog(state, pick, promptText);
      if (!id) return;
      ensureAgentsEnabledStore(state);
      state.agentsEnabled = { ...state.agentsEnabled, [id]: true };
      await persistAgentModels();
      openAgentDetail(id);
    };
}

async function renderAgentDetail() {
  const p = providerMeta(state, agentDetailId);
  if (!p) {
    page = "settings";
    settingsTab = "agents";
    agentDetailId = null;
    render();
    return;
  }
  try {
    const next = await api("load");
    if (next?.agents) state.agents = next.agents;
    if (next?.agentModels) state.agentModels = next.agentModels;
    if (next?.agentHttp) state.agentHttp = next.agentHttp;
    if (next?.agentsEnabled) state.agentsEnabled = next.agentsEnabled;
  } catch {
    /* keep cached */
  }
  ensureAgentModelsStore(state);
  ensureAgentHttpStore(state);
  ensureAgentsEnabledStore(state);
  if (!["connection", "usage"].includes(agentDetailTab))
    agentDetailTab = "connection";

  const installed = agentInstalled(state, p.id);
  const enabled = agentEnabled(state, p.id);
  const isDefault = state.provider === p.id;
  const tabs = [
    { id: "connection", title: "连接" },
    { id: "usage", title: "使用统计" },
  ];
  const actions = [
    isDefault
      ? ""
      : `<button type="button" class="primary" id="agent-set-default" ${installed ? "" : "disabled"}>设为默认</button>`,
    `<button type="button" class="ghost" id="agent-test-default" ${installed ? "" : "disabled"} title="不指定模型，使用 CLI 默认">测试默认</button>`,
  ]
    .filter(Boolean)
    .join("");

  const shell = (body) => {
    $("#main").innerHTML =
      `<header><div class="header-lead account-detail-lead"><button type="button" class="ghost icon-btn" id="agent-detail-back" title="返回模型列表" aria-label="返回模型列表">${I.chevronLeft({ size: 22 })}</button><h1 class="dashboard-tagline">${esc(p.label)}</h1></div><div class="header-actions">${actions}</div></header><section class="dashboard account-detail settings agent-detail"><nav class="settings-tabs account-detail-tabs" role="tablist">${tabs
        .map(
          (t) =>
            `<button type="button" role="tab" data-agent-tab="${t.id}" aria-selected="${agentDetailTab === t.id}" class="${agentDetailTab === t.id ? "active" : ""}">${t.title}</button>`,
        )
        .join("")}</nav><div id="agent-detail-body" class="settings-body">${body}</div></section>`;
    $("#agent-detail-back").onclick = () => {
      page = "settings";
      settingsTab = "agents";
      agentDetailId = null;
      render();
    };
    const setDefault = $("#agent-set-default");
    if (setDefault)
      setDefault.onclick = async () => {
        if (!agentInstalled(state, p.id)) return toast("未找到该 CLI");
        if (!agentEnabled(state, p.id)) await setAgentEnabled(p.id, true);
        state.provider = p.id;
        state.model = "";
        await persistAgentModels();
        toast(`已设为默认：${p.label}`);
        render();
      };
    const testDefault = $("#agent-test-default");
    if (testDefault)
      testDefault.onclick = () => runAgentDefaultTest(p.id);
    $$("[data-agent-tab]").forEach((b) => {
      b.onclick = () => {
        agentDetailTab = b.dataset.agentTab;
        render();
      };
    });
  };

  if (agentDetailTab === "usage") {
    shell(
      settingsSection({
        title: "调用明细",
        className: "settings-section-agents",
        control: `<section id="agent-usage" class="agent-usage"></section>`,
      }),
    );
    mountAgentUsage($("#agent-usage"), api, connectedAgentProviders(state), {
      mode: "detail",
      provider: p.id,
    });
    return;
  }

  shell(
    [
      settingsSection({
        title: "基本信息",
        control: settingsPanel(
          `<div class="account-overview-top agent-overview-top"><div class="agent-card-logo agent-overview-logo">${agentLogoSvg(p.id)}</div><div class="account-overview-info"><h2>${esc(p.label)}</h2><div class="account-stat-meta"><span class="agent-badge ${installed ? "agent-badge-ok" : "agent-badge-miss"}">${installed ? "已安装" : "未安装"}</span>${enabled ? "" : `<span class="agent-badge agent-badge-off">已关闭</span>`}${isDefault ? `<span class="agent-badge agent-badge-default">默认</span>` : ""}<span>${esc(p.blurb)}</span></div></div></div>`,
        ),
      }),
      settingsSection({
        title: "模型",
        className: "settings-section-agents",
        control: settingsPanel(
          `<div data-agent-body="${p.id}"><p class="settings-hint">读取可用模型…</p></div>`,
        ),
      }),
    ].join(""),
  );
  await fillAgentCard(p);
}

function renderSettings() {
  if (
    settingsTab !== "config" &&
    settingsTab !== "agents" &&
    settingsTab !== "accounts" &&
    settingsTab !== "groups" &&
    settingsTab !== "skills"
  )
    settingsTab = "config";
  const tabs = [
    { id: "config", title: "配置" },
    { id: "agents", title: "模型" },
    { id: "accounts", title: "账号" },
    { id: "groups", title: "分组" },
    { id: "skills", title: "技能" },
  ];

  const configBody = [
    settingsSection({
      control: settingsPanel(
        `<h3 class="settings-section-title">关于</h3>` +
          `<div class="settings-app-identity"><img src="assets/logo.png" alt="" class="settings-app-logo" width="48" height="48"><div class="settings-app-meta"><strong class="settings-app-name">Aster*</strong><div class="settings-status-row"><div><span class="settings-field-label">当前版本</span><strong class="settings-version">${esc(state._appVersion || "…")}</strong></div></div></div></div>` +
          `<div class="settings-panel-footer"><button type="button" id="open-releases">${I.external()} 发布页</button><button type="button" id="check-update">${I.refresh()} 检测更新</button>${state._update?.available ? `<button type="button" class="primary" id="install-update">下载并安装</button>` : ""}</div>`,
      ),
    }),
    settingsSection({
      control: settingsPanel(
        `<h3 class="settings-section-title">仓库路径</h3>` +
          `${state.warnings?.length ? `<p class="notice">${state.warnings.map(esc).join("<br>")}</p>` : ""}` +
          `<span class="settings-path-row"><input id="vault-path" value="${esc(state.vaultPath || state.source || "")}" placeholder="选择 Content_OS 目录" readonly><button type="button" id="pick-vault" ${state.vaultLocked ? "disabled" : ""}>${I.folder()} 选择</button><button type="button" class="ghost" id="refresh-vault">${I.refresh()} 刷新</button></span>` +
          (state.vaultLocked
            ? `<p class="settings-hint">当前仓库由环境变量指定，无法在界面中更改。</p>`
            : ""),
      ),
    }),
  ].join("");

  const agentsBody = [
    settingsSection({
      className: "settings-section-agents",
      control: `<section id="agent-usage" class="agent-usage"></section>`,
    }),
    settingsSection({
      title: "模型连接",
      className: "settings-section-agents",
      action: `<button type="button" class="primary" id="add-agent-provider">${I.plus()} 添加</button>`,
      control: `<div class="agent-card-list">${connectedAgentProviders(state).map((p) => agentListItemHtml(state, p)).join("")}</div>`,
    }),
  ].join("");

  const accounts = accountList();
  const accountsBody = settingsSection({
    control:
      `<div class="settings-panel-toolbar"><button type="button" id="register-account">${I.folder()} 选择文件夹</button><button type="button" class="primary" id="create-account">${I.plus()} 新建账号</button></div>` +
      (accounts.length
        ? `<div class="account-list">${accounts
            .map(
              (a) =>
                `<button type="button" class="account-list-item" data-open-account="${esc(a.id)}"><span class="account-avatar-btn account-avatar-md" aria-hidden="true">${accountAvatarHtml(a)}</span><span class="account-list-main"><strong>${esc(a.label)} <em class="account-mode-tag">${esc(accountModeLabel(a.mode))}</em></strong><span class="muted">${a.drafts ?? 0} 草稿 · ${a.archives ?? 0} 归档 · ${formatBytes(a.bytes)}</span></span><span class="account-list-chevron" aria-hidden="true">›</span></button>`,
            )
            .join("")}</div>`
        : settingsPanel(
            `<p class="settings-empty">尚未添加账号。可选择仓库内已有文件夹，或新建账号。</p>`,
          )),
  });

  const groups = groupNames(state);
  const groupsBody = settingsSection({
    control:
      `<div class="settings-panel-toolbar"><button type="button" class="primary" id="create-group">${I.plus()} 新建分组</button></div>` +
      (groups.length
        ? settingsPanel(
            `<table class="groups-table"><thead><tr><th>分组</th><th>本地同步默认路径</th><th class="groups-actions-col">操作</th></tr></thead><tbody>${groups
              .map((name) => {
                const backup = state.groups?.[name]?.backupPath || "";
                return `<tr><td>${groupChipHtml(name)}</td><td><span class="settings-path-row groups-path-row"><input type="text" value="${esc(backup)}" placeholder="未设置，同步时可选择并记住" readonly><button type="button" data-pick-group-backup="${esc(name)}">${I.folder()} 选择</button>${backup ? `<button type="button" class="ghost" data-clear-group-backup="${esc(name)}">清除</button>` : ""}</span></td><td class="groups-actions-col"><button type="button" class="ghost" data-rename-group="${esc(name)}">重命名</button><button type="button" class="ghost" data-delete-group="${esc(name)}">删除</button></td></tr>`;
              })
              .join("")}</tbody></table>`,
            "settings-panel-flush",
          )
        : settingsPanel(
            `<p class="settings-empty">还没有分组。新建后即可在文章中选用，并为每个分组设置默认同步路径。</p>`,
          )),
  });

  const body =
    settingsTab === "config"
      ? configBody
      : settingsTab === "agents"
        ? agentsBody
        : settingsTab === "accounts"
          ? accountsBody
          : settingsTab === "skills"
            ? `<div id="skills-settings-root"></div>`
            : groupsBody;

  $("#main").innerHTML =
    `<header><div class="header-lead"><h1 class="dashboard-tagline">设置</h1></div></header><section class="dashboard settings"><nav class="settings-tabs" role="tablist">${tabs
      .map(
        (t) =>
          `<button type="button" role="tab" data-settings-tab="${t.id}" aria-selected="${settingsTab === t.id}" class="${settingsTab === t.id ? "active" : ""}">${t.title}</button>`,
      )
      .join("")}</nav><div class="settings-body">${body}</div></section>`;
  $$("[data-settings-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        settingsTab = b.dataset.settingsTab;
        agentDetailId = null;
        render();
      }),
  );
  if (settingsTab === "skills") {
    const list = accountList();
    const skillAccount = list.some((a) => a.id === account)
      ? account
      : list[0]?.id;
    mountSkillsSettings(
      $("#skills-settings-root"),
      api,
      skillAccount,
      list,
      () => {},
      { layout: "sections" },
    );
  }
  if (settingsTab === "agents") {
    mountAgentsSettings();
  }
  if (settingsTab === "config") {
    $("#open-releases").onclick = async () => {
      try {
        await api("update-open-releases");
      } catch (e) {
        toast(e.message || "无法打开发布页");
      }
    };
    $("#check-update").onclick = () => checkForAppUpdate({ manual: true });
    const installBtn = $("#install-update");
    if (installBtn) installBtn.onclick = () => installAppUpdate();
    $("#pick-vault").onclick = async () => {
      if (isWeb()) return toast("选择仓库仅支持桌面端");
      if (state.vaultLocked) return toast("当前仓库由环境变量指定，无法更改");
      if (busy) return toast("AI 正在回复，请结束后再切换");
      try {
        const result = await api("pick-vault");
        if (!result) return;
        await applyAccountState(result);
        toast("已切换内容仓库");
      } catch (e) {
        toast(e.message || "切换失败");
      }
    };
    $("#refresh-vault").onclick = () => refreshVault();
  } else if (settingsTab === "accounts") {
    const createBtn = $("#create-account");
    const registerBtn = $("#register-account");
    if (createBtn)
      createBtn.onclick = async () => {
        const created = await askCreateAccount();
        if (!created?.name?.trim()) return;
        try {
          await applyAccountState(
            await api("account-create", {
              name: created.name.trim(),
              mode: created.mode,
            }),
          );
          toast("已创建账号");
        } catch (e) {
          toast(e.message || "创建失败");
        }
      };
    if (registerBtn) registerBtn.onclick = () => pickAndRegisterAccountFolder();
    $$("[data-open-account]").forEach((b) => {
      b.onclick = () => openAccountDetail(b.dataset.openAccount, "detail");
    });
  }
  if (settingsTab === "groups") {
    $("#create-group").onclick = async () => {
      const name = await promptText("新建分组", {
        placeholder: "例如：公众号、小红书",
        okLabel: "创建",
      });
      if (!name) return;
      try {
        await applyAccountState(await api("group-upsert", { name }));
        toast("分组已创建");
      } catch (e) {
        toast(e.message || "创建失败");
      }
    };
    $$("[data-rename-group]").forEach((b) => {
      b.onclick = async () => {
        const oldName = b.dataset.renameGroup;
        const name = await promptText("重命名分组", {
          value: oldName,
          okLabel: "保存",
        });
        if (!name || name === oldName) return;
        try {
          await applyAccountState(
            await api("group-upsert", {
              name,
              oldName,
            }),
          );
          toast("已重命名");
        } catch (e) {
          toast(e.message || "重命名失败");
        }
      };
    });
    $$("[data-delete-group]").forEach((b) => {
      b.onclick = async () => {
        const name = b.dataset.deleteGroup;
        if (
          !confirm(
            `删除分组「${name}」？文章上的分组标签会保留，但不再有默认同步路径。`,
          )
        )
          return;
        try {
          await applyAccountState(await api("group-delete", { name }));
          toast("已删除分组");
        } catch (e) {
          toast(e.message || "删除失败");
        }
      };
    });
    $$("[data-pick-group-backup]").forEach((b) => {
      b.onclick = () => pickGroupBackupPath(b.dataset.pickGroupBackup);
    });
    $$("[data-clear-group-backup]").forEach((b) => {
      b.onclick = async () => {
        try {
          await applyAccountState(
            await api("group-set-backup-path", {
              name: b.dataset.clearGroupBackup,
              path: "",
            }),
          );
          toast("已清除分组默认同步路径");
        } catch (e) {
          toast(e.message || "清除失败");
        }
      };
    });
  }
}

/**
 * 为分组选择并保存本地同步默认目录。
 * @param {string} name
 */
async function pickGroupBackupPath(name) {
  if (isWeb()) return toast("选择备份路径仅支持桌面端");
  if (!name) return toast("分组无效");
  try {
    const folder = await api("pick-backup-folder", {
      defaultPath: state.groups?.[name]?.backupPath || "",
    });
    if (!folder) return;
    await applyAccountState(
      await api("group-set-backup-path", { name, path: folder }),
    );
    toast("分组默认同步路径已保存");
  } catch (e) {
    toast(e.message || "设置失败");
  }
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
    await applyAccountState(
      await api("account-set-backup-path", { id: accountId, path: folder }),
    );
    toast("默认备份路径已保存");
  } catch (e) {
    toast(e.message || "设置失败");
  }
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
    await applyAccountState(result);
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
/**
 * 选择仓库内文件夹并注册为账号（桌面弹系统对话框，网页列出可选目录）。
 */
async function pickAndRegisterAccountFolder() {
  try {
    const mode = await askAccountMode();
    if (!mode) return;
    let result = null;
    if (!isWeb()) {
      result = await api("pick-account-folder", { mode });
    } else {
      const folder = await pickAccountFolderOnWeb();
      if (!folder) return;
      result = await api("account-register", { folder, mode });
    }
    if (!result) return;
    await applyAccountState(result);
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
 * 同步后必须重拉草稿文件夹列表，否则本地已删的空文件夹会残留在侧栏。
 * @param {object} result
 */
async function applyAccountState(result) {
  const id = current?.id;
  Object.assign(state, result);
  ensureAccount();
  current =
    state.documents.find((d) => d.id === id) ||
    state.documents.find((d) => sameAccount(d.account, account)) ||
    null;
  dirty = false;
  pending = null;
  await refreshDraftProjects();
  render();
}
async function refreshVault() {
  if (busy) return toast("AI 正在回复，请结束后刷新");
  sync();
  const apply = async (result) => {
    await applyAccountState(result);
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
        await apply(result);
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  try {
    await apply(await api("refresh"));
  } catch (e) {
    toast(e.message);
  }
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
async function renderAccountDetail() {
  const a = account;
  const acc = accountList().find((x) => x.id === a);
  if (!acc) {
    page = "settings";
    settingsTab = "accounts";
    render();
    return;
  }
  if (!["detail", "settings", "skills"].includes(accountDetailTab))
    accountDetailTab = "detail";
  const tabs = [
    { id: "detail", title: "详情" },
    { id: "settings", title: "设定" },
    { id: "skills", title: "技能" },
  ];
  const shell = (body) => {
    $("#main").innerHTML =
      `<header><div class="header-lead account-detail-lead"><button type="button" class="ghost icon-btn" id="account-detail-back" title="账号列表" aria-label="返回账号列表">${I.chevronLeft({ size: 22 })}</button><h1 class="dashboard-tagline">${esc(acc.label)}</h1></div><div class="header-actions"><button type="button" class="danger" id="account-unregister">移除账号</button></div></header><section class="dashboard account-detail settings"><nav class="settings-tabs account-detail-tabs" role="tablist">${tabs
        .map(
          (t) =>
            `<button type="button" role="tab" data-account-tab="${t.id}" aria-selected="${accountDetailTab === t.id}" class="${accountDetailTab === t.id ? "active" : ""}">${t.title}</button>`,
        )
        .join("")}</nav><div id="account-detail-body" class="settings-body">${body}</div></section>`;
    $("#account-detail-back").onclick = async () => {
      if (saveProfileEditor && !(await saveProfileEditor())) return;
      page = "settings";
      settingsTab = "accounts";
      render();
    };
    $("#account-unregister").onclick = async () => {
      const ok = await askConfirm(
        "移除账号",
        "仅从列表移除，不会删除磁盘文件夹。继续？",
      );
      if (!ok) return;
      try {
        page = "settings";
        settingsTab = "accounts";
        await applyAccountState(await api("account-unregister", { id: a }));
        toast("已移除账号");
      } catch (e) {
        toast(e.message || "移除失败");
      }
    };
    $$("[data-account-tab]").forEach((b) => {
      b.onclick = async () => {
        if (
          accountDetailTab === "settings" &&
          saveProfileEditor &&
          !(await saveProfileEditor())
        )
          return;
        accountDetailTab = b.dataset.accountTab;
        render();
      };
    });
  };
  if (accountDetailTab === "detail") {
    const backup = state.backupPaths?.[a] || "";
    const wx =
      state.wechatAccounts?.[a] ||
      (state.wechat?.appId || state.wechat?.appSecret ? state.wechat : {}) ||
      {};
    const xMode = normalizeAccountMode(acc.mode) === "x";
    const sections = [
      settingsSection({
        title: "基本信息",
        control: settingsPanel(
          `<div class="account-overview-top"><button type="button" class="account-avatar-btn account-avatar-lg" id="account-set-avatar" title="${acc.avatar ? "更换头像" : "添加头像"}" aria-label="为 ${esc(acc.label)} ${acc.avatar ? "更换头像" : "添加头像"}">${accountAvatarHtml(acc, "lg")}</button><div class="account-overview-info"><h2>${esc(acc.label)}</h2><div class="account-stat-meta"><span class="account-mode-tag">${esc(accountModeLabel(acc.mode))}</span><span>${acc.drafts ?? 0} 草稿</span><span>${acc.archives ?? 0} 归档</span><span>${acc.files ?? 0} 文件</span><span>${formatBytes(acc.bytes)}</span></div></div></div>`,
        ),
      }),
      settingsSection({
        title: "本地备份",
        control: settingsPanel(
          settingsField(
            "备份路径",
            `<span class="settings-path-row"><input type="text" value="${esc(backup)}" placeholder="未设置，同步时可选择" readonly><button type="button" id="account-pick-backup">${I.folder()} 选择</button>${backup ? `<button type="button" class="ghost" id="account-clear-backup">清除</button>` : ""}</span>`,
          ),
        ),
      }),
    ];
    if (!xMode) {
      sections.push(
        settingsSection({
          title: "微信公众号",
          control: settingsPanel(
            settingsField(
              "AppID",
              `<input id="wechat-appid" value="${esc(wx.appId || "")}" placeholder="wx…" autocomplete="off">`,
            ) +
              settingsField(
                "AppSecret",
                `<input id="wechat-secret" type="password" value="${esc(wx.appSecret || "")}" placeholder="密钥" autocomplete="off">`,
              ) +
              settingsField(
                "默认作者",
                `<input id="wechat-author" value="${esc(wx.author || "")}" placeholder="可选" autocomplete="off">`,
              ) +
              `<p class="settings-hint">每个账号独立配置，推送草稿时使用当前文章所属账号的凭证。</p>` +
              `<div class="settings-panel-footer"><button type="button" id="wechat-test">测试连接</button><button type="button" class="primary" id="save-wechat">保存</button></div>`,
          ),
        }),
      );
    }
    shell(sections.join(""));
    $("#account-set-avatar").onclick = () => pickAndSetAccountAvatar(a);
    $("#account-pick-backup").onclick = () => pickAccountBackupPath(a);
    if ($("#account-clear-backup"))
      $("#account-clear-backup").onclick = async () => {
        try {
          await applyAccountState(
            await api("account-set-backup-path", { id: a, path: "" }),
          );
          toast("已清除默认备份路径");
        } catch (e) {
          toast(e.message || "清除失败");
        }
      };
    if (!xMode) {
      const readWechatForm = () => {
        const next = {
          appId: $("#wechat-appid").value.trim(),
          appSecret: $("#wechat-secret").value.trim(),
          author: $("#wechat-author").value.trim(),
          coverPath:
            state.wechatAccounts?.[a]?.coverPath ||
            state.wechat?.coverPath ||
            "",
        };
        state.wechatAccounts = { ...(state.wechatAccounts || {}), [a]: next };
        return next;
      };
      $("#wechat-test").onclick = async () => {
        readWechatForm();
        await persist();
        try {
          await api("wechat-test-token", { account: a });
          toast("公众号凭证有效");
        } catch (e) {
          toast(e.message || "连接失败");
        }
      };
      $("#save-wechat").onclick = () => {
        readWechatForm();
        persist();
        toast("公众号设置已保存");
      };
    }
    return;
  }
  if (accountDetailTab === "skills") {
    shell(`<div id="account-skills-root"></div>`);
    mountSkillsSettings(
      $("#account-skills-root"),
      api,
      a,
      accountList(),
      () => {},
      { lockAccount: true, layout: "sections" },
    );
    return;
  }
  shell('<p class="muted">读取账号模型…</p>');
  try {
    let model = await api("model-load", a);
    if (page !== "account" || account !== a || accountDetailTab !== "settings")
      return;
    const draw = () => {
      const metricsCount = state.metrics.filter((r) => r["账号"] === a).length;
      const body = model.definitions
        .map((d) => {
          let extra = "";
          if (d.id === "learning") {
            extra = `<p class="settings-hint">当前账号有 ${metricsCount} 篇归档数据。单篇波动不代表表达方式的因果效果。</p>`;
          }
          if (d.id === "examples" && model.legacy?.some((f) => f.editable)) {
            extra =
              `<details class="settings-legacy"><summary>查看旧 Profile 资料（只读）</summary><div class="material-cards">${model.legacy
                .filter((f) => f.editable)
                .map(
                  (f) =>
                    `<button type="button" class="material-card" data-model-legacy="${esc(f.path)}"><strong>${esc(f.path)}</strong></button>`,
                )
                .join("")}</div></details>`;
          }
          return settingsSection({
            title: d.title,
            control: settingsPanel(
              `<textarea id="model-text-${d.id}" class="settings-model-text" rows="8" maxlength="${d.limit}">${esc(model.modules[d.id] || "")}</textarea>` +
                extra +
                `<div class="settings-panel-footer settings-panel-footer-split"><small class="settings-hint">${d.limit} 字以内</small><button type="button" class="primary" data-save-model="${d.id}">保存</button></div>`,
            ),
          });
        })
        .join("");
      shell(body);
      const collectModules = () => {
        const next = { ...model.modules };
        let changed = false;
        for (const d of model.definitions) {
          const el = $(`#model-text-${d.id}`);
          if (!el || el.value === model.modules[d.id]) continue;
          next[d.id] = el.value;
          changed = true;
        }
        return { next, changed };
      };
      const save = async () => {
        const { next, changed } = collectModules();
        if (!changed) return true;
        try {
          model = await api("model-save", {
            account: a,
            hash: model.hash,
            modules: next,
          });
          toast("当前设定已保存，上一版已留存");
          return true;
        } catch (e) {
          toast(e.message);
          return false;
        }
      };
      saveProfileEditor = save;
      $$("[data-save-model]").forEach((b) => {
        b.onclick = async () => {
          if (await save()) draw();
        };
      });
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
    };
    draw();
  } catch (e) {
    toast(e.message);
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
  if (reviewDemoActive) return;
  sync();
  if (dirty) window.desk.flush(state);
});

/**
 * 开发环境：用固定范文进入审阅 UI，方便改样式时不必反复调 AI。
 * 打开 http://127.0.0.1:5173/?reviewDemo=1 ，热刷新会保持该状态。
 * @param {{ silent?: boolean }} [opts]
 */
function loadReviewDemo(opts = {}) {
  if (!isWeb()) return false;
  const fixture = reviewDemoFixture;
  if (!fixture?.old || !fixture?.next) return false;
  ensureAccount();
  const DEMO_ID = "__review_ui_demo__";
  let doc = state.documents.find((d) => d.id === DEMO_ID);
  if (!doc) {
    doc = {
      id: DEMO_ID,
      title: (fixture.title || "审阅 UI 演示") + " · UI 演示",
      body: fixture.next,
      account: account || accountList()[0]?.id || "",
      updated: new Date().toISOString(),
      chat: [],
      conversations: [],
      titles: [],
      prompts: [],
      topics: [],
      checks: [],
      snapshots: [],
      status: "draft",
    };
    state.documents.unshift(doc);
  }
  reviewDemoActive = true;
  dirty = false;
  account = doc.account || account;
  current = doc;
  page = "write";
  previewMode = false;
  previewDocId = null;
  doc.title = (fixture.title || "审阅 UI 演示") + " · UI 演示";
  doc.body = fixture.next;
  delete doc.richHTML;
  const session = conversation(doc);
  pending = {
    doc: doc.id,
    conversationId: session.id,
    base: fixture.old,
    old: fixture.old,
    next: fixture.next,
    hunks: buildEditHunks(fixture.old, fixture.next),
  };
  reviewMode = true;
  const first = reviewChanges().findIndex((h) => h.status === "pending");
  reviewIndex = first >= 0 ? first : 0;
  if (!opts.silent) {
    const n = reviewChanges().length;
    toast(`审阅 UI 演示已载入（${n} 处修改，不写入仓库）`);
  }
  return true;
}

/**
 * URL ?reviewDemo=1 时自动进入审阅演示。
 */
function maybeLoadReviewDemoFromUrl() {
  if (!isWeb()) return false;
  try {
    const q = new URLSearchParams(location.search);
    if (!q.has("reviewDemo")) return false;
    return loadReviewDemo({ silent: true });
  } catch {
    return false;
  }
}

/**
 * 检测 GitHub 是否有新版本；手动触发时给出提示。
 * @param {{ manual?: boolean }} [opts]
 */
async function checkForAppUpdate(opts = {}) {
  if (isWeb()) {
    if (opts.manual) toast("网页预览不支持应用更新");
    return null;
  }
  try {
    const info = await api("update-check");
    state._update = info;
    state._appVersion = info.current;
    if (opts.manual && page === "settings") render();
    if (info.available) {
      toast(`发现新版本 ${info.latest}，可在设置中更新`);
    } else if (opts.manual) {
      toast(`已是最新版本 ${info.current}`);
    }
    return info;
  } catch (e) {
    if (opts.manual) toast(e.message || "检测更新失败");
    return null;
  }
}

/** 下载 GitHub Release 安装包并替换当前应用。 */
async function installAppUpdate() {
  if (isWeb()) return toast("网页预览不支持应用更新");
  const stop =
    typeof window.desk?.updateProgress === "function"
      ? window.desk.updateProgress((t) => toast(t, { sticky: true }))
      : () => {};
  try {
    toast("开始更新…", { sticky: true });
    await api("update-install");
    toast("正在重启以完成安装…", { sticky: true });
  } catch (e) {
    hideToast();
    toast(e.message || "更新失败");
  } finally {
    stop();
  }
}

state = await api("load");
ensureAccount();
current = state.documents.find((d) => sameAccount(d.account, account));
loadCollapsedProjects();
await refreshDraftProjects();
if (!isWeb()) {
  try {
    const info = await api("app-info");
    state._appVersion = info.version;
  } catch {
    /* ignore */
  }
}
maybeLoadReviewDemoFromUrl();
render();
if (!isWeb()) {
  setTimeout(() => checkForAppUpdate({ manual: false }), 2500);
}
if (isWeb()) {
  window.__inkdeskLoadReviewDemo = () => {
    if (loadReviewDemo()) render();
  };
}
