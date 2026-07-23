# Prompt

Agent / 本地 AI 的提示词统一放这里；**CLI 路线**：先 `tkt prompt show <id>`，再只调 `tkt …`，不再走 Skill 脚本壳。

```bash
tkt prompt list
tkt prompt show report.daily
tkt prompt show bench.run
tkt prompt show git-submit.commit-plan
```

| id | 文件 | 谁消费 |
| --- | --- | --- |
| `report.daily` | `report/daily.md` | Agent + `tkt report` |
| `bench.run` | `bench/run.md` | Agent + `tkt bench` / `tkt ui` |
| `git-submit.commit-plan` | `git-submit/commit-plan.md` | `tkt gc`（AI SDK） |
| `git-submit.deep-inspect-diff` | `git-submit/deep-inspect-diff.tool.json` | `tkt gc` tool |

写法约定：

1. 开头写清 **分工表**（CLI vs 你）  
2. 用 **命令契约**（入参 → stdout → 下一步），不要 Skill Progress 清单腔  
3. 禁止出现 `node scripts/…`、旧 skill 路径、双包 env 名（如已迁到 `tkt config` 的）  
4. 新能力：`prompts/<area>/<name>.md` → `PROMPT_CATALOG` → 本表；**迁工具 = CLI + prompt 一起交**
