/** 本地 AI：prompt + tools(add_repo) + generateObject → DailyPlan */
import { createAiClient } from '../../../ai'
import { loadTools } from '../../../tools'
import { withCatRun } from '../../../ui'
import { loadPrompt } from '../../prompts'
import { DailyPlanSchema, type DailyPlan, type GatherResult } from '../types'

export const DAILY_PROMPT_ID = 'report.daily' as const

function loadDailySystem(): string {
  return loadPrompt(DAILY_PROMPT_ID)
}

function buildDailyUser(input: {
  role: string
  categories: string[]
  targetHours: number
  gather: GatherResult
  append: string[]
}): string {
  return [
    '## Meta',
    `role: ${input.role}`,
    `categories: ${JSON.stringify(input.categories)}`,
    `targetHours: ${input.targetHours}`,
    `date: ${input.gather.date}`,
    `sessionHours: ${input.gather.sessionHours}`,
    `commitCount: ${input.gather.commitCount}`,
    '',
    '## Repos',
    JSON.stringify(
      input.gather.repos.map((r) => ({
        path: r.path,
        alias: r.alias,
        display_name: r.display_name,
        project: r.project,
        hours: r.hours,
        commits: r.commits,
      })),
      null,
      2,
    ),
    '',
    '## Append',
    input.append.length ? input.append.map((a) => `- ${a}`).join('\n') : '(none)',
  ].join('\n')
}

export async function generateDailyPlan(input: {
  role: string
  categories: string[]
  targetHours: number
  gather: GatherResult
  append: string[]
  dayStart?: string
  dayEnd?: string
  quiet?: boolean
}): Promise<DailyPlan> {
  return withCatRun(
    'report',
    async () => {
      const ai = await createAiClient()
      const model = await ai.getModel()
      const tools = loadTools('report.daily', {
        model,
        report: {
          date: input.gather.date,
          dayStart: input.dayStart,
          dayEnd: input.dayEnd,
          gather: input.gather,
        },
      })

      return ai.generateObject({
        schema: DailyPlanSchema,
        system: loadDailySystem(),
        user: buildDailyUser(input),
        name: 'DailyPlan',
        description: 'Daily report plan',
        tools,
        maxSteps: 6,
      })
    },
    { quiet: Boolean(input.quiet) },
  )
}
