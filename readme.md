# toolkit

个人 CLI，前缀 `tkt`。

## 双环

| 环 | 命令 | AI |
| --- | --- | --- |
| 本地 | `tkt gc` | Vercel AI SDK（`generateText` + `Output.object`） |
| Skill | `tkt agent git-submit prepare \| apply` | 宿主 Agent；CLI 只校验+执行 |

```bash
# 本地（启动时询问是否自动推送）
tkt gc

# 跳过询问
tkt gc --push      # 自动推送
tkt gc --no-push   # 只 commit 不推送

# AI 配置（空回车保留原值）
tkt config
tkt config --show

# Skill
tkt agent git-submit prepare
tkt prompt show git-submit.commit-plan
tkt agent git-submit apply --plan-file plan.json
```

## 其它

| 命令 | 功能 |
| --- | --- |
| `tkt config` / `--show` | 重配 / 查看 AI URL·Key·Model |
| `tkt grp` | Gerrit `HEAD:refs/for/<branch>` |
| `tkt sv [ver]` | fnm + `npm run serve` |
| `tkt usage` | Token 用量 |
| `tkt prompt list \| show` | 提取 prompt |

## 源码结构

```
src/
  index.ts              CLI 入口
  ai/                   Vercel AI SDK（本地环）
  lib/                  共享：env / git / cli 契约
  tools/                AI tools（按场景加载）
    git-submit/         commit-plan 等
  features/             功能区（一命令一目录）
    git-submit/         tkt gc + agent
    prompts/            prompt 加载与命令
    usage/              Token 用量
    grp/  sv/
prompts/                prompt 原文（随包发布）
```

## 环境变量

```bash
cp .env.example .env
```

`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（本地 `gc`）；`TKT_PROVIDER` / `MINIMAX_*`（usage）。

## 开发

```bash
pnpm install && pnpm build && pnpm link --global
```
