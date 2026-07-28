/**
 * Claude Code backend：Agent SDK spawn 本机 `claude` CLI。
 *
 * - 复用 CLI 登录态 / settings（含第三方网关 ANTHROPIC_BASE_URL 等），用户零配置
 * - 结构化输出：`outputFormat: json_schema`，失败再本地剥壳 + zod（与 openai client 同策略）
 * - 自定义 tools（AI SDK ToolSet）→ 进程内 MCP server（createSdkMcpServer）
 * - 内置 tools 全关（tools: []），只留 tkt 自己的 MCP tools；headless 不弹权限（dontAsk）
 */
import type { ToolSet } from 'ai'
import type { SDKResultMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { extractJsonObject, recordUsage } from './shared'
import type { AgentClient, GenerateObjectOptions } from './client'

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')

let sdkPromise: Promise<Sdk> | null = null

/** SDK 较重，用到才加载（依赖 external，dynamic import 不进首屏） */
function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

interface AiToolLike {
  description?: string
  inputSchema?: unknown
  execute?: (args: unknown, options: unknown) => Promise<unknown>
}

/** AI SDK ToolSet → 进程内 MCP server（tool 名暴露为 mcp__tkt__<name>） */
function toMcpServer(sdk: Sdk, tools: ToolSet) {
  const defs = Object.entries(tools).map(([name, t]) => {
    const aiTool = t as unknown as AiToolLike
    const shape =
      aiTool.inputSchema instanceof z.ZodObject
        ? (aiTool.inputSchema.shape as z.ZodRawShape)
        : {}
    return sdk.tool(name, aiTool.description ?? '', shape, async (args) => {
      try {
        const out = await aiTool.execute?.(args, { toolCallId: name, messages: [] })
        return { content: [{ type: 'text' as const, text: JSON.stringify(out ?? null) }] }
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: e instanceof Error ? e.message : String(e) },
          ],
        }
      }
    })
  })
  return sdk.createSdkMcpServer({ name: 'tkt', version: '1.0.0', tools: defs })
}

/**
 * zod → CLI --json-schema。
 * zod v4 默认带 `$schema: draft 2020-12`，CLI 端 ajv 无此 meta 会报
 * `no schema with key or ref` —— 剥掉（内容本身是 draft-07 兼容子集）。
 */
function toCliJsonSchema(schema: z.ZodType, title?: string): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return title ? { ...rest, title } : rest
}

async function generateObject<SCHEMA extends z.ZodType>(
  opts: GenerateObjectOptions<SCHEMA>,
): Promise<z.infer<SCHEMA>> {
  const { schema, system, user, tools, maxSteps, name, usageTool } = opts
  const sdk = await loadSdk()
  const toolNames = tools ? Object.keys(tools) : []
  const steps = maxSteps ?? (toolNames.length ? 8 : 1)

  const q = sdk.query({
    prompt: user,
    options: {
      systemPrompt: system,
      // 关掉全部内置 tools，只留 tkt MCP tools —— 行为对齐纯 generateText
      tools: [],
      ...(toolNames.length
        ? {
            mcpServers: { tkt: toMcpServer(sdk, tools as ToolSet) },
            allowedTools: toolNames.map((n) => `mcp__tkt__${n}`),
          }
        : {}),
      outputFormat: {
        type: 'json_schema',
        schema: toCliJsonSchema(schema, name),
      },
      maxTurns: Math.max(2, steps + 1),
      permissionMode: 'dontAsk',
    },
  })

  let result: SDKResultMessage | undefined
  for await (const msg of q) {
    if (msg.type === 'result') result = msg
  }
  if (!result) throw new Error('Claude Code 未返回结果')
  if (result.subtype !== 'success') {
    const errs =
      'errors' in result && Array.isArray(result.errors)
        ? (result.errors as string[]).join('; ')
        : ''
    throw new Error(`Claude Code 执行失败（${result.subtype}）${errs ? `: ${errs}` : ''}`)
  }

  const ok = result as SDKResultSuccess
  const model = Object.keys(ok.modelUsage ?? {})[0] ?? 'claude'
  const u = ok.usage ?? {}
  recordUsage(usageTool, model, {
    inputTokens:
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  })

  // 优先 SDK 结构化结果；缺则本地剥壳兜底（老 CLI / 网关不支持 json_schema 时）
  let raw: unknown = ok.structured_output
  if (raw == null && ok.result) {
    const text = extractJsonObject(ok.result)
    if (text) {
      try {
        raw = JSON.parse(text)
      } catch {
        /* fallthrough */
      }
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const snippet = ok.result?.trim().slice(0, 280) ?? ''
    throw new Error(
      `Claude Code 结构化输出校验失败: ${parsed.error.message}${snippet ? `\n原文: ${snippet}` : ''}`,
    )
  }
  return parsed.data as z.infer<SCHEMA>
}

export function createClaudeAgentClient(): AgentClient {
  return {
    generateObject,
    // Claude backend 没有 AI SDK LanguageModel；tools ctx 的 model 本就无人使用
    async getModel() {
      return undefined
    },
  }
}
