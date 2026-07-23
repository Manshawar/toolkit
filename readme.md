# toolkit

个人 CLI，命令前缀 `tkt`。

| 命令 | 功能 |
| --- | --- |
| `tkt sv [nodeVersion]` | fnm 切 Node 后 `npm run serve`（默认 14） |
| `tkt grp` | Gerrit：`HEAD:refs/for/<branch>` |
| `tkt usage` | Token Plan 用量（默认 60s 刷新） |
| `tkt usage --once` | 只查一次 |
| `tkt usage -i 30` | 自定义刷新间隔（秒） |

## 依赖

- [fnm](https://github.com/Schniz/fnm)（`tkt sv`）
- `tkt grp` 需要当前目录是 git 仓库，且 remote 指向 Gerrit

## 环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 |
| --- | --- |
| `TKT_PROVIDER` | 用量平台，默认 `minimax`（兼容旧名 `ST_PROVIDER`） |
| `MINIMAX_API_KEY` | MiniMax Subscription Key |
| `MINIMAX_API_BASE` | 可选，默认 `https://www.minimaxi.com` |

## 开发

```bash
pnpm install
pnpm build
pnpm link --global   # 全局可用 tkt
```
