# Inkdesk 拆解与性能优化方案（v1.0）

> 日期：2026-09-28｜范围：全仓库｜原则：行为冻结、小步快走、可回滚、先测后拆
> 现状：`renderer.js` 6586 行 / `style.css` 5857 行 / `bundle.js` 约 1.3MB（esbuild 单入口全量打包）

## 1. 目标与非目标

### 目标

- `renderer.js < 800 行`（仅保留 bootstrap：init + 路由装配）。
- 无单个 `ui/* > 600 行`；`style.css < 20 行`（仅 import / 打包入口）。
- `bundle.js < 700KB`（gzip `< 220KB`）；桌面冷启动可交互 `< 1.5s`，Web 预览 `< 2.5s`。
- 主线程单长任务 `< 50ms`；连续编辑 30min 内存增长 `< 10%`。
- `npm test` + `npm run test:ui` 全绿；新增代码行覆盖率 `≥ 80%`。

### 非目标（v0.4 之后再议）

- 更换 Tiptap 编辑器内核；主进程存储（vault/indexedDB）大改；顺手改功能、文案、样式。

## 2. 现状基线

| 对象 | 规模 | 风险点 |
|---|---|---|
| `renderer.js` | 6586 行，200+ 函数 | 全局可变状态（`current/conversation/publishedSelection`），隐式跨函数依赖 |
| `style.css` | 5857 行 | 无分层，选择器冲突，层叠顺序敏感；运行时 `@import` 串行 |
| `bundle.js` | 约 1.3MB | Tiptap / Turndown / diff / xlsx 全进首屏 |
| `desk-core.cjs / main.cjs / preload.cjs` | 主进程 + 数据层混杂 | 主/渲染进程边界不清 |
| 测试 | `test.cjs` 系 + `*ui.cjs` smoke | 无覆盖率门禁、无性能基线、无视觉回归 |

## 3. 总体原则

1. 行为冻结：优化期间禁止顺手改功能。重构 PR 必须 `功能 diff = 0`。
2. 一事一 PR：纯移动 / 纯提取 / 纯优化三者不混。
3. 每个阶段结束都是可发布状态，`main` 随时可发版。
4. 缺测试先补测试，再动代码。
5. 性能用数字说话，不凭感觉（见 §6 度量）。

## 4. 拆解方案

### 4.1 `renderer.js` → `ui/` + `store/` + `services/`

已建共享抽象（Stage-1）：

- `ui/dom.js`：`$ / $$ / api / esc / fmtBytes / toast / isWeb / assetUrl`
- `ui/popover.js`：`openMenu / closeMenu`（统一 `showContextMenu`、`openVersionHistoryMenu`、`bindModelPicker` 等浮层定位 + 外部关闭）
- `ui/dialog.js`：`dialog / askText / askConfirm`（统一 `promptText / askFollowers / showSaveConflictDialog` 等 modal）

已抽域快照（按原行号标注，逐个转正为 `export`）：

- `ui/review.js`（原 2676–3141）：`diffHTML / buildEditHunks`、审阅条/卡片全套
- `ui/wechat-png.js`（原 1152–1341）：微信标题/引用块 Canvas 渲染
- `ui/dashboard.js`（原 3738–4466）：仪表盘/日历/已发布预览/备份
- `ui/agents-settings.js`（原 4467–5190）：Providers / 模型选择 / 智能体设置页
- `ui/accounts-materials.js`（原 5443–6122）：账号备份/头像、素材库

建议新增：

```
store/doc-store.js    current/docs/conversation/persist/sync/changed
store/ui-state.js     previewPane/selection/heatmapYear/publishedSelection
services/publish.js   publishHTML/copyPublish/pushWechatDraft
services/import.js    pickNoteTable/runNoteImport/showUnmatchedMatcher
ui/editor.js          renderWrite/bindArticleHeader/mountOutline/selectionFloat
ui/preview.js         renderPreview/renderPublishedPreview/enhanceWechatPreview
ui/assistant.js       renderPanel/streamBubble/runTask/agentModeMenu
ui/settings.js        renderSettings/renderTopics/renderAgentDetail
```

依赖规则：`ui/*` 不许直接写 `store` 全局，必须经 `store` API；`services/*` 不许碰 DOM。

转正顺序（每个 1 PR）：review → wechat-png → dashboard → agents → accounts → store → services → editor/preview/assistant/settings。

### 4.2 `style.css` → `styles/` 分层

当前入口（层叠顺序与原来一致，视觉无变化）：

```css
@import url('./styles/base.css');
@import url('./styles/sidebar-accounts.css');
@import url('./styles/settings-skills.css');
@import url('./styles/editor-preview.css');
@import url('./styles/social-publish.css');
@import url('./styles/assistant-review.css');
@import url('./styles/responsive-motion.css');
```

下一步：

1. 新建 `styles/tokens.css`（变量/字号/间距/颜色，先抽 `:root`）。
2. 从 `base.css` 再拆 `layout.css`（app / sidebar / workspace 三栏）。
3. 把 `editor-preview.css` 一分为二：`editor.css` + `preview.css`。
4. 用 `postcss-import` 或 esbuild CSS bundle 合成单文件，删除运行时 `@import` 串行，加关键样式 `preload`。

### 4.3 其他大文件

- `desk-core.cjs` → `core/vault.cjs / knowledge.cjs / skills.cjs / agents.cjs / update.cjs`，原文件只做 re-export，IPC 接口名不变。
- `main.cjs / preload.cjs`：列出 `window.desk.*` 白名单并加契约测试，禁止新增直通接口。
- `calendar.cjs`：纯函数（`calendar / validDate / publishSummary`）移 `lib/` 并加单测，UI 只消费。
- `composer.js / social-layout.js / aster.js`：保持不动，只补测试。

## 5. 性能优化清单

### P0（先做，风险低）

- [ ] bundle 瘦身：`xlsx`、`TableKit`、`turndown-plugin-gfm`、`review-demo.json` 改动态 `import()` 按路由懒加载（预期 −400~500KB）。
- [ ] CSS 去串行：`@import` 改构建期合并 + 首屏关键样式内联。
- [ ] 预览防抖 + 分片：`renderPreview / enhanceWechatPreview` 加 `requestIdleCallback / rAF` 节流；微信长文 Canvas 分块渲染。
- [ ] 事件委托：列表内逐项 `addEventListener` 改容器委托（审阅条、素材库、已发布列表）。

### P1

- [ ] 虚拟列表：已发布列表 / 素材库 / 群成员列表（>100 项）。
- [ ] 图片管线：预览图 `loading=lazy` + 缩略图；`inkasset://` 加缓存头。
- [ ] 脏区更新：`renderPanel / renderDashboard` 从全量 `innerHTML` 收敛，先加 `performance.mark` 度量再动。

### P2（暂不做）

- 换编辑器内核、存储大改。ROI 低、风险高。

## 6. 度量方法

- 体积：`npm run build` + `npx esbuild --metafile` 分析，PR 附 before/after 表。
- 加载/交互：`performance_start_trace` 取 LCP / INP；`take_snapshot` 辅助定位。
- 内存：`take_heapsnapshot` 在 30min soak 前后对比。
- 门禁：体积超预算 `+5%` 即 CI 失败。

## 7. 测试流程（防回归核心）

### 7.1 四层门禁（每个 PR 必跑 L0+L1，域 PR 加 L2，发版加 L3）

```
L0 静态门禁
├── eslint/tsc：新增 ui/* 0 warn
├── prettier check
└── esbuild build 成功 + 体积对比

L1 单元测试（node --test）
├── 现有 test.cjs 全量通过
├── 新增：calendar 纯函数 / store 状态机 / publish 拼接 / diff hunk
└── 新增代码行覆盖率 ≥ 80%

L2 集成 + UI smoke（Playwright / *ui.cjs）
├── smoke-ui / review-ui / skills-ui / heatmap-ui / agents-ui / usage-ui 全过
├── 新增：审阅接受/拒绝/撤销、发布复制、导入向导、账号切换
└── window.desk.* 白名单快照对比

L3 手工 + 视觉回归（发版前）
├── §7.2 checklist 逐项打勾
├── base vs PR 双版本同 vault 截图 diff
└── 性能复测：冷启动、长文预览、30min soak
```

### 7.2 发版前手工 Checklist

- [ ] 新建 / 切换 / 保存 / 冲突提示
- [ ] 写作 ↔ 预览 ↔ 已发布三态切换
- [ ] 审阅：进入 / 逐条接受拒绝 / 全部决定 / 完成汇总 / 退出
- [ ] 助手：流式输出 / 中断 / 工具调用 / 模型切换
- [ ] 仪表盘：日历 / 排序 / 多选 / 备份 / 移回草稿
- [ ] 素材：上传 / 预览 / 插入 / 删除
- [ ] 账号：切换 / 头像 / 备份路径 / 技能绑定
- [ ] 导入：Excel/CSV 导入 / 未匹配映射
- [ ] 微信推送 / 复制排版（含本地图片提示）

### 7.3 回归与回滚

- `refactor:` 前缀为纯重构，`perf:` 前缀附 before/after 数据。
- 失败先 `git revert`，不原地修；`bundle.js` 只由构建生成，不手改。
- 发版保留上一版 `dist-0.2.x` + vault 自动备份，可降级。

## 8. 里程碑（约 2 周）

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M0 安全网（0.5d） | 锁测试命令、体积预算脚本、性能基线存档 | 基线报告 |
| M1 共享抽象接线（1d） | `dom / popover / dialog` 接入，删重复实现（3 PR） | 3 个小 PR 全绿 |
| M2 域模块转正（3–4d） | review → wechat-png → dashboard → agents → accounts | 5 PR + 单测 + smoke |
| M3 状态层（2d） | `store/doc-store + ui-state`，消灭跨模块直写全局 | 状态机单测 |
| M4 性能 P0（2d） | 懒加载 + CSS 合并 + 预览节流 | before/after 数据 |
| M5 发版硬化（1d） | L3 全量 + soak + 视觉 diff + 打包验证 | 发版 checklist 签字 |

M0 未完成不许进 M1。

## 9. 验收标准

- [ ] `renderer.js < 800 行`，无单个 `ui/* > 600 行`
- [ ] `npm test` + `npm run test:ui` 全绿，覆盖率达标
- [ ] bundle 与首屏耗时达预算且有数据证明
- [ ] 手工 checklist 全过，视觉 diff 零非预期变更
- [ ] 可一键回滚到上一版本并恢复用户 vault
