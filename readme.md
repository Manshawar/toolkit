# toolkit

个人 CLI，前缀 `tkt`。需要推理的能力走本地 AI SDK（`gc` / `report`）。

## 常用

```bash
# AI 提交（首次询问自动推送，之后记住）
tkt gc
tkt gc --push
tkt gc --no-push

tkt config
tkt config --show

# 日报（本地 AI，同 gc）
tkt report
tkt report --yesterday --append "联调支付回调=1小时"
tkt report --dry-run

# 模型测速（页面配 gateway.json）
tkt ui
tkt bench
```

## 其它

| 命令 | 功能 |
| --- | --- |
| `tkt config` / `--show` | 重配 / 查看 AI URL·Key·Model |
| `tkt report` | 本地 AI 日报（gather → 生成 → 归档） |
| `tkt bench` / `tkt ui` | 网关测速 / 本地页（页面配 URL/Key） |
| `tkt grp` | Gerrit `HEAD:refs/for/<branch>` |
| `tkt sv [ver]` | fnm + `npm run serve` |
| `tkt usage` | Token 用量 |
| `tkt prompt list \| show` | 提取 prompt |

数据目录：`~/.config/tkt/<命令>/`（如 `report/history/YYYY-MM-DD.json`、`bench/gateway.json`）。

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
      prefs/ collect/ ai/ git/
    report/             tkt report
      config/ gather/ ai/ deliver/
    bench/              tkt bench
    prompts/ usage/ grp/ sv/
assets/                 UI HTML
prompts/                prompt 原文
```

## 环境变量

```bash
cp .env.example .env
```

`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`（`tkt gc`）；`tkt bench` 用页面/`gateway.json`；`TKT_PROVIDER` / `MINIMAX_*`（usage）。

## 开发

```bash
pnpm install && pnpm build && pnpm link --global
```
