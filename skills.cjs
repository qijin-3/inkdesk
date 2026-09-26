const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process");

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILLS_ROOT = ".agents/skills";

/**
 * 解析 SKILL.md YAML frontmatter（仅支持简单 key: value）。
 * @param {string} text
 */
function parseSkillMd(text) {
  const m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw Error("SKILL.md 缺少 YAML frontmatter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    if (key) meta[key] = val;
  }
  const name = String(meta.name || "").trim();
  const description = String(meta.description || "").trim();
  if (!NAME_RE.test(name) || name.length > 64)
    throw Error("SKILL.md 的 name 须为 1–64 位小写字母、数字与连字符");
  if (!description || description.length > 1024)
    throw Error("SKILL.md 的 description 须为 1–1024 字");
  return { name, description, body: text.slice(m[0].length) };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const from = path.join(src, e.name),
      to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else if (e.isFile()) fs.copyFileSync(from, to);
  }
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

class Skills {
  constructor(vault) {
    this.vault = vault;
    this.file = vault.p("_system/inkdesk/skills.json");
    this.rootRel = SKILLS_ROOT;
  }

  rootAbs() {
    return this.vault.p(this.rootRel);
  }

  packAbs(id) {
    const rel = String(id || "").replace(/\\/g, "/");
    if (!rel || rel.includes("..") || path.isAbsolute(rel))
      throw Error("无效的技能路径");
    return this.vault.p(path.join(this.rootRel, rel));
  }

  /**
   * 规范化技能账号绑定：`"all"` | `"none"` | 账号 id 数组。
   * @param {unknown} raw
   */
  normalizeBinding(raw) {
    if (raw === "all" || raw === "none") return raw;
    if (Array.isArray(raw)) {
      const ids = [
        ...new Set(
          raw.map((x) => String(x || "").trim()).filter(Boolean),
        ),
      ];
      return ids.length ? ids : "none";
    }
    return "none";
  }

  /**
   * 旧版 accounts: { accountId: skillIds[] } → bindings: { skillId: ... }
   * @param {Record<string, unknown>} accounts
   */
  bindingsFromAccounts(accounts) {
    const bindings = {};
    for (const [accountId, skillIds] of Object.entries(accounts || {})) {
      if (!Array.isArray(skillIds)) continue;
      for (const id of skillIds) {
        const skillId = String(id || "").trim();
        if (!skillId) continue;
        if (!bindings[skillId]) bindings[skillId] = [];
        if (!bindings[skillId].includes(accountId))
          bindings[skillId].push(accountId);
      }
    }
    for (const [id, v] of Object.entries(bindings))
      bindings[id] = this.normalizeBinding(v);
    return bindings;
  }

  /**
   * 由 bindings 推导「账号 → 可用技能」；供挂载与会话选择器使用。
   * @param {Record<string, unknown>} bindings
   * @param {Set<string>} skillIds
   * @param {string[]} [accountIds]
   */
  accountsFromBindings(bindings, skillIds, accountIds = []) {
    const accounts = {};
    for (const a of accountIds) accounts[a] = [];
    for (const [skillId, raw] of Object.entries(bindings || {})) {
      if (!skillIds.has(skillId)) continue;
      const b = this.normalizeBinding(raw);
      if (b === "none") continue;
      if (b === "all") {
        for (const a of Object.keys(accounts)) accounts[a].push(skillId);
        continue;
      }
      for (const a of b) {
        if (!accounts[a]) accounts[a] = [];
        if (!accounts[a].includes(skillId)) accounts[a].push(skillId);
      }
    }
    return accounts;
  }

  skillAvailableFor(binding, account) {
    const b = this.normalizeBinding(binding);
    if (b === "all") return true;
    if (b === "none") return false;
    return b.includes(account);
  }

  readRegistry() {
    if (!fs.existsSync(this.file))
      return { revision: 0, bindings: {} };
    const s = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (!s || typeof s !== "object")
      return { revision: 0, bindings: {} };
    const items = Array.isArray(s.items) ? s.items : [];
    const legacy = items.some(
      (x) =>
        x &&
        (typeof x.prompt === "string" ||
          Array.isArray(x.includes) ||
          x.scope === "account" ||
          x.scope === "global"),
    );
    if (legacy) return { revision: Number(s.revision) || 0, bindings: {} };
    if (s.bindings && typeof s.bindings === "object") {
      const bindings = {};
      for (const [id, v] of Object.entries(s.bindings))
        bindings[id] = this.normalizeBinding(v);
      return { revision: Number(s.revision) || 0, bindings };
    }
    return {
      revision: Number(s.revision) || 0,
      bindings: this.bindingsFromAccounts(
        s.accounts && typeof s.accounts === "object" ? s.accounts : {},
      ),
    };
  }

  /**
   * 扫描 .agents/skills：含 SKILL.md 的目录为技能，其余目录为分组。
   */
  scan(dirAbs = this.rootAbs(), group = "") {
    const items = [];
    if (!fs.existsSync(dirAbs)) return items;
    for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const abs = path.join(dirAbs, e.name);
      const id = group ? `${group}/${e.name}` : e.name;
      const skillMd = path.join(abs, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        let description = "";
        let missing = false;
        let name = e.name;
        try {
          const meta = parseSkillMd(fs.readFileSync(skillMd, "utf8"));
          description = meta.description;
          name = meta.name;
          if (meta.name !== e.name) missing = true;
        } catch {
          missing = true;
        }
        items.push({
          id,
          name,
          group,
          description,
          missing,
          path: `${this.rootRel}/${id}`,
        });
      } else {
        items.push(...this.scan(abs, id));
      }
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  treeFrom(items) {
    const map = new Map();
    for (const x of items) {
      const g = x.group || "";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(x);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, skills]) => ({ group, label: group || "根目录", skills }));
  }

  list(account) {
    account = this.vault.resolveAccountId(account);
    const reg = this.readRegistry();
    const scanned = this.scan();
    const ids = new Set(scanned.map((x) => x.id));
    const bindings = {};
    for (const [k, v] of Object.entries(reg.bindings)) {
      if (!ids.has(k)) continue;
      bindings[k] = this.normalizeBinding(v);
    }
    const accountIds = new Set([
      account,
      ...Object.keys(reg.bindings).flatMap((skillId) => {
        const b = this.normalizeBinding(reg.bindings[skillId]);
        return Array.isArray(b) ? b : [];
      }),
    ]);
    const accounts = this.accountsFromBindings(bindings, ids, [...accountIds]);
    const items = scanned.map((x) => ({
      ...x,
      binding: bindings[x.id] ?? "none",
    }));
    return {
      revision: reg.revision,
      account,
      root: this.rootRel,
      items,
      tree: this.treeFrom(items),
      bindings,
      accounts,
    };
  }

  change(account, revision, fn) {
    account = this.vault.resolveAccountId(account);
    const reg = this.readRegistry();
    if (revision !== reg.revision)
      throw Error("技能已在其他窗口更新，请重新打开后编辑");
    fn(reg, account);
    reg.revision++;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      fs.mkdirSync(this.file + ".history", { recursive: true });
      fs.copyFileSync(
        this.file,
        path.join(
          this.file + ".history",
          `${reg.revision}-${crypto.randomUUID()}.json`,
        ),
      );
    }
    const tmp = this.file + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        { revision: reg.revision, bindings: reg.bindings },
        null,
        2,
      ),
    );
    fs.renameSync(tmp, this.file);
    return this.list(account);
  }

  readSkillDir(dir) {
    const skillMd = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillMd)) throw Error("所选文件夹缺少 SKILL.md");
    const meta = parseSkillMd(fs.readFileSync(skillMd, "utf8"));
    const folder = path.basename(dir);
    if (folder !== meta.name)
      throw Error(`目录名「${folder}」须与 SKILL.md 的 name「${meta.name}」一致`);
    return meta;
  }

  assertName(name) {
    if (!NAME_RE.test(name) || name.length > 64)
      throw Error("技能名称须为 1–64 位小写字母、数字与连字符");
  }

  /** 目标相对 id：可选 group/name */
  resolveTargetId(p, name) {
    const group = String(p.group || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (group) {
      for (const part of group.split("/")) {
        if (!NAME_RE.test(part)) throw Error("分组路径须为小写字母、数字与连字符");
      }
    }
    return group ? `${group}/${name}` : name;
  }

  import(p) {
    return this.change(p.account, p.revision, (reg) => {
      const src = path.resolve(String(p.sourcePath || ""));
      if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory())
        throw Error("请选择有效的技能文件夹");
      const meta = this.readSkillDir(src);
      this.assertName(meta.name);
      const id = this.resolveTargetId(p, meta.name);
      const dest = this.packAbs(id);
      if (fs.existsSync(dest)) throw Error("技能目录已存在：" + id);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyDir(src, dest);
      reg.bindings[id] = "all";
    });
  }

  create(p) {
    return this.change(p.account, p.revision, (reg) => {
      const name = String(p.name || "")
        .trim()
        .toLowerCase();
      const description = String(p.description || "").trim();
      this.assertName(name);
      if (!description || description.length > 1024)
        throw Error("请填写 1–1024 字描述");
      const id = this.resolveTargetId(p, name);
      const dest = this.packAbs(id);
      if (fs.existsSync(dest)) throw Error("技能目录已存在：" + id);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(
        path.join(dest, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n在此编写技能说明。需要时把参考资料放到 references/，脚本放到 scripts/。\n`,
      );
      reg.bindings[id] = "all";
    });
  }

  remove(p) {
    return this.change(p.account, p.revision, (reg) => {
      const abs = this.packAbs(p.id);
      if (!fs.existsSync(path.join(abs, "SKILL.md")))
        throw Error("技能不存在");
      rmrf(abs);
      delete reg.bindings[p.id];
    });
  }

  /**
   * 设置单个技能的账号绑定。
   * @param {{ account: string, revision: number, id: string, binding: "all"|"none"|string[] }} p
   */
  configure(p) {
    return this.change(p.account, p.revision, (reg) => {
      const id = String(p.id || "").trim();
      if (!id) throw Error("缺少技能 id");
      const known = new Set(this.scan().map((x) => x.id));
      if (!known.has(id)) throw Error("引用的技能不存在：" + id);
      this.readSkillDir(this.packAbs(id));
      const binding = this.normalizeBinding(p.binding);
      if (Array.isArray(binding) && binding.length > 30)
        throw Error("一个技能最多绑定 30 个账号");
      if (binding === "none") delete reg.bindings[id];
      else reg.bindings[id] = binding;
    });
  }

  /**
   * 将启用技能以软链接挂到 agent 工作区的 .agents/skills。
   * @returns {{ name: string, description: string, id: string }[]}
   */
  mount(account, ids, destRoot) {
    account = this.vault.resolveAccountId(account);
    const reg = this.readRegistry();
    const scanned = this.scan();
    const skillIds = new Set(scanned.map((x) => x.id));
    const available = scanned
      .filter((x) =>
        this.skillAvailableFor(reg.bindings[x.id] ?? "none", account),
      )
      .map((x) => x.id);
    const selected = ids ?? available;
    if (!Array.isArray(selected) || selected.length > 30)
      throw Error("一次最多使用 30 个技能");
    const mountDir = path.join(destRoot, SKILLS_ROOT);
    rmrf(mountDir);
    fs.mkdirSync(mountDir, { recursive: true });
    const mounted = [];
    const usedNames = new Set();
    for (const id of selected) {
      if (!skillIds.has(id)) throw Error("引用的技能不存在：" + id);
      const src = this.packAbs(id);
      const meta = this.readSkillDir(src);
      if (usedNames.has(meta.name))
        throw Error(`启用列表中存在同名技能：${meta.name}`);
      usedNames.add(meta.name);
      fs.symlinkSync(src, path.join(mountDir, meta.name), "dir");
      mounted.push({
        id,
        name: meta.name,
        description: meta.description,
      });
    }
    return mounted;
  }

  contextPrompt(mounted) {
    if (!mounted.length) return "本次未启用文件夹技能。\n";
    const list = mounted
      .map((x, i) => `${i + 1}. ${x.name} — ${x.description}`)
      .join("\n");
    return (
      "本次启用的技能已通过软链接挂载到工作区 .agents/skills/<name>/。\n" +
      "每个技能含 SKILL.md。请阅读并遵循已启用技能；需要时再加载其 references/、scripts/、assets/。\n" +
      "已启用：\n" +
      list +
      "\n"
    );
  }

  reveal(p) {
    const abs = p.id ? this.packAbs(p.id) : this.rootAbs();
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(this.rootAbs(), { recursive: true });
    }
    const target = p.id ? abs : this.rootAbs();
    if (!fs.existsSync(target)) throw Error("技能目录不存在");
    execFileSync("open", [target]);
    return { ok: true, path: target };
  }
}

module.exports = { Skills, parseSkillMd, SKILLS_ROOT };
