/** openai client / claude client 共用：用量记账 + 烂 JSON 本地兜底 */
import { appendAgentUsage } from '@/features/usage/agent'

/** LanguageModelUsage（ai）与 Claude SDK usage 的最小公共形状 */
export interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export function recordUsage(
  tool: string | undefined,
  model: string | undefined,
  usage: UsageLike | undefined,
): void {
  if (!tool || !usage) return
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return
  appendAgentUsage({ tool, model, inputTokens, outputTokens, totalTokens })
}

/** 从模型原文里抠出可 JSON.parse 的对象文本 */
export function extractJsonObject(text: string): string | null {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  t = t.slice(start, end + 1)
  try {
    JSON.parse(t)
    return t
  } catch {
    return null
  }
}
