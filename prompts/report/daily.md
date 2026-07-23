# report.daily

Agent 驱动 `tkt report` 写日报。先 `tkt prompt show report.daily`，再只跑下方 CLI。

## 分工

| 谁 | 做什么 |
| --- | --- |
| `tkt report *` | 配置、采集 commit、校验格式、归档、剪贴板 |
| 你 | 问缺失配置、改写 commit→分点、写 sheetTime、聊天贴 emit 原文 |

禁止：手写 git log、自建归档、绕过 `emit` 直接当交付。

## 命令契约

### `tkt report init`

- 出：JSON（`role` / `auto_copy` / `use_git` / `categories` / `repositories` / 工时窗）
- 你：字段已有 → 不问；`role` 或 `auto_copy` 为空 → 问一次后  
  `tkt report init --role <角色>` / `--auto-copy true|false`

### `tkt report gather [--date] [--user-repo]* [--day-start] [--day-end]`

- 出：JSON（`date` / `repos[].project|display_name|items[]|total_hours` / `totals`）
- `use_git=false` → 跳过，条目靠用户口述
- `display_name` 空 → 你译中文后：  
  `tkt report set-display-name --path <repo> --name "<中文>"`

### 你写正文（不进 CLI 直到 emit）

- 素材 = gather 的 commits（可推导主动配套工作，禁止无依据编造）
- 总时长 ≥ `max(8, totals.hours)`，只能多不能少
- 单条 0.5–4h（.5 步长）；缺口只补主动型（联调/提测/review/排查/文档…，用 init 的 `categories`）
- 禁止自动补：晨会/周会/整理清单/跟进 bug

commit 改写：去 `feat:`/`fix:` 等前缀 → 中文标点、动词开头 → 业务表述。

分点：

```
1. 【项目名】动作对象、补充。- 1.5小时
2. 【项目名】……。- 1小时
```

sheetTime 正文（无 `sheetTime:` 前缀）：单行 ≤80 字；无【】、无「小时」、无换行；`；` 连接。

### `tkt report emit --daily "…" --sheet-time "…" [--date] [--no-clipboard]`

- 出：stdout = `sheetTime:` 行 + 空行 + 分点（校验失败 exit≠0）
- 你：聊天**原样**贴这段 stdout；不要改成无工时摘要

辅助：`tkt report save-repo --cwd` / `list-repos` / `clipboard`

数据目录：`~/.config/tkt/report/`

## 交付自检

- emit 成功；聊天含 sheetTime + 每条 `- X小时`
- 无编造、无被动型自动条
