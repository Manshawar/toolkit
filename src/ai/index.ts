/**
 * 本地 AI：Vercel AI SDK + OpenAI Compatible。
 * 支持 tools（如 deep_inspect_diff）多步后再出结构化结果。
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  generateText,
  Output,
  stepCountIs,
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
}

export interface AiClient {
  generateObject<SCHEMA extends z.ZodType>(
    opts: GenerateObjectOptions<SCHEMA>,
  ): Promise<z.infer<SCHEMA>>
  getModel(): Promise<LanguageModel>
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
    return { cfg, model: provider.chatModel(cfg.model) as LanguageModel }
  }

  return {
    async getModel() {
      return (await resolve()).model
    },

    async generateObject<SCHEMA extends z.ZodType>(
      opts: GenerateObjectOptions<SCHEMA>,
    ): Promise<z.infer<SCHEMA>> {
      const { schema, system, user, tools, maxSteps } = opts
      const { model } = await resolve()
      const steps = maxSteps ?? (tools && Object.keys(tools).length > 0 ? 6 : 1)

      const { output } = await generateText({
        model,
        output: Output.object({ schema }),
        instructions: system,
        messages: [{ role: 'user', content: user }],
        temperature: 0.2,
        ...(tools ? { tools, stopWhen: stepCountIs(steps) } : {}),
      })
      if (output == null) throw new Error('AI 未返回结构化结果')
      return output as z.infer<SCHEMA>
    },
  }
}
