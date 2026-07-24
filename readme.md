# toolkit

个人 CLI 工具集，前缀 `tkt`，覆盖 AI 提交、日报、测速等日常高频操作。

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

配置写入 `~/.config/tkt/ai.json`，一次配置全局生效。

## 命令

### `tkt gc` — AI 提交

分析 staged + unstaged diff，自动生成 Conventional Commits 并提交。

```bash
tkt gc                  # pull → 分析 diff → 生成 plan → commit
tkt gc --push           # 自动 push（偏好会被记住）
tkt gc --no-push        # 关闭自动 push
tkt gc --no-pull        # 跳过 pull
tkt gc --dry-run        # 只预览 commit plan，不执行
tkt gc --json           # JSON 输出
```

### `tkt report` — AI 日报

按日期采集各仓库 commit，交互追加杂项，AI 生成日报并复制到剪贴板。

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

### `tkt bench` — 网关测速

流式测速，输出 TTFT（首 token 时间）和 Total 耗时。

```bash
tkt bench                                   # 测 gateway.json 中所有模型
tkt bench --models gpt-4,claude --rounds 3  # 指定模型，测 3 轮取均值
tkt bench --sort ttft                       # 按首 token 时间排序
tkt bench -c 4                              # 最大并发 4
tkt bench --json                            # JSON 输出
tkt bench ui                                # 打开本地 UI 测速页
```

### `tkt ui` — 本地工具页

启动本地 Web 页面，可视化配置网关和跑测速。

```bash
tkt ui                # → http://127.0.0.1:8787/bench
tkt ui --port 3000    # 指定端口
```

### `tkt usage` — Token 用量

实时监控 AI 平台 Token 消耗。

```bash
tkt usage                 # 实时刷新（60s）
tkt usage --once          # 查一次
tkt usage -i 30           # 30 秒刷新
tkt usage -p minimax      # 指定 provider
```

### 其他

| 命令 | 说明 |
| --- | --- |
| `tkt grp` | `git push origin HEAD:refs/for/<branch>`，Gerrit 一键推送 |
| `tkt sv [ver]` | fnm 切 Node 版本后 `npm run serve`，默认 v14 |
| `tkt prompt list` | 列出内置 AI prompt |
| `tkt prompt show <id>` | 查看 prompt 原文 |

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `AI_BASE_URL` | AI 网关地址 |
| `AI_API_KEY` | API Key |
| `AI_MODEL` | 模型名 |
| `AI_STRUCTURED_OUTPUTS` | 强制开/关 json_schema（`true`/`false`） |
| `TKT_PROVIDER` | usage 的 provider（默认 minimax） |

## 实现概要

基于 Vercel AI SDK + OpenAI Compatible 协议，commander 注册命令，Zod 做结构化输出校验，数据落 `~/.config/tkt/<cmd>/`。`gc` 采集 diff 送 AI 出 CommitPlan 后逐条 commit；`report` 按日期+作者 git log 采集后送 AI 生成日报并归档剪贴板；`bench` 网关流式测速配本地 Hono UI。源码 `src/features/` 下一命令一目录，`src/ai/` 统一封装 AI 调用与 JSON 容错。
