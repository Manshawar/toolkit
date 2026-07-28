# bugrelay × tkt 落地方案

> 上游方案：`/Volumes/other/knowledge/bugrelay-ai-bug-归属分析方案.md`（架构/协议/采集清单已定，不重复）。
> 本文只回答一个问题：**bugrelay 怎么长在 tkt 这棵树上**。
> 日期：2026-07-28 ｜ 状态：待评审

## 0. 与原方案的关键偏差

原方案假设「零依赖 Node 手写 ws 服务 + vanilla 分析页」。落到 tkt 后这些假设全部改写——tkt 已有 hono 服务、React SPA、claude-agent-sdk，重复造一套反而是负资产：

| 原方案 | tkt 落地 | 理由 |
|---|---|---|
| 独立 `node server.js`，端口 9527 | tkt feature，`tkt bugrelay` 子命令，复用 hono 服务（**固定 9527**，占用报错不顺延） | adb reverse 要固定口；9527 偏门不撞车 |
| 手写 RFC6455 ws | `@hono/node-ws`（新增唯一依赖） | hono 官方 ws 适配，upgrade 由 node-server 统一接管 |
| vanilla 单页分析页 | `web/src/pages/bugrelay.tsx`，挂进现有 SPA shell | 复用路由/组件/构建，不引入第二套前端 |
| spawn `claude -p` + stdin prompt | claude-agent-sdk（**已拍板**，见 §4.0） | SDK 底层就是 spawn CLI，效果同源，控制面完胜 |
| 一次性大 prompt 塞全量快照 | **agentic 多轮拉取**：快照摘要进 prompt，明细走 SDK MCP tools | token 省一个量级，直接实现原方案 §8 的「MCP 化」增强 |
| 配置文件 env | `~/.config/tkt/bugrelay/setting.json`（add_dirs、脱敏开关） | 符合 tkt 数据路径惯例 |

## 1. 命令与目录

```
tkt bugrelay                 # 启动服务（长驻，固定 9527），打印接入指引
tkt bugrelay ui              # 起服务 + 开浏览器 http://127.0.0.1:9527/bugrelay
tkt bugrelay doctor          # 自检：端口/claude 可用性/在线会话/adb 状态
tkt bugrelay snippet         # 输出注入 snippet（含当前局域网 IP），一键复制
```

复用 `createApp`：bugrelay 服务挂同款 SPA（`mountSpa`），测试直接开 `http://127.0.0.1:9527/bugrelay`，与 `tkt ui`（38471）互不干扰。

代码落位：

```
src/features/bugrelay/
  routes.ts        # hono mount：REST + ws upgrade（FeatureMount 协议）
  session.ts       # 会话 Map / ring buffer 服务端缓存 / 闲置清理
  analyze.ts       # 组 prompt + 调 agent backend + MCP tools 定义
  report.ts        # 结构化 bug 报告 markdown 生成
assets/bugrelay/
  collector.js     # 采集端（ES5 单文件，package files 已含 assets/）
web/src/pages/bugrelay/
  index.tsx        # 会话列表 + 提问 + 结果 + 报告
  panels.tsx       # 请求瀑布 / console 流 / mutation 轨迹核对面板
~/.config/tkt/bugrelay/setting.json   # add_dirs / 脱敏开关 / 端口偏好
```

`mountBugrelayRoutes` 加进 `src/server/index.ts` 的 `mounts` 数组，与其他 feature 同权。

## 2. ws 通道

- 依赖：加 `@hono/node-ws`（`createNodeWebSocket` 包住 `@hono/node-server` 的 server 实例，`app.get('/bugrelay/ws', upgradeWebSocket(...))`）。
- 协议原样搬附录 A（hello / event / result / command / ping-pong，命令白名单，**禁 eval**）。
- 端口：**固定 9527**（已拍板）。占用直接报错提示，不走 tkt 的自动顺延——`adb reverse tcp:9527 tcp:9527` 和 collector 默认地址都要求端口稳定。`BUGRELAY_PORT` env 可覆盖（iOS 局域网场景）。
- 注意：与 `tkt ui`（38471）是**两个独立端口**，bugrelay 服务不挂 SPA 之外的路由冲突。
- PNA / CORS：hono `cors()` 中间件仅挂 `/bugrelay/*` 前缀，OPTIONS 补 `Access-Control-Allow-Private-Network: true`。

## 3. collector.js（采集端）

逻辑同原方案 §3（S/A 级采集、ring buffer、混合上报、脱敏、自我排除），两处 tkt 化：

1. **默认服务地址不写死**：`?bugrelay_server=` > localStorage > `http://127.0.0.1:9527`。
2. **自带浮层（P0 完整面板，已拍板）**：可拖拽圆钮 + 半屏 panel，tab = 请求 / 日志 / 异常 / Vuex / 轨迹 / ws 状态 / 手动 snapshot 复制。价值：手机上确认「collector 活着、ws 连上、抓到 N 条」，测试现场不求 PC。纯 ES5 自绘，不引 eruda/vConsole（避免双份采集 + 看不到 ws 状态）。

注入方式（已在 cldd 项目确认）：**index.html snippet 白名单法**，vue-cli 与 vite 通用，不做构建插件。snippet 由 `tkt bugrelay snippet` 生成（自动填本机局域网 IP + 端口 9527），也可在分析页复制。

## 4. 分析链路

### 4.0 引擎选型：claude-agent-sdk（已拍板）

关键事实：**SDK 底层就是 spawn 本机 `claude` CLI 进程**（stdio JSON-RPC）。两者模型/推理效果完全同源，公司网关（`ANTHROPIC_BASE_URL` + key）env 继承、同样生效。差异只在控制面：

| | spawn `claude -p` | claude-agent-sdk |
|---|---|---|
| 结构化输出 | 剥 ` ```json ` 围栏，脆 | `outputFormat: json_schema` 原生 |
| 多轮工具调用 | 单次进出，做不到 | 进程内 MCP server ✅ |
| 流式进度 | 自解析 stream-json | SDK 消息流直给 |
| 用量统计 | 自算 | `recordUsage` 已接 |
| 依赖 | 零 | tkt 已装 |

SDK 无 trade-off 胜出。退路：`analyze.ts` 留薄抽象，SDK 撞网关怪问题时降级 `claude -p` 单轮（十行代码）。openai 后端不参与 bugrelay（工具链依赖 SDK MCP）。

### 4.1 agentic 多轮拉取（tkt 最大红利）

原方案是「analyze 时全量快照塞 prompt」。tkt 的 `src/agent/claude.ts` 已支持「自定义 tools → 进程内 MCP server」，直接升级成多轮：

```
POST /bugrelay/api/analyze {sessionId, question}     ← SSE 流（已拍板，不用 ws 复用）
  → ws 下发 get_snapshot（摘要级：请求 status/errcode/url/编号，不含 body）
  → 组 prompt（判定口径 + 摘要 + 测试描述）
  → claude-agent-sdk 启动，挂进程内 MCP tools:
      request_page_info(sessionId, type, filter?)  // 按需拉 body/vuex/轨迹，经 ws 命令通道
      read_source(glob|grep 参数)                   // --add-dir 源码定位
  → AI 多轮自助拉取 → 结构化输出（outputFormat: json_schema）
  → 归属 + 依据 + 建议 + file:line
```

- `add_dirs` 来源：`~/.config/tkt/bugrelay/setting.json` + `tkt bugrelay --add-dir <path>` 追加；映射到 sdk 的 cwd/allowedDirectories。
- 结构化输出直接走 sdk `outputFormat: json_schema`，丢掉原方案「剥 ```json 围栏」的脆弱逻辑。
- 进度推送：**SSE（`hono/streaming`）**，事件 = 拉取中 / 分析中 / 第 N 轮工具调用（工具名）/ 完成 / 失败。ws 通道保持 page↔server 单一职责不混用。
- 分析用时 30~120s，SSE 进度让页面 loading 态有反馈。

## 5. 分析页（web/ SPA）

`/bugrelay` 路由，布局复用 shell.tsx：

```
左栏：在线会话（hello 元信息 + 最后活跃 + 未读异常红点）
主区：提问框 → [AI 分析] → 结果卡（归属/置信/结论/依据/建议/路由/文件:行）
底部：数据核对面板（请求瀑布/console/mutation）+ [生成 bug 报告]
```

- 报告：POST `/bugrelay/api/report` 返回 markdown，clipboardy 复制 or 页面展示复制按钮。
- 数据面板与 AI 结论并排，测试可人工复核——原方案 §5 保留。

## 6. skill（tkt 哲学的标准分工）

按 readme 理念：**CLI 是执行器，skill 是说明书**。写 `~/.claude/skills/bugrelay-setup/SKILL.md`，内容即接入 SOP：

1. 确认 `tkt` 已装（`npm i @manshawar/tkt -g`），跑 `tkt bugrelay`
2. 检测目标项目构建工具：`vue.config.js` → `public/index.html`；`vite.config.*` → 根 `index.html`；snippet 贴 `<head>` 最前（`tkt bugrelay snippet` 取）
3. 连通按入口：PC 蓝信 webview 零配置 / Android `adb reverse tcp:9527 tcp:9527` / iOS 或无 USB 用 `?bugrelay_server=http://<IP>:9527`
4. `tkt bugrelay --add-dir <目标项目 src>` 挂源码
5. 验证：`tkt bugrelay doctor` + 手机端浮层显示已连接

skill 不含逻辑，全部动作落到 tkt 子命令——第二个项目接入就是 agent 照着 skill 敲 4 条命令。

## 7. 分期（在 tkt 内重排）

| 期 | 内容 | 验收 |
|---|---|---|
| P0 | routes + ws + session + collector（S 级 + 浮层）+ SPA 页 + analyze（MCP 多轮）+ 报告；cldd web/ Chrome 自验 | `/bugrelay` 出归属结论，报告可复制 |
| P1 | adb 真机链路 + mobile/ 注入 + A 级采集（Vuex/轨迹/桥）+ doctor 完善 | 手机操作 → PC 出结论 |
| P2 | skill 发布 + cldd 外第二项目接入演练 | 接入 ≤10 分钟 |
| P3 | 报告落库（POST 到业务后端） | 报告可链接分享 |

原方案 P2 的「collector 抽独立 npm 包」**取消**——collector 由 tkt 服务 host，任何项目 snippet 引入即吃最新版，没有抽包必要。

## 8. 风险（tkt 语境更新）

| 项 | 处置 |
|---|---|
| https→loopback（测试环境页面 → 127.0.0.1:38471） | 不变，PNA 头已备，P1 真机首验；退路 mkcert https |
| `@hono/node-ws` 与 SPA mount 共存 | upgrade 只匹配 `/bugrelay/ws` 路径，P0 第一个验证点 |
| 9527 被占用 | 启动直接报错并提示 `BUGRELAY_PORT` 覆盖；与 `tkt ui`（38471）互不干扰 |
| claude SDK 撞公司网关怪问题 | `analyze.ts` 薄抽象降级 `claude -p` 单轮，结论照出（无工具多轮） |
| 敏感数据 | 不变：dev 注入 + 白名单 + 脱敏；setting.json 加 `redactKeys` 自定义脱敏清单 |

## 9. 已拍板决策（2026-07-28）

1. **端口**：固定 9527，占用报错不顺延；`BUGRELAY_PORT` 可覆盖。
2. **通道**：页面↔server 走 ws（命令通道）；分析进度推送走 SSE（`hono/streaming`），不混用。
3. **P0 浮层**：完整面板（请求/日志/异常/Vuex/轨迹/ws 状态/snapshot），不砍三件套。
4. **AI 引擎**：claude-agent-sdk（底层同源 CLI，公司网关 env 继承生效），`claude -p` 仅作降级退路。
