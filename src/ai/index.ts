/**
 * 本地 AI：Vercel AI SDK + OpenAI Compatible。
 * 支持 tools（如 deep_inspect_diff）多步后再出结构化结果。
 *
 * 解析失败处理：
 * - extractJsonMiddleware：剥 markdown 代码块
 * - NoObjectGeneratedError.text：本地抽 JSON 再 zod 校验
 * - 仍失败则整轮重试 1 次
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  extractJsonMiddleware,
  generateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  wrapLanguageModel,
  type LanguageModel,
  type ToolSet,
} from 'ai'
import type { z } from 'zod'
import { interceptAiConfig, type AiConfig } from './config'

export type { AiConfig } from './config'
export {
  interceptAiConfig,
  ensureAiConfig,
  reconfigureAiConfig,
  showAiConfig,
  aiEnvPath,
  resetAiConfigCache,
} from './config'

export interface GenerateObjectOptions<SCHEMA extends z.ZodType> {
  schema: SCHEMA
  system: string
  user: string
  /** AI SDK tools；模型可自行决定是否调用 */
  tools?: ToolSet
  /** 含 tool 调用的最大步数，默认有 tools 时 6、否则 1 */
  maxSteps?: number
  /** Output.object 名称（网关 JSON Schema） */
  name?: string
  description?: string
}

export interface AiClient {
  generateObject<SCHEMA extends z.ZodType>(
    opts: GenerateObjectOptions<SCHEMA>,
  ): Promise<z.infer<SCHEMA>>
  getModel(): Promise<LanguageModel>
}

/** 从模型原文里抠出可 JSON.parse 的对象文本 */
function extractJsonObject(text: string): string | null {
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

function formatNoObjectError(err: InstanceType<typeof NoObjectGeneratedError>): string {
  const cause =
    err.cause instanceof Error ? err.cause.message : err.cause != null ? String(err.cause) : ''
  const finish = err.finishReason ? ` finish=${err.finishReason}` : ''
  const snippet = err.text?.trim()
    ? `\n原文: ${err.text.trim().slice(0, 280)}${err.text.trim().length > 280 ? '…' : ''}`
    : ''
  return `AI 结构化输出解析失败${finish}${cause ? `: ${cause}` : ''}${snippet}`
}

export async function createAiClient(config?: AiConfig): Promise<AiClient> {
  async function resolve() {
    const cfg = config ?? (await interceptAiConfig())
    const provider = createOpenAICompatible({
      name: 'tkt',
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
      supportsStructuredOutputs: true,
    })
    // 兼容网关常把 JSON 包在 ```json 里；中间件先剥壳再交给 Output.object
    const model = wrapLanguageModel({
      model: provider.chatModel(cfg.model) as LanguageModel,
      middleware: extractJsonMiddleware(),
    })
    return { cfg, model }
  }

  return {
    async getModel() {
      return (await resolve()).model
    },

    async generateObject<SCHEMA extends z.ZodType>(
      opts: GenerateObjectOptions<SCHEMA>,
    ): Promise<z.infer<SCHEMA>> {
      const { schema, system, user, tools, maxSteps, name, description } = opts
      const { model } = await resolve()
      // structured output 本身占 1 step；留足 tool 轮次
      const steps = maxSteps ?? (tools && Object.keys(tools).length > 0 ? 8 : 1)

      const run = async () => {
        try {
          const { output } = await generateText({
            model,
            output: Output.object({
              schema,
              name: name ?? 'StructuredOutput',
              description: description ?? 'Structured JSON output',
            }),
            instructions: system,
            messages: [{ role: 'user', content: user }],
            temperature: 0.2,
            ...(tools ? { tools, stopWhen: stepCountIs(steps) } : {}),
          })
          if (output == null) throw new Error('AI 未返回结构化结果')
          return output as z.infer<SCHEMA>
        } catch (e) {
          // SDK 已抛：用原文做一次本地修复（剥 fence / 抽 {…}）再 zod 校验
          if (NoObjectGeneratedError.isInstance(e) && e.text) {
            const raw = extractJsonObject(e.text)
            if (raw) {
              const parsed = schema.safeParse(JSON.parse(raw))
              if (parsed.success) return parsed.data as z.infer<SCHEMA>
            }
          }
          throw e
        }
      }

      try {
        return await run()
      } catch (e) {
        if (!NoObjectGeneratedError.isInstance(e)) throw e
        // 整轮再试一次（网关偶发烂 JSON）
        try {
          return await run()
        } catch (e2) {
          if (NoObjectGeneratedError.isInstance(e2)) {
            throw new Error(formatNoObjectError(e2))
          }
          throw e2
        }
      }
    },
  }
}
