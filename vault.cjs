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
const compact = (account) =>
  `# 金奇_${account} · 写作约定\n\n## 我是谁\n${account === "Dev" ? "正在做产品的独立开发者，分享开发过程、真实取舍和踩坑。" : "持续实践 AI 的普通学习者，把亲自试过的方法和理解讲清楚。"}\n\n## 怎么表达\n- 像与朋友聊天，具体、坦诚；保留自己的判断和不确定性。\n- 从真实问题或经历出发，有用时给出例子；不强制套结构、金句或行动清单。\n- 不编造经历、效果、引用和数据；避免焦虑营销与夸张承诺。\n\n## 怎么协作\n- 我写、我决定；AI 只处理本次按钮或对话的要求，改稿先预览。\n- 核查区分事实、观点和推测；没有来源的关键事实标为待核实。\n- 定稿前由我确认，保存版本后移入本账号 Archive；平台数据来自文章 YAML。\n- 接受/拒绝的修改留在本机。复盘时主动提炼一条经验，经我修改后写入本约定，不自动堆积规则。\n`;
class Vault {
  constructor(root, legacyAssets) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    this.legacyAssets = legacyAssets;
    this.cache = new Map();
    this.index = {};
    this.warnings = [];
    for (const a of ["AI", "Dev"])
      for (const d of ["00_Profile", "01_Topics", "02_Drafts", "03_Archive"])
        fs.mkdirSync(this.p(`金奇_${a}/${d}`), { recursive: true });
    fs.mkdirSync(this.p("00_wiki/_data/raw/inbox"), { recursive: true });
    this.meta = "_system/inkdesk";
    fs.mkdirSync(this.p(this.meta), { recursive: true });
    const index = this.p(this.meta + "/index.json");
    if (fs.existsSync(index))
      this.index = JSON.parse(fs.readFileSync(index, "utf8"));
    this.assetList = files(this.p("Attachment")).filter((p) =>
      /\.(png|jpe?g|gif|webp)$/i.test(p),
    );
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
    const documents = [],
      metrics = [],
      archives = [];
    const byPath = Object.fromEntries(
      Object.entries(this.index).map(([id, v]) => [v.path, id]),
    );
    for (const account of ["AI", "Dev"])
      for (const folder of ["02_Drafts", "03_Archive"])
        for (const file of files(this.p(`金奇_${account}/${folder}`)).filter(
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
                title: "开始聊这篇",
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
    };
  }
  saveDoc(doc) {
    if (!/^[a-zA-Z0-9-]+$/.test(doc.id) || !["AI", "Dev"].includes(doc.account))
      throw Error("文章标识无效");
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
    const dir = old ? path.posix.dirname(old) : `金奇_${doc.account}/02_Drafts`;
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
    if (!["AI", "Dev"].includes(account)) throw Error("未知账号");
    const base = `金奇_${account}/00_Profile/`;
    const original = this.p(base + "Persona_Doc.md"),
      effective = this.p(base + "Writing_Contract.md");
    return {
      original: fs.existsSync(original)
        ? fs.readFileSync(original, "utf8")
        : "尚无人设文档",
      contract: fs.existsSync(effective)
        ? fs.readFileSync(effective, "utf8")
        : compact(account),
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
}
function number(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
module.exports = { Vault, split, clean, compact };
