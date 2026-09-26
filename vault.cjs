const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const YAML = require("yaml");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clean = (s) =>
  String(s || "未命名文章")
    .replace(/[#^\[\]|*\\<>:?/\x00-\x1f]/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 110) || "未命名文章";
const now = () => new Date().toISOString();
function split(text) {
  const m =
    text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/) ||
    text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const yaml = YAML.parseDocument(m ? m[1] : "{}");
  if (!m && YAML.isMap(yaml.contents)) yaml.contents.flow = false;
  if (yaml.errors.length)
    throw Error("YAML 格式有误：" + yaml.errors[0].message);
  if (!YAML.isMap(yaml.contents)) throw Error("文章 YAML 必须为键值结构");
  return { yaml, body: m ? text.slice(m[0].length) : text };
}
function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) =>
      e.isSymbolicLink()
        ? []
        : e.isDirectory()
          ? e.name.startsWith(".")
            ? []
            : files(path.join(root, e.name))
          : [path.join(root, e.name)],
    );
}
const ACCOUNT_SUBDIRS = ["00_Profile", "01_Topics", "02_Drafts", "03_Archive"];
const RESERVED_ROOTS = new Set(["00_wiki", "Attachment", "_system"]);
/** 旧版逻辑 ID（AI/Dev）可匹配已存在的同名或 *_AI / *_Dev 文件夹 */
const LEGACY_IDS = new Set(["AI", "Dev"]);

/**
 * 将用户输入规范为 vault 下一级账号文件夹名。
 * @param {string} name
 */
function accountFolderName(name) {
  const s = String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, "_");
  if (!s || s.startsWith(".") || RESERVED_ROOTS.has(s))
    throw Error("账号名称无效");
  return s.slice(0, 80);
}

/**
 * 账号展示名：下划线转空格。
 * @param {string} folder
 */
function accountLabel(folder) {
  return String(folder || "").replace(/_/g, " ");
}

const compact = (account) =>
  `# ${accountLabel(account)} · 写作约定\n\n## 我是谁\n持续记录自己的判断与实践，写给关心同类问题的读者。\n\n## 怎么表达\n- 像与朋友聊天，具体、坦诚；保留自己的判断和不确定性。\n- 从真实问题或经历出发，有用时给出例子；不强制套结构、金句或行动清单。\n- 不编造经历、效果、引用和数据；避免焦虑营销与夸张承诺。\n\n## 怎么协作\n- 我写、我决定；AI 只处理本次按钮或对话的要求，改稿先预览。\n- 核查区分事实、观点和推测；没有来源的关键事实标为待核实。\n- 定稿前由我确认，保存版本后移入本账号 Archive；平台数据来自文章 YAML。\n`;
class Vault {
  constructor(root, legacyAssets) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.legacyAssets = legacyAssets;
    this.cache = new Map();
    this.index = {};
    this.warnings = [];
    this.accounts = [];
    fs.mkdirSync(this.p("00_wiki/_data/raw/inbox"), { recursive: true });
    this.meta = "_system/inkdesk";
    fs.mkdirSync(this.p(this.meta), { recursive: true });
    const index = this.p(this.meta + "/index.json");
    if (fs.existsSync(index))
      this.index = JSON.parse(fs.readFileSync(index, "utf8"));
    this.assetList = files(this.p("Attachment")).filter((p) =>
      /\.(png|jpe?g|gif|webp)$/i.test(p),
    );
    this.refreshAccounts();
  }
  p(rel) {
    const p = path.resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + path.sep))
      throw Error("路径超出工作副本");
    let q = p;
    while (!fs.existsSync(q)) q = path.dirname(q);
    const real = fs.realpathSync(q),
      root = fs.existsSync(this.root) ? fs.realpathSync(this.root) : this.root;
    if (real !== root && !real.startsWith(root + path.sep))
      throw Error("拒绝写入指向其他目录的软链接");
    return p;
  }

  /**
   * 从 accounts.json 刷新账号列表；仅首次无配置时从磁盘发现一次。
   * 已移除的账号不会因文件夹仍在磁盘而自动加回。
   */
  refreshAccounts() {
    const rel = this.meta + "/accounts.json";
    const stored = this.json(rel, null);
    if (stored && Array.isArray(stored.accounts)) {
      this.accounts = stored.accounts
        .filter((a) => a?.folder)
        .map((a) => ({
          id: a.folder,
          folder: a.folder,
          label: a.label || accountLabel(a.folder),
          avatar: a.avatar || "",
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh"));
      return this.accounts;
    }
    const byId = new Map();
    if (fs.existsSync(this.root)) {
      for (const e of fs.readdirSync(this.root, { withFileTypes: true })) {
        if (
          !e.isDirectory() ||
          e.name.startsWith(".") ||
          RESERVED_ROOTS.has(e.name)
        )
          continue;
        if (this.looksLikeAccount(e.name))
          byId.set(e.name, {
            id: e.name,
            folder: e.name,
            label: accountLabel(e.name),
            avatar: "",
          });
      }
    }
    this.accounts = [...byId.values()].sort((a, b) =>
      a.label.localeCompare(b.label, "zh"),
    );
    this.writeJSON(rel, { accounts: this.accounts });
    return this.accounts;
  }

  /**
   * 目录是否像账号仓库（含四个标准子目录之一）。
   * @param {string} folder
   */
  looksLikeAccount(folder) {
    return ACCOUNT_SUBDIRS.some((d) =>
      fs.existsSync(path.join(this.root, folder, d)),
    );
  }

  /**
   * 确保账号下四个标准文件夹存在。
   * @param {string} folder
   */
  ensureAccountDirs(folder) {
    for (const d of ACCOUNT_SUBDIRS)
      fs.mkdirSync(this.p(`${folder}/${d}`), { recursive: true });
  }

  /**
   * 解析账号 ID：支持文件夹名，以及旧版 AI/Dev（匹配已存在的同名或 *_AI / *_Dev）。
   * @param {string} id
   */
  resolveAccountId(id) {
    const raw = String(id || "").trim();
    if (!raw) throw Error("未知账号");
    if (this.accounts.some((a) => a.id === raw)) return raw;
    if (LEGACY_IDS.has(raw)) {
      const suffix = "_" + raw;
      const hit = this.accounts.find(
        (a) => a.folder === raw || a.folder.endsWith(suffix),
      );
      if (hit) return hit.id;
    }
    throw Error("未知账号：" + raw);
  }

  /**
   * 当前账号 ID 列表。
   */
  listAccountIds() {
    return this.accounts.map((a) => a.id);
  }

  /**
   * 新建账号：创建文件夹与四个标准子目录。
   * @param {string} name
   */
  createAccount(name) {
    const folder = accountFolderName(name);
    if (fs.existsSync(this.p(folder)) && this.accounts.some((a) => a.id === folder))
      throw Error("账号已存在");
    this.ensureAccountDirs(folder);
    const entry = { id: folder, folder, label: accountLabel(folder), avatar: "" };
    this.accounts = this.accounts.filter((a) => a.id !== folder).concat(entry);
    this.accounts.sort((a, b) => a.label.localeCompare(b.label, "zh"));
    this.writeJSON(this.meta + "/accounts.json", { accounts: this.accounts });
    return entry;
  }

  /**
   * 将 vault 内已有文件夹注册为账号（并补齐四个标准子目录）。
   * @param {string} folderOrAbs 相对 vault 的文件夹名，或绝对路径
   */
  registerAccount(folderOrAbs) {
    let folder = String(folderOrAbs || "").trim();
    if (path.isAbsolute(folder)) {
      const abs = fs.realpathSync(folder);
      const root = fs.realpathSync(this.root);
      if (abs === root || !abs.startsWith(root + path.sep))
        throw Error("请选择当前内容仓库内的文件夹");
      folder = path.relative(root, abs);
    }
    folder = folder.replace(/\\/g, "/").split("/")[0];
    folder = accountFolderName(folder);
    this.ensureAccountDirs(folder);
    const prev = this.accounts.find((a) => a.id === folder);
    const entry = {
      id: folder,
      folder,
      label: accountLabel(folder),
      avatar: prev?.avatar || "",
    };
    this.accounts = this.accounts.filter((a) => a.id !== folder).concat(entry);
    this.accounts.sort((a, b) => a.label.localeCompare(b.label, "zh"));
    this.writeJSON(this.meta + "/accounts.json", { accounts: this.accounts });
    return entry;
  }

  /**
   * 从注册表移除账号（不删除磁盘文件）。
   * @param {string} id
   */
  unregisterAccount(id) {
    const folder = this.resolveAccountId(id);
    this.accounts = this.accounts.filter((a) => a.id !== folder);
    this.writeJSON(this.meta + "/accounts.json", { accounts: this.accounts });
    return this.accounts;
  }

  /**
   * 统计账号目录占用与文件数。
   * @param {string} id
   */
  accountStats(id) {
    const folder = this.resolveAccountId(id);
    const base = this.p(folder);
    let bytes = 0,
      filesCount = 0;
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else {
          filesCount++;
          try {
            bytes += fs.statSync(p).size;
          } catch {}
        }
      }
    };
    walk(base);
    const drafts = files(this.p(`${folder}/02_Drafts`)).filter((p) =>
      p.endsWith(".md"),
    ).length;
    const archives = files(this.p(`${folder}/03_Archive`)).filter((p) =>
      p.endsWith(".md"),
    ).length;
    const acc = this.accounts.find((a) => a.id === folder);
    return {
      id: folder,
      folder,
      label: acc?.label || accountLabel(folder),
      avatar: acc?.avatar || "",
      path: base,
      bytes,
      files: filesCount,
      drafts,
      archives,
    };
  }

  /**
   * 设置账号头像；图片存于 _system/inkdesk/avatars/。
   * @param {string} id
   * @param {{ bytes?: number[], type?: string, filePath?: string }} payload
   */
  setAccountAvatar(id, payload = {}) {
    const folder = this.resolveAccountId(id);
    let bytes;
    let ext = ".png";
    if (payload.filePath) {
      bytes = fs.readFileSync(payload.filePath);
      ext = path.extname(payload.filePath).toLowerCase() || ".png";
    } else if (payload.bytesBase64) {
      bytes = Buffer.from(String(payload.bytesBase64), "base64");
      const t = String(payload.type || "");
      if (t.includes("jpeg") || t.includes("jpg")) ext = ".jpg";
      else if (t.includes("webp")) ext = ".webp";
      else if (t.includes("gif")) ext = ".gif";
      else ext = ".png";
    } else if (payload.bytes) {
      bytes = Buffer.from(payload.bytes);
      const t = String(payload.type || "");
      if (t.includes("jpeg") || t.includes("jpg")) ext = ".jpg";
      else if (t.includes("webp")) ext = ".webp";
      else if (t.includes("gif")) ext = ".gif";
      else ext = ".png";
    } else throw Error("请选择图片");
    if (ext === ".jpeg") ext = ".jpg";
    if (![".png", ".jpg", ".gif", ".webp"].includes(ext))
      throw Error("仅支持 PNG / JPG / GIF / WebP");
    if (bytes.length > 2 * 1024 * 1024) throw Error("头像需小于 2MB");
    const dir = this.meta + "/avatars";
    fs.mkdirSync(this.p(dir), { recursive: true });
    const safe = Buffer.from(folder, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    for (const old of [".png", ".jpg", ".gif", ".webp"]) {
      const p = this.p(`${dir}/${safe}${old}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const rel = `${dir}/${safe}${ext}`;
    fs.writeFileSync(this.p(rel), bytes);
    const acc = this.accounts.find((a) => a.id === folder);
    if (acc) acc.avatar = rel;
    else {
      this.accounts.push({
        id: folder,
        folder,
        label: accountLabel(folder),
        avatar: rel,
      });
    }
    this.writeJSON(this.meta + "/accounts.json", { accounts: this.accounts });
    return this.accountStats(folder);
  }

  /**
   * 列出内容仓库下可注册为账号的一级文件夹（未注册）。
   */
  listAccountFolderCandidates() {
    this.refreshAccounts();
    const registered = new Set(this.listAccountIds());
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !RESERVED_ROOTS.has(e.name) &&
          !registered.has(e.name),
      )
      .map((e) => ({
        name: e.name,
        label: accountLabel(e.name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh"));
  }

  /**
   * 全部账号及其统计。
   */
  listAccountsWithStats() {
    this.refreshAccounts();
    return this.accounts.map((a) => this.accountStats(a.id));
  }

  /**
   * 从相对路径推断账号文件夹名。
   * @param {string} rel
   */
  accountFromPath(rel) {
    const top = String(rel || "").replace(/\\/g, "/").split("/")[0];
    if (!top || RESERVED_ROOTS.has(top)) return "";
    try {
      return this.resolveAccountId(top);
    } catch {
      return top;
    }
  }
  json(rel, fallback) {
    const p = this.p(rel);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
  }
  writeJSON(rel, value) {
    atomic(this.p(rel), JSON.stringify(value, null, 2) + "\n");
  }
  resolveImage(ref, note = "") {
    try {
      ref = decodeURIComponent(ref.split("|")[0]);
    } catch {}
    if (/^[a-z]+:/i.test(ref)) return null;
    for (const r of [ref, path.posix.join(path.posix.dirname(note), ref)]) {
      try {
        const p = this.p(r);
        if (fs.existsSync(p) && /\.(png|jpe?g|gif|webp)$/i.test(p))
          return path.relative(this.root, p);
      } catch {}
    }
    const preferred = this.assetList.filter(
      (p) => path.basename(p) === path.basename(ref),
    );
    const own = preferred.find(
      (p) => path.basename(path.dirname(p)) === path.basename(note, ".md"),
    );
    return own
      ? path.relative(this.root, own)
      : preferred.length === 1
        ? path.relative(this.root, preferred[0])
        : null;
  }
  display(body, note) {
    const url = (ref) => {
      const r = this.resolveImage(ref, note);
      return r ? "inkasset://vault/" + encodeURIComponent(r) : null;
    };
    return body
      .replace(/!\[\[([^\]]+)\]\]/g, (all, r) => {
        const u = url(r);
        return u ? `![图片](${u})` : all;
      })
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (all, a, r) => {
        const u = url(r);
        return u ? `![${a}](${u})` : all;
      });
  }
  canonical(body, title) {
    return String(body || "")
      .replace(
        /!\[([^\]]*)\]\(inkasset:\/\/vault\/([^)]+)\)/g,
        (_, a, r) => `![[${decodeURIComponent(r)}]]`,
      )
      .replace(/!\[([^\]]*)\]\(inkasset:\/\/local\/([^)]+)\)/g, (_, a, r) => {
        if (!this.legacyAssets) throw Error("旧图片目录不可用");
        const p = path.resolve(this.legacyAssets, decodeURIComponent(r));
        if (path.dirname(p) !== path.resolve(this.legacyAssets))
          throw Error("图片路径错误");
        const src = this.image(title, fs.readFileSync(p), path.extname(p));
        return `![[${decodeURIComponent(src.split("/").pop())}]]`;
      });
  }
  load() {
    this.warnings = [];
    this.refreshAccounts();
    const documents = [],
      metrics = [],
      archives = [];
    const byPath = Object.fromEntries(
      Object.entries(this.index).map(([id, v]) => [v.path, id]),
    );
    for (const account of this.listAccountIds())
      for (const folder of ["02_Drafts", "03_Archive"])
        for (const file of files(this.p(`${account}/${folder}`)).filter(
          (p) => p.endsWith(".md"),
        )) {
          const rel = path.relative(this.root, file);
          try {
            const raw = fs.readFileSync(file, "utf8"),
              { yaml, body } = split(raw),
              fields = yaml.toJS();
            if (folder === "03_Archive") {
              const row = {
                ...fields,
                标题: path.basename(file, ".md"),
                账号: account,
                日期: fields["发布时间"] || null,
                path: rel,
              };
              row["阅读"] = number(fields["观看量"] ?? fields["阅读"]);
              for (const k of ["收藏", "评论", "涨粉", "曝光", "点赞", "分享"])
                row[k] = number(fields[k]);
              metrics.push(row);
              archives.push({
                title: row["标题"],
                path: rel,
                account,
                body: this.display(body, rel),
                fields,
                group:
                  typeof fields["分组"] === "string" && fields["分组"].trim()
                    ? fields["分组"].trim()
                    : null,
              });
              continue;
            }
            // Historic AI draft siblings become versions of their parent article.
            if (
              /\.ai-v\d+\.md$/.test(file) &&
              fs.existsSync(file.replace(/\.ai-v\d+\.md$/, ".md"))
            )
              continue;
            const id = byPath[rel] || crypto.randomUUID();
            this.index[id] = { ...this.index[id], path: rel, status: "draft" };
            const meta = this.json(`${this.meta}/articles/${id}.json`, {});
            const snapshots = files(this.p(`${this.meta}/versions/${id}`))
              .filter((p) => p.endsWith(".md"))
              .sort()
              .map((p) => {
                const v = split(fs.readFileSync(p, "utf8"));
                return {
                  id: path.basename(p, ".md"),
                  at: v.yaml.get("版本时间"),
                  name: v.yaml.get("版本名称") || "保存版本",
                  body: this.display(v.body, rel),
                };
              });
            for (const p of files(path.dirname(file)).filter(
              (p) =>
                p.startsWith(file.slice(0, -3) + ".ai-v") && p.endsWith(".md"),
            ))
              snapshots.push({
                id: hash(p),
                at: fs.statSync(p).mtime.toISOString(),
                name: "历史 AI 版本",
                body: this.display(split(fs.readFileSync(p, "utf8")).body, rel),
              });
            const conversations = files(
              this.p(`${this.meta}/conversations/${id}`),
            )
              .filter((p) => p.endsWith(".json"))
              .map((p) => JSON.parse(fs.readFileSync(p, "utf8")));
            const doc = {
              ...meta,
              id,
              path: rel,
              title: path.basename(file, ".md"),
              account,
              body: this.display(body, rel),
              updated: fs.statSync(file).mtime.toISOString(),
              status: "draft",
              snapshots,
              conversations,
            };
            const groupField = fields["分组"];
            doc.group =
              typeof groupField === "string" && groupField.trim()
                ? groupField.trim()
                : meta.group || null;
            if (!meta.titles && Array.isArray(fields["标题候选"]))
              doc.titles = fields["标题候选"]
                .map((x) => ({
                  text:
                    typeof x === "string"
                      ? x
                      : String(x?.title || x?.标题 || ""),
                  at: doc.updated,
                }))
                .filter((x) => x.text);
            for (const k of [
              "titles",
              "prompts",
              "topics",
              "checks",
              "decisions",
              "materials",
            ])
              doc[k] ??= [];
            if (!conversations.length)
              conversations.push({
                id: crypto.randomUUID(),
                title: "新对话",
                messages: meta.chat || [],
              });
            doc.activeConversationId = conversations.some(
              (c) => c.id === meta.activeConversationId,
            )
              ? meta.activeConversationId
              : conversations[0].id;
            delete doc.chat;
            this.cache.set(id, { raw, doc: JSON.stringify(doc) });
            documents.push(doc);
          } catch (e) {
            this.warnings.push(rel + "：" + e.message);
          }
        }
    this.writeJSON(this.meta + "/index.json", this.index);
    return {
      documents: documents.sort((a, b) => b.updated.localeCompare(a.updated)),
      metrics,
      archives,
      materials: this.materials(),
      warnings: this.warnings,
      vaultPath: this.root,
      source: this.root,
      accounts: this.listAccountsWithStats(),
    };
  }
  saveDoc(doc) {
    const account = this.resolveAccountId(doc.account);
    doc.account = account;
    if (!/^[a-zA-Z0-9-]+$/.test(doc.id)) throw Error("文章标识无效");
    if (this.index[doc.id]?.status === "archive") return;
    const cached = this.cache.get(doc.id);
    if (cached?.doc === JSON.stringify(doc)) return;
    const old = this.index[doc.id]?.path;
    let raw = "";
    if (old) {
      if (!fs.existsSync(this.p(old))) throw Error("草稿已在外部移动，请刷新");
      raw = fs.readFileSync(this.p(old), "utf8");
      if (cached && raw !== cached.raw)
        throw Error("文章已在外部修改，请先刷新；未覆盖磁盘内容");
    }
    const { yaml } = split(raw);
    if (!old)
      for (const k of [
        "发布时间",
        "体裁",
        "曝光",
        "观看量",
        "封面点击率",
        "点赞",
        "评论",
        "收藏",
        "涨粉",
        "分享",
        "人均观看时长",
        "所用结构",
        "标题候选",
        "结构快照",
        "分组",
      ])
        yaml.set(k, null);
    if (
      doc.titles?.length &&
      (!cached ||
        JSON.stringify(doc.titles) !==
          JSON.stringify(JSON.parse(cached.doc).titles))
    )
      yaml.set(
        "标题候选",
        doc.titles.map((x) => x.text.split("\n")[0]),
      );
    const nextGroup =
      typeof doc.group === "string" && doc.group.trim()
        ? doc.group.trim()
        : null;
    const prevGroup = (() => {
      try {
        const g = JSON.parse(cached?.doc || "{}").group;
        return typeof g === "string" && g.trim() ? g.trim() : null;
      } catch {
        return null;
      }
    })();
    if (nextGroup !== prevGroup) yaml.set("分组", nextGroup);
    const dir = old ? path.posix.dirname(old) : `${account}/02_Drafts`;
    let dest = dir + "/" + clean(doc.title) + ".md";
    if (dest !== old && fs.existsSync(this.p(dest)))
      dest = dir + "/" + clean(doc.title) + " " + doc.id.slice(0, 8) + ".md";
    let body = this.canonical(doc.body, path.basename(dest, ".md"));
    const aliases = { ...(this.index[doc.id]?.attachmentAliases || {}) };
    if (old && path.basename(old, ".md") !== path.basename(dest, ".md")) {
      const oldFolder = "Attachment/" + path.basename(old, ".md"),
        newFolder = "Attachment/" + path.basename(dest, ".md");
      for (const m of body.matchAll(/!\[\[([^\]]+)\]\]/g)) {
        const ref = m[1];
        if (!ref.startsWith(oldFolder + "/")) continue;
        const from = this.p(ref);
        if (!fs.existsSync(from)) continue;
        let target = newFolder + "/" + path.basename(ref),
          n = 0;
        while (
          fs.existsSync(this.p(target)) &&
          hash(fs.readFileSync(this.p(target))) !== hash(fs.readFileSync(from))
        )
          target =
            newFolder +
            "/" +
            path.basename(ref, path.extname(ref)) +
            " " +
            ++n +
            path.extname(ref);
        fs.mkdirSync(path.dirname(this.p(target)), { recursive: true });
        if (!fs.existsSync(this.p(target)))
          fs.copyFileSync(from, this.p(target));
        aliases[ref] = target;
        this.assetList.push(this.p(target));
      }
    }
    body = body.replace(/!\[\[([^\]]+)\]\]/g, (all, ref) => {
      let p = ref;
      const seen = new Set();
      while (aliases[p] && !seen.has(p)) {
        seen.add(p);
        p = aliases[p];
      }
      return "![[" + p + "]]";
    });
    const next = "---\n" + yaml.toString() + "---\n" + body;
    // Preserve prior text for every changed article, including before a rename.
    if (raw && raw !== next)
      this.version(doc.id, split(raw).body, "自动保存前", raw);
    if (raw !== next || dest !== old) {
      atomic(this.p(dest), next);
      if (old && old !== dest) fs.unlinkSync(this.p(old));
    }
    this.index[doc.id] = {
      path: dest,
      status: "draft",
      attachmentAliases: aliases,
    };
    const { body: _body, snapshots, conversations, path: _path, ...meta } = doc;
    delete meta.chat;
    this.writeJSON(`${this.meta}/articles/${doc.id}.json`, meta);
    for (const c of conversations || []) {
      if (!/^[a-zA-Z0-9-]+$/.test(c.id)) throw Error("对话标识无效");
      this.writeJSON(`${this.meta}/conversations/${doc.id}/${c.id}.json`, {
        ...c,
        articleId: doc.id,
      });
    }
    for (const v of snapshots || []) {
      const id = v.id || hash(JSON.stringify(v)).slice(0, 24);
      if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("版本标识无效");
      const p = this.p(`${this.meta}/versions/${doc.id}/${id}.md`);
      if (!fs.existsSync(p))
        atomic(
          p,
          "---\n" +
            YAML.stringify({
              版本时间: v.at,
              版本名称: v.name || "修改前快照",
            }) +
            "---\n" +
            this.canonical(v.body, doc.title),
        );
    }
    this.cache.set(doc.id, { raw: next, doc: JSON.stringify(doc) });
    this.writeJSON(this.meta + "/index.json", this.index);
  }
  version(id, body, name, raw) {
    const key = Date.now() + "-" + crypto.randomUUID().slice(0, 8);
    const y = raw ? split(raw).yaml : YAML.parseDocument("{}");
    y.set("版本时间", now());
    y.set("版本名称", name);
    atomic(
      this.p(`${this.meta}/versions/${id}/${key}.md`),
      "---\n" + y.toString() + "---\n" + body,
    );
  }
  finalize(id) {
    const item = this.index[id];
    if (!item || item.status !== "draft") throw Error("草稿不存在或已归档");
    const from = this.p(item.path),
      dest = item.path.replace("/02_Drafts/", "/03_Archive/"),
      to = this.p(dest);
    if (fs.existsSync(to)) throw Error("归档中已有同名文章，请先更换草稿标题");
    const raw = fs.readFileSync(from, "utf8");
    if (this.cache.get(id)?.raw !== raw)
      throw Error("草稿在外部发生变化，请刷新后重新确认");
    const legacy = files(path.dirname(from))
      .filter(
        (p) =>
          p.startsWith(from.slice(0, -3) + ".ai-v") && /\.ai-v\d+\.md$/.test(p),
      )
      .map((p) => ({ path: p, raw: fs.readFileSync(p, "utf8") }));
    for (const v of legacy)
      this.version(id, split(v.raw).body, "历史 AI 版本", v.raw);
    this.version(id, split(raw).body, "定稿", raw);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    // Exclusive link prevents overwrite even if another writer creates the destination.
    fs.linkSync(from, to);
    try {
      fs.unlinkSync(from);
    } catch (e) {
      fs.unlinkSync(to);
      throw e;
    }
    this.index[id] = {
      ...this.index[id],
      path: dest,
      status: "archive",
      finalizedAt: now(),
    };
    this.writeJSON(this.meta + "/index.json", this.index);
    for (const v of legacy) {
      if (fs.readFileSync(v.path, "utf8") === v.raw) {
        const backup = this.p(
          this.meta + "/legacy/" + id + "/" + path.basename(v.path),
        );
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        // Keep the exact legacy original as well as its readable version snapshot.
        fs.copyFileSync(v.path, backup, fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(v.path);
      }
    }
    return dest;
  }
  /**
   * 将已发布文章从 03_Archive 移回 02_Drafts，保留版本与对话元数据。
   * @param {string} rel vault 相对路径（须含 /03_Archive/）
   * @returns {{ id: string, path: string }}
   */
  toDraft(rel) {
    if (
      typeof rel !== "string" ||
      !rel.includes("/03_Archive/") ||
      !rel.endsWith(".md")
    )
      throw Error("不是已发布文章");
    const from = this.p(rel);
    if (!fs.existsSync(from)) throw Error("文件不存在");
    const dest = rel.replace("/03_Archive/", "/02_Drafts/");
    const to = this.p(dest);
    if (fs.existsSync(to)) throw Error("草稿箱已有同名文章，请先处理冲突");
    const found = Object.entries(this.index).find(([, v]) => v.path === rel);
    const id = found?.[0] || crypto.randomUUID();
    const raw = fs.readFileSync(from, "utf8");
    this.version(id, split(raw).body, "移回草稿", raw);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.linkSync(from, to);
    try {
      fs.unlinkSync(from);
    } catch (e) {
      fs.unlinkSync(to);
      throw e;
    }
    const prev = this.index[id] || {};
    const next = { ...prev, path: dest, status: "draft" };
    delete next.finalizedAt;
    this.index[id] = next;
    this.writeJSON(this.meta + "/index.json", this.index);
    this.cache.delete(id);
    return { id, path: dest };
  }
  /**
   * 删除草稿及其本地元数据（版本、对话、项目链接）；不删除共享素材库正文。
   * @param {string} id
   */
  deleteDoc(id) {
    const item = this.index[id];
    if (!item || item.status !== "draft") throw Error("只能删除草稿");
    const file = this.p(item.path);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const folder of ["versions", "conversations", "projects"]) {
      const dir = this.p(`${this.meta}/${folder}/${id}`);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    const article = this.p(`${this.meta}/articles/${id}.json`);
    if (fs.existsSync(article)) fs.unlinkSync(article);
    delete this.index[id];
    this.writeJSON(this.meta + "/index.json", this.index);
    this.cache.delete(id);
  }
  image(title, bytes, ext) {
    if (
      !/^\.(png|jpe?g|gif|webp)$/i.test(ext) ||
      bytes.length > 20 * 1024 * 1024
    )
      throw Error("图片格式或大小不支持");
    const date = new Date(),
      pad = (v, n = 2) => String(v).padStart(n, "0");
    const stamp =
      date.getFullYear() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds()) +
      pad(date.getMilliseconds(), 3);
    const folder = "Attachment/" + clean(title),
      name = "file-" + stamp;
    let rel = folder + "/" + name + ext,
      i = 0;
    fs.mkdirSync(this.p(folder), { recursive: true });
    while (true) {
      try {
        fs.writeFileSync(this.p(rel), bytes, { flag: "wx" });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        rel = folder + "/" + name + " " + ++i + ext;
      }
    }
    this.assetList.push(this.p(rel));
    return "inkasset://vault/" + encodeURIComponent(rel);
  }
  materials() {
    return files(this.p("00_wiki"))
      .filter((p) => p.endsWith(".md"))
      .map((p) => ({
        path: path.relative(this.root, p),
        title: path.basename(p, ".md"),
      }));
  }
  readMaterial(rel) {
    if (!rel.startsWith("00_wiki/") || !rel.endsWith(".md"))
      throw Error("不是素材文档");
    return split(fs.readFileSync(this.p(rel), "utf8")).body;
  }
  addMaterial({ title, body }) {
    const rel =
      "00_wiki/_data/raw/inbox/" + clean(title) + "-" + Date.now() + ".md";
    atomic(
      this.p(rel),
      "---\n" +
        YAML.stringify({ 创建时间: now(), 类型: "写作素材" }) +
        "---\n" +
        body,
    );
    return this.materials();
  }
  profile(account) {
    const id = this.resolveAccountId(account);
    const base = `${id}/00_Profile/`;
    const original = this.p(base + "Persona_Doc.md"),
      effective = this.p(base + "Writing_Contract.md");
    return {
      original: fs.existsSync(original)
        ? fs.readFileSync(original, "utf8")
        : "尚无人设文档",
      contract: fs.existsSync(effective)
        ? fs.readFileSync(effective, "utf8")
        : compact(id),
      path: base + "Writing_Contract.md",
      applied: fs.existsSync(effective),
    };
  }
  saveProfile(account, text) {
    const p = this.profile(account);
    if (!text.trim()) throw Error("写作约定不能为空");
    if (p.applied)
      atomic(
        this.p(`${this.meta}/profile-history/${account}-${Date.now()}.md`),
        p.contract,
      );
    atomic(this.p(p.path), text);
    return this.profile(account);
  }

  /**
   * 更新归档文章 YAML，并按表格标题重命名文件。
   * @param {string} rel 相对路径
   * @param {object} fields YAML 字段
   * @param {string} newTitle 表格中的笔记标题
   */
  syncArchiveFromImport(rel, fields, newTitle) {
    if (!rel.includes("/03_Archive/")) throw Error("只能更新归档文章");
    const from = this.p(rel);
    const raw = fs.readFileSync(from, "utf8");
    const { yaml, body } = split(raw);
    for (const [k, v] of Object.entries(fields)) yaml.set(k, v);
    const dir = path.posix.dirname(rel);
    const destName = clean(newTitle) + ".md";
    let destRel = dir + "/" + destName;
    if (destRel !== rel && fs.existsSync(this.p(destRel)))
      throw Error("归档中已有同名文章：" + newTitle);
    atomic(from, "---\n" + yaml.toString() + "---\n" + body);
    if (destRel !== rel) {
      fs.renameSync(from, this.p(destRel));
      for (const [id, item] of Object.entries(this.index)) {
        if (item.path === rel) item.path = destRel;
      }
      this.writeJSON(this.meta + "/index.json", this.index);
      rel = destRel;
    }
    this.cache.clear();
    return rel;
  }

  /**
   * 写入 Markdown YAML「分组」字段（草稿或归档均可）。
   * @param {string} rel vault 相对路径
   * @param {string|null} group
   */
  setMarkdownGroup(rel, group) {
    if (typeof rel !== "string" || !rel.endsWith(".md"))
      throw Error("无效路径");
    if (
      !rel.includes("/02_Drafts/") &&
      !rel.includes("/03_Archive/")
    )
      throw Error("只能给草稿或已发布文章设置分组");
    const abs = this.p(rel);
    if (!fs.existsSync(abs)) throw Error("文件不存在");
    const raw = fs.readFileSync(abs, "utf8");
    const { yaml, body } = split(raw);
    yaml.set("分组", group);
    atomic(abs, "---\n" + yaml.toString() + "---\n" + body);
    const found = Object.entries(this.index).find(([, v]) => v.path === rel);
    if (found && this.index[found[0]]?.status === "draft") {
      const id = found[0];
      const meta = this.json(`${this.meta}/articles/${id}.json`, {});
      if (group) meta.group = group;
      else delete meta.group;
      this.writeJSON(`${this.meta}/articles/${id}.json`, meta);
      this.cache.delete(id);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 重命名文章 YAML 中的分组标签。
   * @param {string} from
   * @param {string} to
   */
  renameArticleGroup(from, to) {
    if (!from || !to || from === to) return;
    for (const account of this.listAccountIds())
      for (const folder of ["02_Drafts", "03_Archive"])
        for (const file of files(this.p(`${account}/${folder}`)).filter((p) =>
          p.endsWith(".md"),
        )) {
          try {
            const raw = fs.readFileSync(file, "utf8");
            const { yaml, body } = split(raw);
            const cur = yaml.get("分组");
            if (cur !== from) continue;
            yaml.set("分组", to);
            atomic(file, "---\n" + yaml.toString() + "---\n" + body);
          } catch {
            /* 跳过坏文件 */
          }
        }
    const articlesDir = this.p(`${this.meta}/articles`);
    if (fs.existsSync(articlesDir)) {
      for (const file of fs.readdirSync(articlesDir).filter((f) => f.endsWith(".json"))) {
        try {
          const p = path.join(articlesDir, file);
          const meta = JSON.parse(fs.readFileSync(p, "utf8"));
          if (meta.group !== from) continue;
          meta.group = to;
          fs.writeFileSync(p, JSON.stringify(meta, null, 2) + "\n");
        } catch {
          /* 跳过 */
        }
      }
    }
    this.cache.clear();
  }
}
function number(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
module.exports = { Vault, split, clean, compact };
