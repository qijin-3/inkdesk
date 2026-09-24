const fs = require("node:fs"),
  crypto = require("node:crypto");
const defs = [
  { id: "identity", title: "定位与读者", limit: 1600 },
  { id: "voice", title: "表达与边界", limit: 3000 },
  { id: "examples", title: "经历与范文", limit: 6000 },
  { id: "learning", title: "数据与实验", limit: 2400 },
];
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
class AccountModel {
  constructor(v, k) {
    this.v = v;
    this.k = k;
  }
  rel(a) {
    this.k.profileBase(a);
    return this.k.profileBase(a) + "Account_Model.md";
  }
  format(a, modules) {
    const id = this.v.resolveAccountId(a);
    return (
      "# " +
      id.replace(/_/g, " ") +
      " · 账号模型\n\n" +
      defs
        .map((d) => "## " + d.title + "\n\n" + modules[d.id].trim())
        .join("\n\n") +
      "\n"
    );
  }
  parse(raw) {
    const result = {};
    for (let i = 0; i < defs.length; i++) {
      const marker = "## " + defs[i].title + "\n";
      const pos = raw.indexOf(marker);
      if (pos < 0) throw Error("账号模型模块缺失：" + defs[i].title);
      const end =
        i + 1 < defs.length
          ? raw.indexOf("## " + defs[i + 1].title + "\n", pos + marker.length)
          : raw.length;
      result[defs[i].id] = raw.slice(pos + marker.length, end).trim();
    }
    return result;
  }
  ensure(a) {
    const rel = this.rel(a);
    if (fs.existsSync(this.v.p(rel))) return;
    const old = this.k.profile(a);
    const experiences = old.files
      .filter(
        (f) => f.path.includes("Benchmarks/") && !f.path.endsWith("README.md"),
      )
      .slice(0, 5)
      .map(
        (f) =>
          "- [[" +
          this.k.profileBase(a) +
          f.path +
          "|" +
          f.path.split("/").pop().replace(/\.md$/, "") +
          "]]",
      )
      .join("\n");
    const custom = this.k.readProfile(a, "Writing_Contract.md").text;
    const modules = {
      identity:
        "我持续记录自己的判断与实践，写给关心同类问题的读者。\n\n读者看完能理解一个问题或作出更好的选择；不强制每篇给行动清单，不按栏目配额写作。",
      voice:
        "像把刚想清楚的事讲给朋友：自然、具体，有自己的判断。用场景和细节解释观点，术语第一次出现时说人话。\n\n保留克制的情绪、自嘲和不确定性。范文只学叙述方法，不复制句子。结构、开头和结尾按这篇内容决定。\n\n不编造经历、引用、来源和效果；事实缺证据则待核实。不恐吓或贬低读者，少用宏观套话、机械排比、说教结尾和反复的「不是……而是……」。" +
        (custom
          ? "\n\n已有个人约定（迁入，后续在此统一维护）：\n" +
            custom.slice(0, 1200)
          : ""),
      examples:
        "只记录我确认过的经历与我认可的表达样例。每条保留出处和为什么像我，不把参考作者的经历写成自己的。\n\n已有范文资料：\n" +
        (experiences ||
          "暂未选定。可在写完文章后把值得保留的段落和理由补在这里。"),
      learning:
        "每次只保留最多三个可验证的观察：\n- 观察与来源文章\n- 样本、数据和不确定性\n- 下一篇准备尝试的一个调整\n\n缺失值不是零；单篇表现不证明因果。对比一段时间的结果，再保留、替换或删除观察，不累积永久禁令。\n\n当前实验：暂无。",
    };
    const bans = this.k.readProfile(a, "Author_DNA/禁止规则.md").text;
    const preferences = bans.match(/## 禁用词[\s\S]*?(?=\n## 禁用结构|$)/)?.[0];
    if (preferences)
      modules.voice +=
        "\n\n已有明确用词偏好：\n" +
        preferences.slice(0, 1000).replace(/^## /gm, "### ");
    this.write(a, modules);
    this.v.writeJSON(this.meta(a) + "/migration.json", {
      at: new Date().toISOString(),
      legacyFiles: old.files.map((f) => f.path),
      note: "旧文档保留，只使用 Account_Model.md 作为当前设定",
    });
  }
  meta(a) {
    this.k.profileBase(a);
    return this.v.meta + "/account-model/" + a;
  }
  write(a, modules) {
    for (const d of defs) {
      const s = modules[d.id];
      if (
        typeof s !== "string" ||
        s.length > d.limit ||
        defs.some((x) => s.includes("## " + x.title + "\n"))
      )
        throw Error(d.title + " 内容过长或含保留的模块标题");
    }
    const p = this.v.p(this.rel(a));
    fs.writeFileSync(p + ".tmp", this.format(a, modules));
    fs.renameSync(p + ".tmp", p);
  }
  load(a) {
    this.ensure(a);
    const text = fs.readFileSync(this.v.p(this.rel(a)), "utf8");
    return {
      modules: this.parse(text),
      hash: hash(text),
      definitions: defs,
      history: this.v.json(this.meta(a) + "/history.json", []),
      proposals: this.v.json(this.meta(a) + "/proposals.json", []),
      legacy: this.k
        .profile(a)
        .files.filter((f) => f.path !== "Account_Model.md"),
    };
  }
  save(a, modules, base, reason = "手动调整") {
    const current = this.load(a);
    if (current.hash !== base) throw Error("账号设定已变化，请重新读取后保存");
    const history = [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        reason,
        modules: current.modules,
      },
      ...current.history,
    ];
    this.write(a, modules);
    this.v.writeJSON(this.meta(a) + "/history.json", history);
    return this.load(a);
  }
  context(a) {
    const p = this.load(a);
    return this.format(a, p.modules);
  }
  evidence(a, store) {
    const model = this.load(a);
    const articles = [
      ...store.archives
        .filter((x) => x.account === a)
        .map((x) => ({ ...x, date: String(x.fields?.["发布时间"] || "") })),
      ...store.documents
        .filter((x) => x.account === a)
        .map((x) => ({
          ...x,
          path: this.v.index[x.id]?.path,
          date: x.updated,
          fields: { 状态: "草稿，不能用作发布表现样本" },
        })),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12);
    const sources = [this.rel(a), ...articles.map((x) => x.path)];
    return {
      model,
      sources,
      context:
        "当前唯一有效设定：\n" +
        this.context(a) +
        "\n最新文章及原始数据：\n" +
        articles
          .map(
            (x) =>
              "\n来源 " +
              x.path +
              "\n" +
              JSON.stringify(x.fields) +
              "\n" +
              x.body.slice(0, 3000) +
              (x.body.length > 3000 ? "\n[后文省略]" : ""),
          )
          .join("\n"),
    };
  }
  propose(a, changes, e) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 4)
      throw Error("建议必须修改现有模块");
    const ids = new Set();
    for (const c of changes) {
      const d = defs.find((x) => x.id === c.module);
      if (
        !d ||
        ids.has(c.module) ||
        typeof c.content !== "string" ||
        c.content.length > d.limit
      )
        throw Error("不允许增加模块或提交过长规则");
      ids.add(c.module);
      if (
        !Array.isArray(c.sources) ||
        !c.sources.length ||
        c.sources.some((s) => !e.sources.includes(s))
      )
        throw Error("建议缺少真实来源");
    }
    const p = {
      id: crypto.randomUUID(),
      account: a,
      at: new Date().toISOString(),
      base: e.model.hash,
      status: "pending",
      changes: changes.map((c) => ({
        ...c,
        before: e.model.modules[c.module],
      })),
    };
    const list = this.v.json(this.meta(a) + "/proposals.json", []);
    this.v.writeJSON(this.meta(a) + "/proposals.json", [p, ...list]);
    return p;
  }
  decide(a, id, apply, edits) {
    const list = this.v.json(this.meta(a) + "/proposals.json", []),
      p = list.find((x) => x.id === id);
    if (!p || p.status !== "pending") throw Error("建议不存在或已处理");
    if (apply) {
      const model = this.load(a),
        next = { ...model.modules };
      for (const c of p.changes)
        next[c.module] = edits?.[c.module] ?? c.content;
      this.save(a, next, p.base, "采纳 AI 迭代建议");
    }
    p.status = apply ? "applied" : "rejected";
    this.v.writeJSON(this.meta(a) + "/proposals.json", list);
    return this.load(a);
  }
}
function resolveRefs(k, doc, refs, body) {
  if (!Array.isArray(refs) || refs.length > 20) throw Error("引用数量无效");
  const seen = new Set();
  return refs
    .map((r) => {
      if (
        typeof r.refId !== "string" ||
        !/^[\w-]+$/.test(r.refId) ||
        seen.has(r.refId)
      )
        throw Error("引用标识无效");
      seen.add(r.refId);
      if (r.kind === "file") {
        const f = k.refText(doc.id, r.fileId);
        if (f.status !== "ready") throw Error(f.name + " 尚不可读");
        let text = f.text;
        if (r.startLine !== undefined) {
          const lines = text.split("\n");
          if (
            !Number.isInteger(r.startLine) ||
            !Number.isInteger(r.endLine) ||
            r.startLine < 1 ||
            r.endLine < r.startLine ||
            r.endLine > lines.length
          )
            throw Error("文件引用行号无效");
          text = lines.slice(r.startLine - 1, r.endLine).join("\n");
        }
        return (
          "\n[引用 " +
          r.refId +
          "：" +
          f.name +
          (r.startLine ? " 第" + r.startLine + "–" + r.endLine + "行" : "") +
          "]\n" +
          text
        );
      }
      if (r.kind === "selection") {
        if (r.articleId !== doc.id || r.base !== body || body !== doc.body)
          throw Error("引用选段已经过期，请重新选中添加");
        if (
          typeof r.text !== "string" ||
          !Number.isInteger(r.from) ||
          !Number.isInteger(r.to) ||
          r.from >= r.to
        )
          throw Error("选段引用无效");
        return (
          "\n[引用 " +
          r.refId +
          "：当前文章选段，位置 " +
          r.from +
          "–" +
          r.to +
          "]\n" +
          r.text
        );
      }
      throw Error("未知引用类型");
    })
    .join("\n");
}
module.exports = { AccountModel, defs, resolveRefs };
