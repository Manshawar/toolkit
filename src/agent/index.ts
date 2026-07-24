/**
 * 本地 Agent 层（原 `src/ai`）
 *
 * - client：Vercel AI SDK（tool loop = `stopWhen` / stepCountIs）
 * - config：URL / Key / Model 拦截
 * - loop：通用工作流重试原语（领域 loop 放各 feature，如 git-submit/agent-loop）
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

export { agentLoop } from './loop'
