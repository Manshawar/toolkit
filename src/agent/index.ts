/**
 * 本地 Agent 层（原 `src/ai`）
 *
 * - client：Vercel AI SDK（tool loop = `stopWhen` / stepCountIs）
 * - config：URL / Key / Model 拦截
 * - loop：工作流级重试（SDK 无此能力，自写）
 */
export {
  createAgentClient,
  createAiClient,
  normalizeOpenAiBaseUrl,
  supportsStructuredOutputs,
  type AgentClient,
  type AiClient,
  type AiConfig,
  type GenerateObjectOptions,
  interceptAiConfig,
  ensureAiConfig,
  reconfigureAiConfig,
  showAiConfig,
  aiEnvPath,
  resetAiConfigCache,
  isAiConfigError,
  recoverAiConfig,
} from './client'

export {
  agentLoop,
  runAgentGc,
  AGENT_MAX_ROUNDS,
  type AgentGcOptions,
} from './loop'
