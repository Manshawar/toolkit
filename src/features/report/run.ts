/** 本地编排：prefs → gather → AI → deliver */
import chalk from 'chalk'
import * as path from 'path'
import { generateDailyPlan } from './ai'
import { ensurePrefs, loadSetting, writeSetting } from './config'
import {
  assertPlan,
  buildRecord,
  deliver,
  formatDaily,
  halfHour,
  normalizeSheetTime,
} from './deliver'
import { gatherToday } from './gather'
import type { ReportOptions } from './types'

function applyDisplayNames(pairs: Array<{ path: string; name: string }>): void {
  if (!pairs.length) return
  const setting = loadSetting()
  let dirty = false
  for (const { path: p, name } of pairs) {
    const abs = path.resolve(p)
    const n = name.trim()
    if (!n) continue
    const i = setting.repositories.findIndex((r) => r.path === abs)
    if (i < 0 || setting.repositories[i]!.display_name) continue
    setting.repositories[i]!.display_name = n
    dirty = true
    console.error(`✅ ${setting.repositories[i]!.alias} → ${n}`)
  }
  if (dirty) writeSetting(setting)
}

export async function runReport(options: ReportOptions = {}): Promise<void> {
  const prefs = await ensurePrefs({ role: options.role })
  const date = options.date || new Date().toISOString().slice(0, 10)

  const gather = prefs.useGit
    ? gatherToday({
        date,
        dayStart: options.dayStart,
        dayEnd: options.dayEnd,
        userRepos: options.userRepos,
      })
    : { date, repos: [], sessionHours: 0, commitCount: 0 }

  if (!prefs.useGit) {
    console.error(chalk.dim('非开发角色：跳过 git gather'))
  } else if (gather.commitCount === 0) {
    console.error(chalk.yellow('今日无 commit，将按主动型类目补齐（可用 --append 补充）'))
  } else {
    console.error(
      chalk.dim(
        `采集 ${gather.repos.length} 仓 · ${gather.commitCount} commit · session ${gather.sessionHours}h`,
      ),
    )
  }

  const targetHours = Math.max(options.targetHours ?? 8, gather.sessionHours)

  const plan = await generateDailyPlan({
    role: prefs.role,
    categories: prefs.categories,
    targetHours,
    gather,
    append: options.append ?? [],
    quiet: Boolean(options.json),
  })

  plan.items = plan.items.map((it) => ({
    ...it,
    hours: halfHour(it.hours),
    project: it.project.trim() || '通用',
    text: it.text.trim(),
  }))
  assertPlan(plan, targetHours)
  applyDisplayNames(plan.displayNames)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          targetHours,
          gather,
          plan,
          record: buildRecord({
            plan,
            date,
            role: prefs.role,
            targetHours,
            sessionHours: gather.sessionHours,
            commitCount: gather.commitCount,
          }),
        },
        null,
        2,
      ),
    )
  }

  if (options.dryRun) {
    console.log(chalk.yellow('[dry-run]'))
    console.log(`sheetTime: ${normalizeSheetTime(plan.sheetTime)}`)
    console.log('')
    console.log(formatDaily(plan))
    return
  }

  deliver({
    plan,
    date,
    role: prefs.role,
    targetHours,
    sessionHours: gather.sessionHours,
    commitCount: gather.commitCount,
    autoCopy: prefs.autoCopy,
    noClipboard: options.noClipboard,
    print: !options.json,
  })
}
