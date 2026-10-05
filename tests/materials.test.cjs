const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Vault } = require("../vault.cjs");
const Materials = require("../core/materials.cjs");
const Groups = require("../core/groups.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ink-materials-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = new Vault(root);
  vault.createAccount("Demo_AI");
  vault.load();
  const core = {
    active: null,
    data: root,
    vault,
    store: vault.load(),
    save() {},
    reload() {
      Object.assign(this.store, vault.load());
      return this.store;
    },
  };
  return core;
}

test("finalize confirmation reads draft without ReferenceError: fs", (t) => {
  const core = fixture(t);
  core.vault.saveDoc({
    id: "a1",
    title: "定稿稿",
    account: "AI",
    body: "正文",
    conversations: [],
    snapshots: [],
  });
  core.reload();
  const step = Materials.finalize(core, "a1");
  assert.equal(step.needsConfirmation, true);
  assert.match(step.message, /已发布/);
  assert.match(step.contentSnapshot, /正文/);
  const done = Materials.finalize(core, {
    id: "a1",
    confirmed: true,
    contentSnapshot: step.contentSnapshot,
  });
  assert.equal(done.documents.length, 0);
  assert.equal(done.archives.length, 1);
});

test("readPublished reads archive without ReferenceError: fs", (t) => {
  const core = fixture(t);
  const rel = "Demo_AI/03_Archive/已发.md";
  fs.writeFileSync(core.vault.p(rel), "---\n标题: 已发\n---\n归档正文");
  const body = Groups.readPublished(core, rel);
  assert.match(body, /归档正文/);
});
