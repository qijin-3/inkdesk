const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
class Skills {
  constructor(vault) {
    this.vault = vault;
    this.file = vault.p("_system/inkdesk/skills.json");
  }
  read() {
    return fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { revision: 0, items: [], accounts: {} };
  }
  list(account) {
    account = this.vault.resolveAccountId(account);
    const s = this.read();
    return {
      ...s,
      account,
      items: s.items.filter(
        (x) => x.scope === "global" || x.account === account,
      ),
    };
  }
  change(account, revision, fn) {
    account = this.vault.resolveAccountId(account);
    const s = this.read();
    if (revision !== s.revision)
      throw Error("技能已在其他窗口更新，请重新打开后编辑");
    fn(s, account);
    s.revision++;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      fs.mkdirSync(this.file + ".history", { recursive: true });
      fs.copyFileSync(
        this.file,
        path.join(
          this.file + ".history",
          `${s.revision}-${crypto.randomUUID()}.json`,
        ),
      );
    }
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, this.file);
    return this.list(account);
  }
  save(p) {
    return this.change(p.account, p.revision, (s, a) => {
      const x = p.skill;
      const old = s.items.find((v) => v.id === x.id);
      if (x.id && !old) throw Error("技能不存在");
      if (old && old.scope !== "global" && old.account !== a)
        throw Error("不能修改其他账号技能");
      if (!["global", "account"].includes(x.scope))
        throw Error("无效的技能范围");
      if (old && old.scope !== x.scope)
        throw Error("已有技能不能改变范围，请创建副本");
      if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 80)
        throw Error("请输入 1–80 字技能名称");
      if (typeof x.prompt !== "string" || x.prompt.length > 20000)
        throw Error("技能指令最多 20000 字");
      const item = {
        id: old?.id || crypto.randomUUID(),
        name: x.name.trim(),
        scope: x.scope,
        account: x.scope === "account" ? a : null,
        prompt: x.prompt,
        includes: Array.isArray(x.includes) ? [...new Set(x.includes)] : [],
      };
      if (!item.prompt.trim() && !item.includes.length)
        throw Error("请填写指令或组合其他技能");
      const next = s.items.filter((v) => v.id !== item.id).concat(item);
      this.expand(next, [item.id], a);
      s.items = next;
    });
  }
  remove(p) {
    return this.change(p.account, p.revision, (s, a) => {
      const item = s.items.find((x) => x.id === p.id);
      if (!item || (item.scope !== "global" && item.account !== a))
        throw Error("技能不存在");
      if (s.items.some((x) => x.includes.includes(p.id)))
        throw Error("这个技能仍被组合技能引用，请先解除引用");
      s.items = s.items.filter((x) => x.id !== p.id);
      for (const k of Object.keys(s.accounts))
        s.accounts[k] = s.accounts[k].filter((id) => id !== p.id);
    });
  }
  configure(p) {
    return this.change(p.account, p.revision, (s, a) => {
      this.expand(s.items, p.ids, a);
      s.accounts[a] = [...new Set(p.ids)];
    });
  }
  expand(items, ids, account) {
    if (!Array.isArray(ids) || ids.length > 30)
      throw Error("一次最多使用 30 个技能");
    const result = [],
      seen = new Set();
    const visit = (id, stack = [], globalParent = false) => {
      const x = items.find((x) => x.id === id);
      if (!x || (x.scope !== "global" && x.account !== account))
        throw Error("引用的技能不存在或不属于当前账号");
      if (globalParent && x.scope !== "global")
        throw Error("通用技能只能组合通用技能");
      if (stack.includes(id)) throw Error("技能组合存在循环引用");
      if (seen.has(id)) return;
      for (const child of x.includes)
        visit(child, [...stack, id], x.scope === "global");
      seen.add(id);
      result.push(x);
    };
    for (const id of ids) visit(id);
    return result;
  }
  context(account, ids) {
    account = this.vault.resolveAccountId(account);
    const s = this.read();
    return this.expand(s.items, ids ?? s.accounts[account] ?? [], account)
      .map((x, i) => `技能 ${i + 1}：${x.name}\n${x.prompt}`)
      .join("\n\n");
  }
}
module.exports = { Skills };
