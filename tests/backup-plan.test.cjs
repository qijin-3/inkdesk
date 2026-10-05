const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let resolveBackupPlan;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "services", "backup-plan.js")],
    outfile: "/tmp/backup-plan.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  ({ resolveBackupPlan } = require("/tmp/backup-plan.test.cjs"));
});

const st = () => ({
  archives: [
    { path: "acc1/a.md", title: "A", account: "acc1" },
    { path: "acc1/b.md", title: "B", account: "acc1" },
  ],
  metrics: [
    { path: "acc1/a.md", "分组": "G1" },
    { path: "acc1/b.md", "分组": "G2" },
  ],
  groups: { G1: { backupPath: "/bak/g1" }, G2: {} },
  backupPaths: { acc1: "/bak/acc1" },
});

test("空选择返回 null", async () => {
  assert.equal(
    resolveBackupPlan(st(), { paths: [], account: "acc1" }),
    null,
  );
});

test("单篇同分组有默认路径", async () => {
  const p = resolveBackupPlan(st(), { paths: "acc1/a.md", account: "acc1" });
  assert.equal(p.accountId, "acc1");
  assert.equal(p.singleGroup, "G1");
  assert.equal(p.mixedGroups, false);
  assert.equal(p.defaultPath, "/bak/g1");
  assert.equal(p.label, "「A」");
  assert.equal(p.defaultHint, "/bak/g1");
  assert.equal(p.allHaveDefault, true);
});

test("单篇分组无路径时回退账号路径", async () => {
  const p = resolveBackupPlan(st(), { paths: "acc1/b.md", account: "acc1" });
  assert.equal(p.singleGroup, "G2");
  assert.equal(p.defaultPath, "/bak/acc1");
  assert.equal(p.defaultHint, "/bak/acc1");
  assert.equal(p.allHaveDefault, true);
  assert.equal(p.rememberTarget, "分组「G2」");
});

test("多篇同分组 label 用计数", async () => {
  const s = st();
  s.metrics[1]["分组"] = "G1";
  const p = resolveBackupPlan(s, {
    paths: ["acc1/a.md", "acc1/b.md"],
    account: "acc1",
  });
  assert.equal(p.label, "选中的 2 篇文章");
  assert.equal(p.singleGroup, "G1");
});

test("多分组合并提示", async () => {
  const p = resolveBackupPlan(st(), {
    paths: ["acc1/a.md", "acc1/b.md"],
    account: "acc1",
  });
  assert.equal(p.mixedGroups, true);
  assert.equal(p.singleGroup, null);
  assert.equal(p.defaultPath, "");
  assert.match(p.defaultHint, /可按分组分别同步/);
  assert.equal(p.allHaveDefault, true);
});

test("多分组且都有默认路径", async () => {
  const s = st();
  s.groups.G2.backupPath = "/bak/g2";
  const p = resolveBackupPlan(s, {
    paths: ["acc1/a.md", "acc1/b.md"],
    account: "acc1",
  });
  assert.equal(p.allHaveDefault, true);
  assert.match(p.defaultHint, /可按分组分别同步/);
});

test("preview 标题优先于 archive", async () => {
  const p = resolveBackupPlan(st(), {
    paths: "acc1/a.md",
    account: "acc1",
    preview: { path: "acc1/a.md", title: "预览标题" },
  });
  assert.equal(p.label, "「预览标题」");
});

test("可覆盖 label", async () => {
  const p = resolveBackupPlan(st(), {
    paths: ["acc1/a.md", "acc1/b.md"],
    account: "acc1",
    label: "全部有分组的 2 篇文章",
  });
  assert.equal(p.label, "全部有分组的 2 篇文章");
});

test("未知路径回退文件名与账号", async () => {
  const p = resolveBackupPlan(st(), {
    paths: "acc9/zz.md",
    account: "acc1",
  });
  assert.equal(p.accountId, "acc9");
  assert.equal(p.label, "「zz」");
  assert.equal(p.singleGroup, null);
  assert.match(p.defaultHint, /在设置 · 账号中配置/);
});
