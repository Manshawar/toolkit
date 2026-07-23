# Prompt

本仓：**CLI + prompts**。Skill 另仓，只调 `tkt agent` / `tkt prompt`。

| 环 | 入口 |
| --- | --- |
| 本地 | `tkt gc` |
| Skill | `tkt agent git-submit prepare` → `apply --plan-file` |

新增能力：加 `prompts/<x>.md` → `PROMPT_CATALOG`（`src/features/prompts`）→ `features/git-submit` 注册。
