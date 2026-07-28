/**
 * 本地 Agent 层
 *
 * - backend：Claude Code / OpenAI Compatible 解析与提示（TKT_AI_BACKEND）
 * - client：默认入口 createAgentClient + Vercel AI SDK（tool loop = `stopWhen` / stepCountIs）
 * - claude：Claude Code backend（Agent SDK spawn 本机 claude CLI）
 * - config：URL / Key / Model 拦截
 * - loop：通用 `runLoop`（CLI / feature 工作流「再跑直到完成」）
 */
export {
  resolveAiBackend,
  forcedAiBackend,
  persistedAiBackend,
  aiBackendSource,
  hasClaudeCli,
  hintAiBackend,
  resetAiBackendCache,
  type AiBackend,
  type AiBackendSource,
} from './backend'

export {
  createAgentClient,
  createOpenAiAgentClient,
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
  saveAiBackend,
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
