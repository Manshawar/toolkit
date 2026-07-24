/**
 * 本地 Agent 客户端：Vercel AI SDK + OpenAI Compatible。
 *
 * Tool 级 loop：SDK 自带 —— `generateText` + `stopWhen: stepCountIs(n)`
 * （等同 ToolLoopAgent 的步进停条件；结构化输出场景直接用 generateText 更合适）
 *
 * 工作流级 loop（如 gc 残留文件）：SDK 没有，见 `./loop.ts`
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
import {
  interceptAiConfig,
  isAiConfigError,
  recoverAiConfig,
  resetAiConfigCache,
  type AiConfig,
} from './config'

export type { AiConfig } from './config'
export {
  interceptAiConfig,
  ensureAiConfig,
  reconfigureAiConfig,
  showAiConfig,
  getAiConfigView,
  saveAiConfigFields,
  aiEnvPath,
  resetAiConfigCache,
  isAiConfigError,
  recoverAiConfig,
} from './config'

export interface GenerateObjectOptions<SCHEMA extends z.ZodType> {
  schema: SCHEMA
  system: string
  user: string
  /** AI SDK tools；模型可自行决定是否调用 */
  tools?: ToolSet
  /** 含 tool 调用的最大步数，默认有 tools 时 8、否则 1（SDK stopWhen） */
  maxSteps?: number
  /** Output.object 名称（网关 JSON Schema） */
  name?: string
  description?: string
}

export interface AgentClient {
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

/**
 * OpenAI Compatible baseURL：裸 host 补 `/v1`（与 Apifox `/v1/chat/completions` 对齐）。
 * 已带路径（如 `/v1`、`/openai`）则只去尾斜杠。
 */
export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  try {
    const u = new URL(trimmed)
    if (u.pathname === '/' || u.pathname === '') {
      u.pathname = '/v1'
      return u.toString().replace(/\/+$/, '')
    }
  } catch {
    /* ignore */
  }
  return trimmed
}

/**
 * 是否发 response_format=json_schema。
 * DeepSeek（经 litellm）会拒：`This response_format type is unavailable now`；
 * 关则回退 json_object + prompt schema（本客户端已有抽 JSON / zod）。
 * 可用 AI_STRUCTURED_OUTPUTS=true|false 强制覆盖。
 */
export function supportsStructuredOutputs(model: string): boolean {
  const env = process.env.AI_STRUCTURED_OUTPUTS?.trim().toLowerCase()
  if (env && ['0', 'false', 'no', 'off'].includes(env)) return false
  if (env && ['1', 'true', 'yes', 'on'].includes(env)) return true
  if (/deepseek/i.test(model)) return false
  return true
}

export async function createAgentClient(config?: AiConfig): Promise<AgentClient> {
  async function resolve(forcePrompt = false) {
    if (forcePrompt) resetAiConfigCache()
    const cfg = config ?? (await interceptAiConfig())
    const baseURL = normalizeOpenAiBaseUrl(cfg.baseUrl)
    const provider = createOpenAICompatible({
      name: 'tkt',
      baseURL,
      apiKey: cfg.apiKey,
      supportsStructuredOutputs: supportsStructuredOutputs(cfg.model),
    })
    // 兼容网关常把 JSON 包在 ```json 里；中间件先剥壳再交给 Output.object
    const model = wrapLanguageModel({
      model: provider.chatModel(cfg.model) as LanguageModel,
      middleware: extractJsonMiddleware(),
    })
    return { cfg: { ...cfg, baseUrl: baseURL }, model }
  }

  // 创建时就拦截配置（缺则先填），避免调用方已开「思考中」再弹表单
  await resolve()

  return {
    async getModel() {
      return (await resolve()).model
    },

    async generateObject<SCHEMA extends z.ZodType>(
      opts: GenerateObjectOptions<SCHEMA>,
    ): Promise<z.infer<SCHEMA>> {
      const { schema, system, user, tools, maxSteps, name, description } = opts
      // Tool loop：SDK stopWhen / stepCountIs（与 ToolLoopAgent 同机制）
      const steps = maxSteps ?? (tools && Object.keys(tools).length > 0 ? 8 : 1)

      const run = async (model: LanguageModel) => {
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

      const attempt = async (forcePrompt = false) => {
        const { model } = await resolve(forcePrompt)
        try {
          return await run(model)
        } catch (e) {
          if (!NoObjectGeneratedError.isInstance(e)) throw e
          // 整轮再试一次（网关偶发烂 JSON）
          try {
            return await run(model)
          } catch (e2) {
            if (NoObjectGeneratedError.isInstance(e2)) {
              throw new Error(formatNoObjectError(e2))
            }
            throw e2
          }
        }
      }

      try {
        return await attempt(false)
      } catch (e) {
        // 缺 key / 鉴权失败：跳去填写再试一次（外部传入 config 时不抢）
        if (!config && isAiConfigError(e)) {
          await recoverAiConfig(e)
          return attempt(true)
        }
        throw e
      }
    },
  }
}
