const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const { clean, split } = require("./vault.cjs");
const digest = (t) => crypto.createHash("sha256").update(t).digest("hex");
const core = [
  "Persona_Doc.md",
  "Author_DNA/语言风格.md",
  "Author_DNA/禁止规则.md",
  "Author_DNA/迭代观察.md",
];
function walk(dir) {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
          e.isSymbolicLink()
            ? []
            : e.isDirectory()
              ? walk(path.join(dir, e.name))
              : [path.join(dir, e.name)],
        )
    : [];
}
function atomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = p + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(t, text);
  fs.renameSync(t, p);
}

/**
 * 根据文件名判断素材预览类型。
 * @param {string} name
 * @returns {"markdown"|"html"|"json"|"image"|"text"|"binary"}
 */
function materialKind(name) {
  const ext = path.extname(name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  if (ext === ".json") return "json";
  if (
    [".txt", ".csv", ".yaml", ".yml", ".log", ".tsv", ".xml"].includes(ext)
  )
    return "text";
  return "binary";
}

/** 是否可按 UTF-8 原文阅读 */
function isTextKind(kind) {
  return ["markdown", "html", "json", "text"].includes(kind);
}
class Knowledge {
  constructor(vault, reader) {
    this.v = vault;
    this.reader = reader;
  }
  profileBase(a) {
    if (!["AI", "Dev"].includes(a)) throw Error("未知账号");
    return `金奇_${a}/00_Profile/`;
  }
  profileFile(a, rel) {
    if (!rel.endsWith(".md") || rel.includes("..") || path.isAbsolute(rel))
      throw Error("仅支持 Profile 内 Markdown");
    return this.v.p(this.profileBase(a) + rel);
  }
  profile(a) {
    const base = this.profileBase(a),
      config = this.v.json(`${this.v.meta}/profile-config/${a}.json`, {
        active: ["Writing_Contract.md"],
      });
    const list = walk(this.v.p(base)).map((p) => ({
      path: path.relative(this.v.p(base), p),
      bytes: fs.statSync(p).size,
      editable: p.endsWith(".md"),
    }));
    return {
      files: list,
      active: config.active,
      simplified: !!config.simplified,
      proposals: walk(this.v.p(`${this.v.meta}/profile-proposals/${a}`))
        .filter((p) => p.endsWith(".json"))
        .map((p) => JSON.parse(fs.readFileSync(p, "utf8")))
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  }
  readProfile(a, rel) {
    const file = this.profileFile(a, rel),
      text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return { path: rel, text, hash: digest(text) };
  }
  saveProfile(a, rel, text, expected) {
    const old = this.readProfile(a, rel);
    if (expected !== old.hash)
      throw Error("此设定已发生变化，请重新读取后修改");
    const id = crypto.randomUUID();
    this.v.writeJSON(`${this.v.meta}/profile-history/${a}/${id}.json`, {
      at: new Date().toISOString(),
      path: rel,
      text: old.text,
      hash: old.hash,
    });
    atomic(this.profileFile(a, rel), text);
    return this.readProfile(a, rel);
  }
  activeContext(a) {
    const p = this.profile(a);
    if (!p.simplified) return this.v.profile(a).contract;
    return p.active
      .map((rel) => "\n[" + rel + "]\n" + this.readProfile(a, rel).text)
      .join("\n");
  }
  evidence(a, store) {
    const p = this.profile(a);
    const entries = p.files
      .filter((f) => f.editable)
      .map((f) => this.readProfile(a, f.path));
    const articles = [
      ...(store.archives || [])
        .filter((d) => d.account === a)
        .map((d) => ({
          path: d.path,
          title: d.title,
          body: d.body,
          fields: d.fields,
          date: String(d.fields?.["发布时间"] || ""),
        })),
      ...(store.documents || [])
        .filter((d) => d.account === a)
        .map((d) => ({
          path: this.v.index[d.id]?.path,
          title: d.title,
          body: d.body,
          fields: { 状态: "草稿" },
          date: d.updated,
        })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12);
    const sources = [
      ...entries.map((f) => this.profileBase(a) + f.path),
      ...articles.map((d) => d.path),
    ];
    const context =
      "Profile 全部文本文件（长文件只提供前 3000 字，省略处有标记）：\n" +
      entries
        .map(
          (f) =>
            `\n来源 ${this.profileBase(a) + f.path}\n${f.text.slice(0, 3000)}${f.text.length > 3000 ? "\n[后文省略]" : ""}`,
        )
        .join("\n") +
      "\n最近文章与原始 YAML 数据（最多12篇，每篇前3000字）：\n" +
      articles
        .map(
          (d) =>
            `\n来源 ${d.path}\n${JSON.stringify(d.fields)}\n${d.body.slice(0, 3000)}${d.body.length > 3000 ? "\n[后文省略]" : ""}`,
        )
        .join("\n");
    if (context.length > 130000)
      throw Error("本次复盘资料过多，请减少参考文件后重试");
    return {
      account: a,
      entries,
      sources,
      context,
      articleCount: articles.length,
    };
  }
  proposal(a, changes, evidence, reason = "AI 根据文章和数据提出的迭代") {
    if (!Array.isArray(changes) || !changes.length || changes.length > 8)
      throw Error("建议必须包含 1–8 个文件");
    const seen = new Set();
    const validated = changes.map((c) => {
      this.profileFile(a, c.path);
      if (seen.has(c.path)) throw Error("建议包含重复文件");
      seen.add(c.path);
      if (typeof c.content !== "string" || c.content.length > 10000)
        throw Error("单个设定建议应控制在 10000 字内");
      const old = evidence.entries.find((f) => f.path === c.path) || {
        text: "",
        hash: digest(""),
      };
      if (
        !Array.isArray(c.sources) ||
        !c.sources.length ||
        c.sources.some((s) => !evidence.sources.includes(s))
      )
        throw Error("迭代建议缺少可追溯来源或引用了未提供的文件");
      return {
        path: c.path,
        before: old.text,
        baseHash: old.hash,
        after: c.content,
        reason: String(c.reason || ""),
        sources: c.sources,
      };
    });
    const proposal = {
      id: crypto.randomUUID(),
      account: a,
      at: new Date().toISOString(),
      status: "pending",
      reason,
      changes: validated,
    };
    this.v.writeJSON(
      `${this.v.meta}/profile-proposals/${a}/${proposal.id}.json`,
      proposal,
    );
    return proposal;
  }
  simple(a, store) {
    const e = this.evidence(a, store),
      source =
        e.sources.find((s) => s.endsWith("/Persona_Doc.md")) || e.sources[0];
    if (!source) throw Error("当前账号还没有可参考的 Profile 文件");
    const bans =
      e.entries.find((f) => f.path === "Author_DNA/禁止规则.md")?.text || "";
    const existing = bans.split("## 禁用结构套路")[0].split("## 禁用词")[1];
    const texts = [
      `# 金奇_${a} · 账号定位\n\n${a === "AI" ? "用设计师的判断力，给普通人讲清楚 AI 能做什么、边界在哪里。以自己的实践为起点，不预设技术背景。" : "用设计师的眼光做独立开发，记录从想法、原型到用户反馈的真实过程，分享取舍与试错。"}\n\n- 写具体问题、经历和判断，不靠焦虑吸引关注。\n- 读者看完能理解一个问题或作出更好的选择，不强制每篇给行动清单。\n- 内容题材和结构按本篇需要选择，不设栏目配额。\n`,
      "# 语言风格\n\n- 像刚想清楚一件事、讲给朋友听。口语自然，有个人判断，不端着。\n- 用真实场景和细节解释观点；专业术语第一次出现时用人话解释。\n- 情绪克制，允许自嘲和保留不确定性，不制造夸张金句。\n- 开头、结构、结尾按内容选择，不强制套模板、轮换结构或升华。\n- 范文只学叙述方法，不复制句子或借用别人的经历。\n",
      "# 表达边界\n\n- 不编造经历、数据、引语和来源；无法核实的关键事实明确待核实。\n- 不恐吓读者、不贬低受众、不用术语堆砌掩盖解释。\n- 少用宏观套话、说教结尾、机械排比和反复的「不是……而是……」。\n- 尊重用户明确提出的表达偏好。历史禁止项保留在版本中，按实际需要补回，不把一次低数据表现变成永久禁令。\n",
      "# 迭代观察\n\n当前尚无经过本轮确认的新结论。\n\n每次最多保留三条有用观察：观察是什么 → 哪篇文章或哪项 YAML 数据支持 → 样本与不确定性 → 下次如何验证。\n\n数据只作为反馈；缺失值不补零，单篇结果不推断因果，不因短期波动改掉自己的表达。经确认的新发现替换旧观察，不持续叠加规则。\n",
    ];
    if (existing)
      texts[2] += "\n## 已有用词与句式偏好\n" + existing.slice(0, 1800);
    const p = this.proposal(
      a,
      core.map((rel, i) => ({
        path: rel,
        content: texts[i],
        reason: "移除重复与强制配额；保留身份、声音、边界和可验证的观察。",
        sources: [source],
      })),
      e,
      "精简为四份核心设定；其他文件保留为参考资料",
    );
    p.activate = core;
    this.v.writeJSON(`${this.v.meta}/profile-proposals/${a}/${p.id}.json`, p);
    return p;
  }
  decide(a, id, action, edits) {
    if (!/^[\w-]+$/.test(id)) throw Error("无效建议");
    const rel = `${this.v.meta}/profile-proposals/${a}/${id}.json`,
      p = this.v.json(rel, null);
    if (!p || p.status !== "pending") throw Error("建议已处理或不存在");
    if (action === "reject") {
      p.status = "rejected";
      this.v.writeJSON(rel, p);
      return p;
    }
    if (action !== "apply") throw Error("未知操作");
    const changes = p.changes.map((c, i) => {
      const value = edits?.[i] ?? c.after;
      if (typeof value !== "string" || !value.trim() || value.length > 10000)
        throw Error("设定内容为空或过长");
      if (this.readProfile(a, c.path).hash !== c.baseHash)
        throw Error(c.path + " 已修改，请重新生成建议");
      return { ...c, after: value };
    });
    this.v.writeJSON(`${this.v.meta}/profile-history/${a}/${id}.json`, {
      at: new Date().toISOString(),
      changes,
    });
    try {
      for (const c of changes) atomic(this.profileFile(a, c.path), c.after);
    } catch (e) {
      for (const c of changes) atomic(this.profileFile(a, c.path), c.before);
      throw e;
    }
    const config = this.v.json(`${this.v.meta}/profile-config/${a}.json`, {
      active: ["Writing_Contract.md"],
    });
    config.active = p.activate || [
      ...new Set([...config.active, ...changes.map((c) => c.path)]),
    ];
    config.simplified = true;
    this.v.writeJSON(`${this.v.meta}/profile-config/${a}.json`, config);
    p.changes = changes;
    p.status = "applied";
    p.appliedAt = new Date().toISOString();
    this.v.writeJSON(rel, p);
    return p;
  }
  project(id) {
    if (!/^[\w-]+$/.test(id) || !this.v.index[id]) throw Error("项目不存在");
    return `${this.v.meta}/projects/${id}`;
  }
  /** 共享素材库目录（相对 vault meta） */
  libraryDir() {
    return `${this.v.meta}/library`;
  }
  /** 读取共享素材列表 */
  materials() {
    this.migrateLibrary();
    return this.v.json(`${this.libraryDir()}/materials.json`, []);
  }
  /** 写入共享素材列表 */
  saveMaterials(list) {
    this.v.writeJSON(`${this.libraryDir()}/materials.json`, list);
  }
  /** 读取某篇文章的素材链接（仅 id + enabled） */
  links(id) {
    this.migrateLibrary();
    return this.v.json(this.project(id) + "/references.json", []);
  }
  /** 写入某篇文章的素材链接 */
  saveLinks(id, list) {
    this.v.writeJSON(this.project(id) + "/references.json", list);
  }
  /**
   * 将旧版「每文一份完整素材」迁移为共享库 + 链接。
   */
  migrateLibrary() {
    const libPath = `${this.libraryDir()}/materials.json`;
    const library = this.v.json(libPath, []);
    const byId = new Map(library.map((m) => [m.id, m]));
    let changed = false;
    for (const id of Object.keys(this.v.index || {})) {
      if (!/^[\w-]+$/.test(id)) continue;
      const rel = `${this.v.meta}/projects/${id}/references.json`;
      if (!fs.existsSync(this.v.p(rel))) continue;
      const raw = this.v.json(rel, []);
      if (!raw.length) continue;
      if (!raw.some((r) => r && r.path)) continue;
      const links = [];
      for (const r of raw) {
        if (!r?.id) continue;
        if (r.path) {
          if (!byId.has(r.id)) {
            const item = {
              id: r.id,
              name: r.name,
              path: r.path,
              textPath: r.textPath,
              bytes: r.bytes,
              characters: r.characters,
              status: r.status,
              error: r.error || "",
              at: r.at,
              ocr: !!r.ocr,
              hash: r.hash || "",
            };
            byId.set(r.id, item);
            library.push(item);
            changed = true;
          }
          links.push({ id: r.id, enabled: !!r.enabled });
        } else {
          links.push({ id: r.id, enabled: !!r.enabled });
        }
      }
      this.v.writeJSON(rel, links);
      changed = true;
    }
    if (changed) this.v.writeJSON(libPath, library);
  }
  refs(id) {
    const lib = this.materials();
    return this.links(id)
      .map((link) => {
        const m = lib.find((x) => x.id === link.id);
        return m ? this.enrichMaterial({ ...m, enabled: !!link.enabled }) : null;
      })
      .filter(Boolean);
  }
  /**
   * 列出素材库；附带被哪些文章引用。
   * @param {string} [account]
   */
  allMaterials(account) {
    const lib = this.materials();
    const docs = Object.entries(this.v.index || {})
      .filter(([, v]) => v.status === "draft")
      .map(([id, v]) => {
        const title = path.basename(v.path || "", ".md") || id;
        const acc = String(v.path || "").includes("金奇_Dev") ? "Dev" : "AI";
        return { id, title, account: acc };
      })
      .filter((d) => !account || d.account === account);
    const usage = new Map();
    for (const d of docs) {
      try {
        for (const link of this.links(d.id)) {
          if (!usage.has(link.id)) usage.set(link.id, []);
          usage.get(link.id).push({ id: d.id, title: d.title });
        }
      } catch {
        /* 无项目目录 */
      }
    }
    return lib
      .map((m) => {
        const usedBy = usage.get(m.id) || [];
        return this.enrichMaterial({
          ...m,
          usedBy,
          refCount: usedBy.length,
        });
      })
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }

  /**
   * 补充预览类型、摘要与资源地址（保留原文件，不另存 txt）。
   * @param {object} m
   */
  enrichMaterial(m) {
    const kind = m.kind || materialKind(m.name);
    const asset =
      kind === "image" && m.path
        ? "inkasset://vault/" + encodeURIComponent(m.path)
        : "";
    let preview = "";
    if (m.status === "ready" && isTextKind(kind)) {
      try {
        preview = this.readMaterialSource(m).slice(0, 600);
      } catch {
        preview = "";
      }
    }
    return { ...m, kind, preview, asset };
  }

  /**
   * 读取素材原文（优先原文件；兼容旧版 textPath）。
   * @param {object} m
   */
  readMaterialSource(m) {
    const kind = m.kind || materialKind(m.name);
    if (kind === "image") {
      if (m.textPath && fs.existsSync(this.v.p(m.textPath)))
        return fs.readFileSync(this.v.p(m.textPath), "utf8");
      return `[图片素材：${m.name}]\n（原图已保留，未提取为文本）`;
    }
    if (kind === "binary") {
      if (m.textPath && fs.existsSync(this.v.p(m.textPath)))
        return fs.readFileSync(this.v.p(m.textPath), "utf8");
      return `[文件素材：${m.name}]\n（已保留原格式，当前不提供文本预览）`;
    }
    if (m.path && fs.existsSync(this.v.p(m.path))) {
      const text = fs.readFileSync(this.v.p(m.path), "utf8");
      if (text.includes("\uFFFD"))
        throw Error("文字编码不是 UTF-8，请转换后上传");
      return text;
    }
    if (m.textPath && fs.existsSync(this.v.p(m.textPath)))
      return fs.readFileSync(this.v.p(m.textPath), "utf8");
    throw Error("素材文件不存在");
  }

  async upload(id, paths) {
    this.project(id);
    const library = this.materials();
    const links = this.links(id);
    for (const src of paths) {
      if (
        !fs.statSync(src).isFile() ||
        fs.statSync(src).size > 40 * 1024 * 1024
      )
        throw Error("仅支持 40MB 以内的文件");
      const bytes = fs.readFileSync(src);
      const fileHash = digest(bytes);
      // 同一篇文章已关联相同内容时跳过，避免重复条目
      const existing = library.find(
        (m) => m.hash === fileHash && m.status === "ready",
      );
      if (existing && links.some((l) => l.id === existing.id)) continue;

      const rid = crypto.randomUUID(),
        name =
          clean(path.basename(src, path.extname(src))) +
          path.extname(src).toLowerCase(),
        // 一律落入共享 library，不再写入 projects/.../files 或仅做引用映射
        rel = "00_wiki/_data/raw/library/" + rid + "/" + name;
      fs.mkdirSync(path.dirname(this.v.p(rel)), { recursive: true });
      fs.writeFileSync(this.v.p(rel), bytes);
      const kind = materialKind(name);
      let characters = 0,
        status = "ready",
        error = "";
      if (isTextKind(kind)) {
        const text = bytes.toString("utf8");
        if (text.includes("\uFFFD")) {
          status = "unreadable";
          error = "文字编码不是 UTF-8，请转换后上传";
        } else characters = text.length;
      } else if (kind === "image") {
        characters = 0;
      } else {
        characters = bytes.length;
      }
      library.push({
        id: rid,
        name,
        path: rel,
        textPath: "",
        bytes: bytes.length,
        characters,
        status,
        error,
        at: new Date().toISOString(),
        ocr: false,
        hash: fileHash,
        kind,
      });
      this.saveMaterials(library);
      links.push({
        id: rid,
        enabled: status === "ready" && kind !== "binary",
      });
      this.saveLinks(id, links);
    }
    return this.refs(id);
  }
  /** 从文件提取纯文本（旧逻辑保留，入库流程不再调用） */
  async extract(p) {
    const ext = path.extname(p).toLowerCase();
    if (
      [
        ".md",
        ".txt",
        ".csv",
        ".json",
        ".yaml",
        ".yml",
        ".log",
        ".tsv",
        ".html",
      ].includes(ext)
    ) {
      const bytes = fs.readFileSync(p);
      let text = bytes.toString("utf8");
      if (text.includes("\uFFFD"))
        throw Error("文字编码不是 UTF-8，请转换后上传");
      return text;
    }
    if ([".docx", ".doc", ".rtf"].includes(ext)) {
      return (
        await exec("/usr/bin/textutil", ["-convert", "txt", "-stdout", p], {
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout;
    }
    if ([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
      return (
        await exec(this.reader, [p], {
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout;
    }
    throw Error(
      "此格式尚不能解析；原文件已保留，请上传 PDF、Word、UTF-8 文本或图片",
    );
  }
  refText(id, rid) {
    const linked = this.refs(id).find((r) => r.id === rid);
    if (!linked) throw Error("素材不存在");
    let text = "";
    try {
      text =
        linked.status === "ready" ? this.readMaterialSource(linked) : "";
    } catch (e) {
      return { ...linked, text: "", error: e.message };
    }
    return { ...linked, text };
  }
  /** 按素材 id 读取正文（素材库预览） */
  materialText(rid) {
    const m = this.materials().find((x) => x.id === rid);
    if (!m) throw Error("素材不存在");
    const enriched = this.enrichMaterial(m);
    let text = "";
    try {
      text =
        enriched.status === "ready" ? this.readMaterialSource(enriched) : "";
    } catch (e) {
      return { ...enriched, text: "", error: e.message || enriched.error };
    }
    return { ...enriched, text: text || enriched.error || "" };
  }
  toggle(id, rid, enabled) {
    const list = this.links(id),
      r = list.find((r) => r.id === rid);
    if (!r) throw Error("素材不存在");
    const m = this.materials().find((x) => x.id === rid);
    if (enabled && m && m.status !== "ready") throw Error("文件尚未解析成功");
    r.enabled = !!enabled;
    this.saveLinks(id, list);
    return this.refs(id);
  }
  /**
   * 删除共享素材，并解除所有文章链接。
   * @param {string} rid
   */
  deleteMaterial(rid) {
    const library = this.materials();
    const m = library.find((x) => x.id === rid);
    if (!m) throw Error("素材不存在");
    for (const id of Object.keys(this.v.index || {})) {
      if (!/^[\w-]+$/.test(id)) continue;
      try {
        const links = this.links(id).filter((l) => l.id !== rid);
        this.saveLinks(id, links);
      } catch {
        /* ignore */
      }
    }
    for (const p of [m.path, m.textPath]) {
      try {
        if (p && fs.existsSync(this.v.p(p))) {
          const abs = this.v.p(p);
          fs.unlinkSync(abs);
          const dir = path.dirname(abs);
          if (
            dir.includes("/library/") &&
            fs.existsSync(dir) &&
            !fs.readdirSync(dir).length
          )
            fs.rmdirSync(dir);
        }
      } catch {
        /* ignore */
      }
    }
    this.saveMaterials(library.filter((x) => x.id !== rid));
    return this.allMaterials();
  }
  /**
   * 将已有素材关联到文章。
   * @param {string} articleId
   * @param {string} rid
   */
  linkMaterial(articleId, rid) {
    this.project(articleId);
    const m = this.materials().find((x) => x.id === rid);
    if (!m) throw Error("素材不存在");
    const links = this.links(articleId);
    if (!links.some((l) => l.id === rid)) {
      links.push({ id: rid, enabled: m.status === "ready" });
      this.saveLinks(articleId, links);
    }
    return this.refs(articleId);
  }
  projectContext(id, linked = []) {
    const selected = this.refs(id).filter(
      (r) => r.enabled && r.status === "ready",
    );
    const text =
      linked
        .filter(
          (rel) =>
            typeof rel === "string" &&
            rel.startsWith("00_wiki/") &&
            rel.endsWith(".md"),
        )
        .map(
          (rel) => "\n[此前关联素材：" + rel + "]\n" + this.v.readMaterial(rel),
        )
        .join("\n") +
      selected
        .map((r) => {
          let body = "";
          try {
            body = this.readMaterialSource(r);
          } catch {
            body = r.error || "";
          }
          return `\n[项目素材：${r.name}${r.kind === "image" ? "；图片原文件已保留" : ""}]\n${body}`;
        })
        .join("\n");
    if (text.length > 30000)
      throw Error(
        "本项目启用的素材超过 30000 字，请关闭本次不需要的文件后重试；不会静默截断素材",
      );
    return text;
  }
}
module.exports = { Knowledge, core, digest, materialKind };
