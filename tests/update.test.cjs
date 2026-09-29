const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  pickMacAsset,
  assetDownloadUrl,
  assertPackageBuffer,
  cmpVersion,
} = require("./update.cjs");

test("pickMacAsset prefers zip over dmg", () => {
  const asset = pickMacAsset({
    assets: [
      {
        name: "Aster-mac-arm64-v1.dmg",
        url: "api-dmg",
        browser_download_url: "https://example/a.dmg",
      },
      {
        name: "Aster-mac-arm64-v1.zip",
        url: "api-zip",
        browser_download_url: "https://example/a.zip",
      },
    ],
  });
  assert.equal(asset.name, "Aster-mac-arm64-v1.zip");
});

test("pickMacAsset accepts dmg when no zip", () => {
  const asset = pickMacAsset({
    assets: [
      {
        name: "Aster-mac-arm64-v1.dmg",
        browser_download_url: "https://example/a.dmg",
      },
    ],
  });
  assert.equal(asset.name, "Aster-mac-arm64-v1.dmg");
});

test("assetDownloadUrl prefers browser_download_url", () => {
  assert.equal(
    assetDownloadUrl({
      url: "https://api.github.com/repos/x/y/releases/assets/1",
      browser_download_url: "https://github.com/x/y/releases/download/v1/a.zip",
    }),
    "https://github.com/x/y/releases/download/v1/a.zip",
  );
});

test("assertPackageBuffer rejects JSON metadata", () => {
  const json = Buffer.from(
    '{"url":"https://api.github.com","id":1,"name":"a.zip","size":1}' +
      " ".repeat(40),
  );
  assert.throws(() => assertPackageBuffer(json, "a.zip"), /不是安装包/);
});

test("assertPackageBuffer accepts zip magic", () => {
  const zip = Buffer.alloc(80, 0);
  zip[0] = 0x50;
  zip[1] = 0x4b;
  assert.doesNotThrow(() => assertPackageBuffer(zip, "a.zip"));
});

test("cmpVersion basic", () => {
  assert.equal(cmpVersion("0.2.5", "0.2.4"), 1);
  assert.equal(cmpVersion("v0.2.4", "0.2.4"), 0);
});
