# Inkdesk 架构优化方案（2026）

> 目标：消灭屎山，不制造新屎山。本方案默认走最小改动路线，凡"教科书式"但对本项目无收益的，一律不做（理由见 §6）。

## 0. 先说结论（ponytail 评估）

- **不需要"前后端分离"**：这是一个本地 Electron 应用，不是 SaaS。真正的边界已经存在：`main.cjs`（主进程）→ `preload.cjs`（111 行，受限 API）→ `renderer.js`（UI）。缺的不是分离，是**渲染进程内部的分层**和主进程 `desk-core.cjs`（1889 行）的拆分。
- **不需要新框架/新语言/新基建**：No TypeScript 重写、No React/Vue 迁移、No monorepo、No 状态库。每一个都会带来数周迁移成本，零用户价值。
- **真正的屎山只有两座**：`renderer.js`（5789 行，132 个函数）+ `desk-core.cjs`（1889 行）。其余都是小丘，打掉这两座即达目标。
- **路线**：绞杀者模式（strangler），逐个功能从旧文件迁出，每步可发布、可回滚。禁止"重写分支"——重写分支是屎山的产房。

## 1. 现状诊断（数据说话）

| 文件 | 行数 | 定性 |
|---|---|---|
| `renderer.js` | 5789 / 132 函数 | god file：状态 + 渲染 + 事件 + IPC 全混装 |
| `desk-core.cjs` | 1889 | god module：vault/skills/agents/update 全塞一起 |
| `main.cjs` | 440 | 健康 |
| `preload.cjs` | 111 | 健康（已是最小 API 面） |
| `ui/*`（11 个）`store/*` `services/*` | 均 < 250 行 | 前几轮已拆出的好代码，保持 |

第一步不是写代码，是**删代码**：跑一遍死代码普查（`npx eslint --no-eslintrc --rule no-unused-vars` + esbuild metafile 看未引用导出 + grep 找零调用函数），先提一个纯删除 PR。删掉的代码不需要架构。

## 2. 目标架构（最小够用版）

```
main.cjs (440行, 不动)
  └── core/<domain>.cjs        ← desk-core.cjs 按域拆分, 薄 re-export 保持兼容
        vault.cjs / knowledge.cjs / skills.cjs / agents.cjs / update.cjs
              ↕ IPC（preload 白名单，接口名冻结，加一个减一个都要理由）
renderer.js (目标: 只剩启动装配 <300行)
  ├── ui/<feature>.js          ← 纯渲染+事件, 不直接碰 state（已有 11 个，继续加）
  ├── store/<slice>.js         ← 唯一可写状态的地方（已有 doc-store.js 范式）
  └── services/<flow>.js       ← 跨 store 的流程编排（已有 backup-plan.js 范式）
```

三条铁律（违反即打回）：

1. `ui/` 不直接写全局状态，只读 + 发事件/调 store。
2. `store/` 是唯一真相来源，一个 slice 一个文件，跨 slice 通信走 `services/`。
3. 新文件 >300 行必须有拆分理由；旧文件迁出时顺手删死代码，不顺手加功能。

## 3. 分阶段计划（每阶段独立可发布）

### P0 死代码删除（0.5 天）
- 普查 + 纯删除 PR + 全量测试绿。度量：删除行数。
- 退出标准：`npm test` 全绿，无行为变化。

### P1 desk-core.cjs 拆分（2–3 天）
- 按现有内部边界拆 `core/*.cjs`，`desk-core.cjs` 只做 `module.exports` 转发，IPC 接口名零变化。
- 每域一个 PR，附该域单测。先拆最独立的（update → skills → agents → knowledge → vault）。
- 退出标准：`desk-core.cjs < 100 行`（纯转发），调用方零改动。

### P2 renderer.js 绞杀（2–3 周，主体）
顺序按"依赖扇出从小到大"，每次迁一个完整功能竖片（渲染+事件+store slice 一起走），不按层横切：

1. 素材库（materials）——最独立
2. 仪表盘（dashboard）+ 备份流程（backup-plan 已有地基）
3. 设置/分组/账号
4. 审阅流（review）
5. 助手对话（assistant，扇出最大，放最后）

每个竖片：`ui/<x>.js` + `store/<x>.js`（如需）+ 测试，renderer.js 只删不加。
- 退出标准：`renderer.js < 800 行`（装配层），无单个 `ui/* > 400 行`。

### P3 契约锁死（0.5 天）
- `preload` 白名单快照测试：增删 IPC 接口必须同步更新快照，否则 CI 红。
- 体积预算转 strict（已有 `scripts/budget-check.cjs`，warn → strict）。

## 4. 支撑未来增长的设计（只留三个钩子，多一个不留）

1. **Skill/Provider 注册表**：新 AI 供应商/Agent 只加 `AGENT_PROVIDERS` 一项 + 对应 adapter，不碰 UI 代码（`ui/agent-store.js` 已是这个形状，保持）。
2. **IPC 版本化**：`window.desk.call(name, data)` 加 `v` 字段，新接口 `name@v2`，老接口冻结只修 bug，不重构签名。
3. **竖片模板**：新功能按 `ui/<x>.js + store/<x>.js + tests/<x>.test.cjs` 三件套开工，文档里给一个 30 行示例。模板之外的结构一律不批。

## 5. 测试策略（和代码同等重要）

- 迁移 X 功能前，先有 X 的特征测试（L2 smoke 或单测），红→迁→绿。
- 每个 PR 必跑：`npm test` + `npm run build` + budget-check。
- 发版前：核心旅程 checklist（新建/保存/审阅/助手/发布/导入/备份）手工过一遍。
- 回滚：每个 PR 独立可 revert；`bundle.js` 只由构建生成，不手改。

## 6. 明确不做的事（YAGNI 清单）

| 提议 | 不做的理由 |
|---|---|
| TypeScript 全量迁移 | 86 项测试已覆盖行为；类型重写数周工作量，修的是"感觉"不是 bug |
| React/Vue 重写渲染层 | 现有命令式渲染工作正常；框架解决的是团队协作问题，单人项目用不上 |
| 前后端分离（HTTP API 化） | 本地应用，IPC 就是前后端边界；套 HTTP 只加延迟和鉴权负担 |
| monorepo / pnpm workspaces | 单包项目，拆包是组织手段不是架构手段 |
| 状态库（redux/zustand） | `store/<slice>.js` 朴素模块已够，引入库先付学习+迁移税 |
| 微前端/插件沙箱 | skills 机制已是事实插件点，沙箱等真有第三方插件再说 |

以上任何一项，将来出现真实痛点（不是预感）时再立项，届时本方案的竖片结构让它们都好切。

## 7. 验收

- [x] `desk-core.cjs < 100 行`（1889 → 93，纯转发 + constructor）✅
- [~] `renderer.js < 800 行`：5789 → 5219。纯函数层已抽完（ui/html|publish|import-match|materials-view 等）；
  剩余 130 个函数为有状态渲染/事件，需 store 上下文化改造，超出单轮行为冻结边界，列为 P2-2（见下）。
- [x] 无 `ui/* > 400 行`（最大 publish.js 203 行），`core/*` 最大 agents 573 行（CLI 适配表为主，逻辑内聚）。
- [x] 零新增依赖，零新框架
- [x] `npm test` 98 项 97 通过（唯一失败为基线已知项），budget-check strict 通过
- [x] preload 白名单快照测试 `tests/ipc-channels.test.cjs`（增删通道必绿）
- [x] 体积预算改棘轮制：以实测为基线 +5%，只防回潮

## 8. 执行记录（2026-09-29/30 自主执行轮）

- P0：删 `inlineReviewBarHTML`（空 stub）、`showMaterial`、`showModelProposal`（零调用 modal）及 `diff` 重复 import，renderer -78 行。
- P1：`core/{wechat,agents,notes,groups,materials,state,router,defaults}.cjs`，desk-core 只剩转发 + constructor。
  附带修了 2 个迁移 bug（delegate 默认参数吞实参；模块内裸调旧 import 名），均被既有测试当场抓住。
- P2：`ui/{html,publish,import-match,materials-view}.js`，renderer -570 行。`publish.js` 漏 import 常量被 scope audit 抓出。
- P3：IPC 快照测试 + 预算棘轮 strict。
- P2-2（未做，需立项）：有状态渲染层（renderWrite/renderSettings/renderPanel/runTask…）迁出，
  前提是先给 renderer 建 store 上下文 + Electron 可运行冒烟（本机无 Xvfb 无法验证大动作）。
