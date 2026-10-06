const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const listOf = (src, name) => {
  const m = src.match(new RegExp("(?:const|let|var)\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
  assert.ok(m, name + " list not found");
  return m[1].split("\n").map((l) => l.trim().replace(/,$/, "").replace(/^"|"$/g, "")).filter((x) => x.startsWith('"') === false && x.length && !x.startsWith("/")).map((x) => x.replace(/"/g, ""));
};

const router = fs.readFileSync(path.join(root, "core", "router.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(root, "main.cjs"), "utf8");

const api = listOf(router, "API_CHANNELS");
const channels = listOf(preload, "channels");
const direct = [...main.matchAll(/ipcMain\.(?:handle|on)\("([^"]+)"/g)].map((m) => m[1]);

test("preload 白名单都有服务端实现（router 或 main 直连）", () => {
  const covered = new Set([...api, ...direct]);
  const missing = channels.filter((c) => !covered.has(c));
  assert.deepEqual(missing, []);
});

test("router 无死通道：API_CHANNELS 全在 preload 白名单", () => {
  const dead = api.filter((c) => !channels.includes(c));
  assert.deepEqual(dead, []);
});

test("通道名无重复", () => {
  for (const [n, l] of [["API_CHANNELS", api], ["preload channels", channels]]) {
    assert.equal(new Set(l).size, l.length, n + " has duplicates");
  }
});

test("inkasset 协议开启 corsEnabled（小红书预览 fetch→blob 需要）", () => {
  assert.match(main, /scheme:\s*"inkasset"/);
  assert.match(main, /corsEnabled:\s*true/);
});
