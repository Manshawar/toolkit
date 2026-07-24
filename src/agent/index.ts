/**
 * 本地 Agent 层
 *
 * - client：Vercel AI SDK（tool loop = `stopWhen` / stepCountIs）
 * - config：URL / Key / Model 拦截
 * - loop：通用 `runLoop`（CLI / feature 工作流「再跑直到完成」）
 */
export {
  createAgentClient,
  normalizeOpenAiBaseUrl,
  supportsStructuredOutputs,
  type AgentClient,
  type AiConfig,
  type GenerateObjectOptions,
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
} from './client'

export {
  runLoop,
  DEFAULT_LOOP_MAX,
  type RunLoopOptions,
  type LoopErrorAction,
} from './loop'
