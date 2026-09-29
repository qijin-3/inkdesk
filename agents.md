# agents.md — Inkdesk 代码约定（供 AI 与人类开发者共同遵守）

> 目的：让未来的 AI 改代码时不自作主张。违反即打回。
> 适用：Electron 主进程（`main.cjs` / `desk-core.cjs` / `core/*`）与渲染进程（`renderer.js` / `ui/*` / `store/*` / `services/*`）。

## 铁律（违反即打回）

1. **行为冻结优先于重构**。任何改动必须先跑 `npm test`（当前 101 项），先红后绿。没有测试兜底的改动不提交。
2. **不引入新依赖**（npm 包、框架、状态库、构建工具）。先问：stdlib / 平台原生 / 已有代码能不能做？能就不加。
3. **不新建架构层**：不加 interface/factory/装饰器等"为未来"的抽象——除非已有 ≥2 个真实调用方。
4. **新增依赖注入前先问**：函数读全局变量（`state/current/pending…`）改为显式传参，必须有理由（可测性、解耦），且改调用方时一次全改，别留混读。
5. **Electron 与网页共用渲染层**。渲染代码要过 `isWeb()` 分支；`window` 访问要 `typeof window === "undefined"` 守卫（见 `ui/dom.js`），否则 node 单测会崩。

## 文件归属（别放错地方）

| 目录/文件 | 放什么 | 不许放 |
|---|---|---|
| `core/*.cjs` | 主进程业务域（vault/agents/wechat/…），纯逻辑，`require` | 任何 DOM / `window` |
| `desk-core.cjs` | **只做转发**（每域一行 delegate），constructor | 业务逻辑（历史教训：搬出 `core/*` 时别加回） |
| `ui/*.js` | 纯渲染 + 事件，DOM 相关 | 直接写全局状态（`state.xxx = …`） |
| `store/*.js` | 唯一可写状态的地方（见 `store/doc-store.js` 范式） | — |
| `services/*.js` | 跨 slice 的流程编排（见 `services/backup-plan.js` 范式） | — |
| `renderer.js` | 启动装配 + 有状态渲染骨架 | 可迁出的纯函数（见下） |
| `tests/*.test.cjs` | 测试 | source |

任何 `ui/*`、`store/*`、`core/*` 超 <400 行必须写拆分理由；已达标基线：
renderer 约 5.1k 行 / desk-core 93 行 / ui 最大 publish.js 约 200 行 / core 最大 agents 约 570 行。

## 迁移套路（绞杀者式，一步步做）

1. 要迁一个函数，先给它写特征测试（红）。逐个迁，每步跑 `npm test` 全绿 + `npm run build`。
2. 迁纯函数：签名不变直接搬；读全局改显式传参（如 `pending → plan`），调用方一次搜全改，用 grep 核对全文件无残留全局名。
3. 迁移后**必须删掉 renderer 里的旧定义**，且 `import`/`require` 齐全——漏 import、漏改名会被测试抓，但别指望，先自查。
4. 附录四坑：delegate 别写默认参（`listAgentModels(this, data = {})` 吞实参）、模块内别留旧 import 名裸调、包路径统一 `.js/.cjs` 全名、`window` 加守卫。

## 提交前清单

- [ ] `npm test` 只有基线已知失败（`tests/skills.test.cjs` 符号链接项）；新增失败即停手修。
- [ ] `npm run build`（JS + CSS）通过。
- [ ] `node scripts/budget-check.cjs` strict 通过（棘轮制：以实测为基线，只防回潮不追理想值）。
- [ ] 若动了 IPC：跑 `tests/ipc-channels.test.cjs`（增删 `API_CHANNELS` 必须同步 `preload.cjs` 白名单）。
- [ ] 承诺的边界无回潮：`desk-core.cjs` 不塞逻辑、`ui/*` 不写状态、不新增依赖。