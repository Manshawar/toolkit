# 设计理念

在 Claude Code / Cursor / Codex 等 coding agent 中，用 skill 承载「固定功能的 AI 工具」会带来两个问题：

1. **上下文浪费** — skill 的指令、示例、边界条件全部灌入上下文，还没干活先吃掉几千 token
2. **不稳定** — 同样的 prompt 跑两次可能有偏差，agent 的「自由度」对确定性操作用错了地方

正确分工：

| | skill | CLI |
|---|---|---|
| **角色** | 说明书 | 执行器 |
| **内容** | 流程规范、注意事项、反模式 | 确定性代码逻辑 |
| **加载** | 被 agent 读取后执行 | agent 一句 `tkt gc` 直接跑 |
| **适合** | 需要判断/决策的复杂流程 | 固定输入→固定输出的功能 |

**CLI 做重活，skill 做说明书，agent 做调度。** `tkt` 就是这套思路的实践——把常用 AI 功能（提交分析、日报生成、测速）打包成 CLI，agent 只需一句命令调用，零上下文损耗，结果确定。

## 实现概要

- **CLI**：commander；数据落 `~/.config/tkt/<cmd>/`
- **Agent**：`src/agent/`（Vercel AI SDK + Claude Agent SDK）；tool 步进用 `stopWhen`，工作流多轮用 `runLoop`
- **Feature**：`src/features/<name>/` 按阶段拆目录；跨模块 `@/*` → `src/*`
- **Prompt**：一律放 `prompts/`，经目录注册后 `loadPrompt(id)` 加载
- **UI**：单包 SPA（`web/` → `assets/ui/`），Hono 单端口静态 + SPA fallback；业务 API 按 feature mount

## 专题方案

- [bugrelay 落地方案](../bugrelay-落地方案.md)
