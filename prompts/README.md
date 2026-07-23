# Prompt

本地 AI / 结构化输出文案。改文案只动这里。

```bash
tkt prompt list
tkt prompt show report.daily
tkt prompt show git-submit.commit-plan
```

| id | 文件 | 消费方 |
| --- | --- | --- |
| `report.daily` | `report/daily.md` | `tkt report`（AI SDK） |
| `git-submit.commit-plan` | `git-submit/commit-plan.md` | `tkt gc` |
| `git-submit.deep-inspect-diff` | `git-submit/deep-inspect-diff.tool.json` | `tkt gc` tool |

纯 UI 工具（如 bench）不配 prompt。新增：`prompts/<area>/<name>.md` → `PROMPT_CATALOG`。
