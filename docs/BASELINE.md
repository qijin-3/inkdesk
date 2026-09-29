# 性能与规模基线（M0，2026-09-28）

> 冻结基线：后续每个 PR 的 before/after 都以此为准对比。

## 测试基线

- `npm test`：40 项中 **39 通过 / 1 失败**。
  - 唯一失败为已知失败（与本次优化无关，改动前后一致）：
    `skills.test.cjs:23 vault .agents/skills scan, symlink mount, bindings`（`3 !== 2`，`skills.test.cjs:133`，环境相关计数断言）。
- `npm run test:ui`：待 M2 起每个域 PR 附带运行记录（本基线仅锁命令，见 `package.json`）。

## 体积基线（`npx esbuild renderer.js --bundle --format=esm --outfile=bundle.js --metafile=meta.json`）

- `bundle.js`：1,375,241 bytes（约 1.3MB），gzip 约 322,943 bytes（约 315KB）。
- 预算：`< 700KB` / gzip `< 220KB` —— 当前超预算（M4 前 `warn` 模式不阻塞，M4 转 `strict`）。
- Top 输入（bytesInOutput）：
  1. `renderer.js` 224.4KB
  2. `@tiptap/core` 197.8KB
  3. `prosemirror-view` 191.2KB
  4. `prosemirror-model` 101.4KB
  5. `marked` 69.5KB / `prosemirror-tables` 69.3KB
  6. `fixtures/review-demo.json` 36.8KB（应懒加载，P0）
- 结论：首屏可砍约 400~500KB（`xlsx`、`TableKit`、`turndown-plugin-gfm`、`review-demo.json` 动态 import，M4 执行）。

## 规模基线

- `renderer.js`：6530 行（M1a 后，原 6586；删 8 个重复定义，转 `ui/dom.js` import）。
- `style.css`：7 行入口 + `styles/*` 共约 5858 行（已分层，只防回潮）。
- `ui/*` 超 600 行目标（M2 需继续拆小）：`dashboard.js` 730、`agents-settings.js` 725、`accounts-materials.js` 681。

## 门禁

- `node scripts/budget-check.cjs`（warn 模式）：本地与 CI 均可跑；`--strict` 用于 M4 后。
- 建议 `package.json` 新增：`"test:budget": "node scripts/budget-check.cjs"`。
