/**
 * CLI ↔ Skill 机器可读契约（zod）。
 * 所有 JSON stdout 先过 schema，再打印。
 */
import { z } from 'zod'

export const AgentEnvelopeSchema = z.object({
  ok: z.literal(true),
  mode: z.literal('agent'),
  task: z.string().min(1),
  promptId: z.string().min(1),
  promptCommand: z.string().min(1),
  json: z.boolean(),
  context: z.unknown().nullable(),
  instruction: z.string().min(1),
  next: z.string().optional(),
})
export type AgentEnvelope = z.infer<typeof AgentEnvelopeSchema>
export type AgentEnvelopeInput = z.input<typeof AgentEnvelopeSchema>

export const CliErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string().min(1),
  message: z.string().min(1),
})
export type CliError = z.infer<typeof CliErrorSchema>

export const PromptListSchema = z.object({
  ok: z.literal(true),
  prompts: z.array(z.object({ id: z.string(), file: z.string() })),
})

export const PromptShowSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  path: z.string(),
  text: z.string(),
})

export const GitSubmitResultSchema = z.object({
  ok: z.literal(true),
  commits: z.array(z.object({ hash: z.string(), message: z.string() })),
  pushed: z.boolean(),
  gerrit: z.boolean().optional(),
})

export const AgentListSchema = z.object({
  ok: z.literal(true),
  agents: z.array(z.object({ name: z.string(), description: z.string() })),
})

/** 安全解析；失败时抛带路径的可读错误 */
export function parseWithSchema<T>(schema: z.ZodType<T>, raw: unknown, label = 'JSON'): T {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const detail = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`${label} 不符合 schema: ${detail}`)
  }
  return r.data
}
