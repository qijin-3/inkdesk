const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("esbuild");

let createDocStore;
test.before(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "..", "store", "doc-store.js")],
    outfile: "/tmp/doc-store.test.cjs",
    format: "cjs",
    platform: "node",
    bundle: true,
  });
  ({ createDocStore } = require("/tmp/doc-store.test.cjs"));
});

function makeDeps(over = {}) {
  const calls = { toast: [], status: [], conflict: 0, saves: 0 };
  let dirty = false;
  const state = { documents: [], title: "t" };
  const current = { id: "d1", title: "t", body: "hello" };
  return {
    calls,
    deps: {
      getState: () => state,
      getCurrent: () => current,
      isReviewDemo: () => false,
      isDirty: () => dirty,
      setDirty: (v) => {
        dirty = v;
      },
      api: async () => {
        calls.saves += 1;
        return {};
      },
      toast: (t) => calls.toast.push(t),
      setSavedStatus: (t) => calls.status.push(t),
      onExternalConflict: () => {
        calls.conflict += 1;
      },
      queryCard: () => null,
      ...over,
    },
    getDirty: () => dirty,
    state,
    current,
  };
}

test("persist 成功后按快照一致性清 dirty", async () => {
  const { deps, getDirty, calls } = makeDeps();
  const store = createDocStore(deps);
  deps.setDirty(true);
  assert.equal(await store.persist(), true);
  assert.equal(getDirty(), false);
  assert.deepEqual(calls.status, [""]);
  assert.equal(calls.saves, 1);
});

test("保存期间外部又改了则不清 dirty", async () => {
  const { deps, getDirty } = makeDeps();
  const store = createDocStore(deps);
  const origApi = deps.api;
  deps.api = async (...a) => {
    deps.getState().title = "changed-mid-save";
    return origApi(...a);
  };
  deps.setDirty(true);
  assert.equal(await store.persist(), true);
  assert.equal(getDirty(), true);
});

test("演示模式不保存", async () => {
  const { deps, getDirty, calls } = makeDeps({
    isReviewDemo: () => true,
  });
  const store = createDocStore(deps);
  deps.setDirty(true);
  assert.equal(await store.persist(), true);
  assert.equal(getDirty(), false);
  assert.equal(calls.saves, 0);
  assert.deepEqual(calls.status, ["演示中 · 不保存"]);
});

test("冲突中拒绝保存", async () => {
  const { deps, calls } = makeDeps();
  const store = createDocStore(deps);
  store.saveConflict = true;
  assert.equal(await store.persist(), false);
  assert.equal(calls.saves, 0);
});

test("外部修改走冲突引导且只提示一次由调用方控制", async () => {
  const { deps, calls } = makeDeps({
    api: async () => {
      throw new Error("磁盘文件被外部修改");
    },
  });
  const store = createDocStore(deps);
  assert.equal(await store.persist(), false);
  assert.equal(calls.conflict, 1);
  assert.equal(calls.toast.length, 0);
});

test("普通失败 toast", async () => {
  const { deps, calls } = makeDeps({
    api: async () => {
      throw new Error("boom");
    },
  });
  const store = createDocStore(deps);
  assert.equal(await store.persist(), false);
  assert.deepEqual(calls.toast, ["保存失败：boom"]);
});

test("markChanged 刷新卡片并防抖保存", async () => {
  const { deps, getDirty, calls, current } = makeDeps({
    queryCard: () => ({
      querySelector: (s) => ({
        set textContent(v) {
          calls["card:" + s] = v;
        },
      }),
    }),
  });
  const store = createDocStore(deps);
  store.markChanged(10);
  assert.equal(getDirty(), true);
  assert.equal(calls["card:span"], "t");
  assert.match(calls["card:small"], /5 字/);
  assert.ok(current.updated);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.saves, 1);
  store.cancelPending();
});
