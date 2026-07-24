# toolkit

个人 CLI 工具集，前缀 `tkt`，覆盖 AI 提交、日报、测速等日常高频操作。

## 设计理念

在 Claude Code / Cursor / Codex 等 coding agent 中，用 skill 承载「固定功能的 AI 工具」会带来两个问题：

1. **上下文浪费** — skill 的指令、示例、边界条件全部灌入上下文，还没干活先吃掉几千 token
2. **不稳定** — 同样的 prompt 跑两次可能有偏差，agent 的「自由度」对确定性操作用错了地方

正确分工：

| | skill | CLI |
|---|---|---|
| **角色** | 说明书 | 执行器 |
| **内容** | 流程规范、注意事项、反模式 | 确定性代码逻辑 |
| **加载** | 被 agent 读取后执行 | agent 一句 `tkt gc` 直接跑 |
| **适合** | 需要判断/决策的复杂流程 | 固定输入→固定输出的功能 |

**CLI 做重活，skill 做说明书，agent 做调度。** `tkt` 就是这套思路的实践——把常用 AI 功能（提交分析、日报生成、测速）打包成 CLI，agent 只需一句命令调用，零上下文损耗，结果确定。

## 安装

```bash
npm i @manshawar/tkt -g
```

发布在 npm public registry，全局安装后即可使用 `tkt` 命令。

## 配置

```bash
cp .env.example .env   # 填写 AI_BASE_URL / AI_API_KEY / AI_MODEL
```

或交互式配置：

```bash
tkt config              # 交互填写 AI 地址、Key、模型
tkt config --show       # 查看当前配置（Key 脱敏）
```

配置写入 `~/.config/tkt/ai/.env`，一次配置全局生效（也可用 `tkt ui` →「设置」）。

| 数据 | 路径 |
| --- | --- |
| 全局 AI | `~/.config/tkt/ai/.env` |
| 更新检查间隔 | `~/.config/tkt/update/prefs.json`（默认 3 小时） |
| 日报偏好 / 名单 | `~/.config/tkt/report/setting.json` |
| 日报归档 | `~/.config/tkt/report/history/YYYY-MM-DD.json` |
| Bench 网关 | `~/.config/tkt/bench/gateway.json` |

## 命令

### `tkt gc` — AI 提交

分析 staged + unstaged diff，自动生成 Conventional Commits 并提交。

```bash
tkt gc                  # pull → 分析 diff → 生成 plan → commit（残留自动多轮补提，最多 5 轮）
tkt gc --push           # 自动 push（偏好会被记住）
tkt gc --no-push        # 关闭自动 push
tkt gc --no-pull        # 跳过 pull
tkt gc --dry-run        # 只预览 commit plan，不执行
tkt gc --json           # JSON 输出
```

失败 / 残留补跑：`tkt agent gc`。

### `tkt report` — AI 日报

按日期采集名单内仓库 commit，交互追加杂项，AI 生成日报并复制到剪贴板。

```bash
tkt report                                   # 今日日报（交互勾选仓库）
tkt report --yesterday                       # 昨日日报
tkt report --date 2026-07-22                 # 指定日期
tkt report --role 前端                        # 预设角色
tkt report --append "联调支付回调=1h"          # 手动追加条目（可多次）
tkt report --target-hours 10                 # 目标工时下限
tkt report --day-start 09:00 --day-end 18:00 # 自定义上下班时间
tkt report --dry-run                         # 只生成，不归档
tkt report --no-clipboard                    # 不复制到剪贴板
tkt report --json                            # JSON 输出
```

也可用 UI：`tkt report ui` → `/report`（生成页在 `/report/generate`）。

### `tkt bench` — 网关测速

流式测速，输出 TTFT（首 token 时间）和 Total 耗时。

```bash
tkt bench                                   # 测 gateway.json 中所有模型
tkt bench --models gpt-4,claude --rounds 3  # 指定模型，测 3 轮取均值
tkt bench --sort ttft                       # 按首 token 时间排序
tkt bench -c 4                              # 最大并发 4
tkt bench --json                            # JSON 输出
tkt bench ui                                # → /bench
```

### `tkt ui` — 本地工具台（SPA）

单端口 Hono 托管 `assets/ui`。默认端口 **38471**（偏门，降低冲突）；占用时自动顺延。有 UI 的命令统一用 **`tkt <cmd> ui`**：

```bash
tkt ui                   # → / 导航页（:38471）
tkt report ui            # → /report
tkt usage ui             # → /usage
tkt bench ui             # → /bench
tkt config ui            # → /setting
tkt ui --path /report/generate
tkt report ui --no-open  # 只起服务不弹浏览器
tkt ui --port 3000       # 强制指定端口
```

| 命令 | 路由 |
| --- | --- |
| `tkt ui` | `/` |
| `tkt report ui` | `/report` |
| `tkt usage ui` | `/usage` |
| `tkt bench ui` | `/bench` |
| `tkt config ui` | `/setting` |

子页（浏览器内）：`/report/generate`、`/report/history`、`/report/roster`、`/report/prefs` 等。

API 前缀：`/api/report/*`、`/api/usage/*`、`/api/bench/*`、`/api/setting/*`。

### 开发与打包

```bash
pnpm ui:dev          # Vite :5173 + Hono :38471（/api 代理），本地联调
pnpm ui:serve        # 仅 API（tsx watch）
pnpm web:dev         # 仅 Vite
pnpm web:build       # → assets/ui/
pnpm build           # → lib/
pnpm build:all       # web:build 再 build（发布前）
```

### `tkt usage` — Token 用量

实时监控 AI 平台 Token 消耗。

```bash
tkt usage                 # 实时刷新（60s）
tkt usage --once          # 查一次
tkt usage -i 30           # 30 秒刷新
tkt usage -p minimax      # 指定 provider
tkt usage ui              # → /usage
```

需配置 `MINIMAX_API_KEY`（可选 `MINIMAX_API_BASE`）。

### 其他

| 命令 | 说明 |
| --- | --- |
| `tkt grp` | `git push origin HEAD:refs/for/<branch>`，Gerrit 一键推送 |
| `tkt sv [ver]` | fnm 切 Node 版本后 `npm run serve`，默认 v14 |
| `tkt prompt list` | 列出内置 AI prompt |
| `tkt prompt show <id>` | 查看 prompt 原文 |
| `tkt agent gc` | git-submit 残留 / 失败重试 |

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AI_BASE_URL` | AI 网关地址 |
| `AI_API_KEY` | API Key |
| `AI_MODEL` | 模型名 |
| `AI_STRUCTURED_OUTPUTS` | 强制开/关 json_schema（`true`/`false`） |
| `TKT_PROVIDER` | usage 的 provider（默认 minimax） |

## 实现概要

- **CLI**：commander；数据落 `~/.config/tkt/<cmd>/`
- **Agent**：`src/agent/`（Vercel AI SDK + OpenAI Compatible）；tool 步进用 `stopWhen`，工作流多轮用 `runLoop`
- **Feature**：`src/features/<name>/` 按阶段拆目录；跨模块 `@/*` → `src/*`
- **Prompt**：一律放 `prompts/`，经目录注册后 `loadPrompt(id)` 加载
- **UI**：单包 SPA（`web/` → `assets/ui/`），Hono 单端口静态 + SPA fallback；业务 API 按 feature mount
