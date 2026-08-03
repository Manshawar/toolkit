# toolkit

个人 CLI 工具集，前缀 `tkt`，覆盖 AI 提交、日报、测速等日常高频操作。设计思路见 [docs/design.md](docs/design.md)。

## 安装

```bash
npm i @manshawar/tkt -g
```

发布在 npm public registry，全局安装后即可使用 `tkt` 命令。

## 配置

首次使用 AI 功能（`tkt gc` / `tkt report` 等）时，会自动弹出交互式配置。也可手动配置：

```bash
tkt config              # 交互填写 AI 后端与网关配置
tkt config --show       # 查看当前配置（Key 脱敏）
tkt config --backend claude      # 切换后端（claude | openai | auto）
tkt config --backend openai      # 强制自有 OpenAI Compatible 配置
tkt config ui           # 打开 AI 配置 UI（/setting）
```

### AI 后端

支持两种 AI 后端，优先级：`TKT_AI_BACKEND` 环境变量 > 持久化 `AI_BACKEND` > auto 自动探测。

| 后端 | 说明 |
| --- | --- |
| **Claude Code** | 复用本机 `claude` CLI 登录态与网关配置，零配置即可用 |
| **OpenAI Compatible** | 自有网关：需填写 Base URL / API Key / Model |
| **auto**（推荐） | 有 claude CLI 用 Claude Code，否则回退自有配置 |

auto 模式下 Claude Code 调用失败时，自动回退到自有 OpenAI Compatible 配置，进程内粘滞。

配置写入 `~/.config/tkt/ai/.env`，一次配置全局生效。也可用 `tkt config ui` →「设置」在浏览器中管理。

### Token Plan

用量页支持多 provider 配额查询，UI（`/token-plan`）可切换并「设为默认」。

| provider | 配置 | 说明 |
| --- | --- | --- |
| `minimax` | `MINIMAX_API_KEY`（可选 `MINIMAX_API_BASE`） | MiniMax Token Plan · 默认 `https://www.minimaxi.com` |
| `kimi` | `KIMI_API_KEY`（可选 `KIMI_API_BASE`） | Kimi Code 套餐 · key 形如 `sk-kimi-...`，[kimi.com/code](https://www.kimi.com/code/) 控制台创建 · 默认 `https://api.kimi.com` |

默认 provider：`TKT_PROVIDER` 环境变量 > `~/.config/tkt/usage/prefs.json` 持久化 > `minimax`。
Key 也可在 `/token-plan` 页面直接填写，存 `~/.config/tkt/usage/.env`（读取时覆盖包内 `.env`），保存后自动刷新，无需重启。

### 数据路径一览

| 数据 | 路径 |
| --- | --- |
| 全局 AI | `~/.config/tkt/ai/.env` |
| 更新检查偏好 | `~/.config/tkt/update/prefs.json`（默认 3 小时） |
| 日报偏好 / 名单 | `~/.config/tkt/report/setting.json` |
| 日报归档 | `~/.config/tkt/report/history/YYYY-MM-DD.json` |
| Bench 网关 | `~/.config/tkt/bench/gateway.json` |
| Usage 偏好 | `~/.config/tkt/usage/prefs.json`（默认 provider） |
| Usage API Key | `~/.config/tkt/usage/.env`（provider key） |
| Agent 用量日志 | `~/.config/tkt/usage/agent.jsonl` |

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
tkt report --roster                          # 启动时先打开快捷键区
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
tkt ui                    # → / 导航页（:38471）
tkt report ui             # → /report
tkt usage ui              # → /usage
tkt bench ui              # → /bench
tkt config ui             # → /setting
tkt ui --path /report/generate
tkt ui --port 3000        # 强制指定端口
tkt ui --no-open          # 只起服务不弹浏览器
tkt ui --no-spa           # 仅 API：不挂载 SPA（前端由 Vite 接管）
```

| 命令 | 路由 |
| --- | --- |
| `tkt ui` | `/` |
| `tkt report ui` | `/report` |
| `tkt usage ui` | `/usage` |
| `tkt bench ui` | `/bench` |
| `tkt config ui` | `/setting` |

子页（浏览器内）：`/token-plan`（Token Plan 配额）、`/report/generate`、`/report/history`、`/report/roster`、`/report/prefs` 等。

API 前缀：`/api/report/*`、`/api/usage/*`、`/api/bench/*`、`/api/setting/*`。

### `tkt usage` — Token 用量

实时查询 AI 平台 Token Plan 配额。

```bash
tkt usage                 # 实时刷新（60s）
tkt usage --once          # 查一次
tkt usage -i 30           # 30 秒刷新
tkt usage -p minimax      # 指定 provider（minimax | kimi）
tkt usage -p kimi         # Kimi Code 套餐
tkt usage ui              # → /usage（本地 Agent 用量 + Token Plan 双面板）
```

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
| `AI_BASE_URL` | AI 网关地址（OpenAI Compatible） |
| `AI_API_KEY` | API Key |
| `AI_MODEL` | 模型名 |
| `AI_STRUCTURED_OUTPUTS` | 强制开/关 json_schema（`true` / `false`） |
| `TKT_AI_BACKEND` | 强制 AI 后端（`claude` / `openai`；缺省 auto 探测） |
| `TKT_PROVIDER` | usage 默认 provider（`minimax` / `kimi`；缺省持久化 → `minimax`） |
| `MINIMAX_API_KEY` | MiniMax Token Plan API Key |
| `MINIMAX_API_BASE` | MiniMax API 地址（默认 `https://www.minimaxi.com`） |
| `KIMI_API_KEY` | Kimi Code API Key（`sk-kimi-...`） |
| `KIMI_API_BASE` | Kimi API 地址（默认 `https://api.kimi.com`） |
| `TKT_NO_UPDATE` | 设为 `1` 关闭启动时的版本更新提示 |
| `TKT_GC_PUSH` | git-submit 默认推送开关（`true` / `false`） |

## 开发与打包

```bash
pnpm ui:dev          # Vite :5173 + Hono :38471（/api 代理），本地联调
pnpm ui:serve        # 仅 API（tsx watch）
pnpm web:dev         # 仅 Vite
pnpm web:build       # → assets/ui/
pnpm build           # → lib/
pnpm build:all       # web:build 再 build（发布前）
```

实现架构见 [docs/design.md](docs/design.md)。
