/** AI 阶段：猜中文名 + 生成日报计划。配置拦截仅在 createAiClient（动画外）。 */
export {
  defaultDisplayName,
  fillMissingDisplayNames,
  localGuessZh,
  needsChineseName,
  projectLabel,
  remoteSlug,
} from './guess-name'
export { generateDailyPlan, DAILY_PROMPT_ID } from './plan'
