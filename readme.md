# toolkit

个人 CLI，前缀 `tkt`。Agent 直接调 CLI。

## 常用

```bash
# AI 提交（首次询问自动推送，之后记住）
tkt gc
tkt gc --push
tkt gc --no-push

tkt config
tkt config --show

# 日报（Agent：init → gather → 写分点 → emit；流程见 prompt）
tkt prompt show report.daily
tkt report init
tkt report gather --date 2026-07-23
tkt report emit --daily "1. 【项目】…。- 1小时" --sheet-time "概括"

# 模型测速（流程见 prompt）
tkt prompt show bench.run
tkt bench
tkt ui   # http://127.0.0.1:8787/bench
```

## 其它

| 命令 | 功能 |
| --- | --- |
| `tkt config` / `--show` | 重配 / 查看 AI URL·Key·Model |
| `tkt report …` | 日报脚手架（init/gather/emit/…） |
| `tkt bench` / `tkt ui` | 网关测速 / 本地页 |
| `tkt grp` | Gerrit `HEAD:refs/for/<branch>` |
| `tkt sv [ver]` | fnm + `npm run serve` |
| `tkt usage` | Token 用量 |
| `tkt prompt list \| show` | 提取 prompt |

数据目录：`~/.config/tkt/<命令>/`（如 `report/setting.json`、`bench/history/`）。

## 源码结构

```
src/
  index.ts              CLI 入口
  ai/                   Vercel AI SDK（gc）
  core/                 paths / env / git / cli
  server/               Hono 单端口 UI
  ui/                   CLI spinner
  tools/                AI tools
  features/
    git-submit/         tkt gc
    report/             tkt report
    bench/              tkt bench
    prompts/ usage/ grp/ sv/
assets/                 UI HTML
prompts/                prompt 原文
```

## 环境变量

```bash
cp .env.example .env
```

`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（`gc` / `bench`）；`TKT_PROVIDER` / `MINIMAX_*`（usage）。

## 开发

```bash
pnpm install && pnpm build && pnpm link --global
```
