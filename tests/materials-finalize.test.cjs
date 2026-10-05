const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DeskCore } = require("../desk-core.cjs");

function setup(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ink-finalize-"));
  const vaultRoot = path.join(data, "Content_OS");
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  fs.mkdirSync(vaultRoot, { recursive: true });
  const core = new DeskCore();
  process.env.INKDESK_DATA = data;
  process.env.INKDESK_VAULT = vaultRoot;
  t.after(() => {
    delete process.env.INKDESK_DATA;
    delete process.env.INKDESK_VAULT;
  });
  core.init({
    dataDir: data,
    projectDir: data,
    readerPath: path.join(__dirname, "..", "assets", "reference-reader"),
  });
  core.vault.createAccount("Demo_AI");
  core.reload();
  const doc = {
    id: "article-finalize-1",
    title: "定稿测试",
    account: "AI",
    body: "正文",
    updated: new Date().toISOString(),
    titles: [],
    snapshots: [],
    conversations: [],
    materials: [],
  };
  core.vault.saveDoc(doc);
  core.reload();
  return { core, id: doc.id };
}

test("finalize 确认态读盘不因 fs 未定义失败", (t) => {
  const { core, id } = setup(t);
  const step = core.finalize(id);
  assert.equal(step.needsConfirmation, true);
  assert.match(step.contentSnapshot, /正文/);
});

test("finalize 二次确认归档成功", (t) => {
  const { core, id } = setup(t);
  const step = core.finalize(id);
  const done = core.finalize({
    id,
    confirmed: true,
    contentSnapshot: step.contentSnapshot,
  });
  assert.equal(done.documents.length, 0);
  assert.equal(done.archives.length, 1);
});
