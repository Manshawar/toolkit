/** 本地编排：prefs → roster → gather → ai → deliver */
import chalk from 'chalk'
import * as path from 'path'
import { fillMissingDisplayNames, generateDailyPlan } from './ai'
import {
  assertPlan,
  buildRecord,
  deliver,
  formatDaily,
  halfHour,
  normalizeSheetTime,
} from './deliver'
import { discoverRepos, gatherToday } from './gather'
import { WEEKDAY_LABELS, maxDayHours, resolveWorkWindow } from './hours'
import { ensurePrefs } from './prefs'
import { promptReportInteractive } from './roster'
import { loadSetting, writeSetting } from './setting'
import type { ReportOptions } from './types'

function applyDisplayNames(pairs: Array<{ path: string; name: string }>): void {
  if (!pairs.length) return
  const setting = loadSetting()
  let dirty = false
  for (const { path: p, name } of pairs) {
    const abs = path.resolve(p)
    const n = name.trim()
    // 只要中文名；拒绝 KaoQin-Attendance 这类英文
    if (!n || !/[\u4e00-\u9fff]/.test(n)) continue
    const i = setting.repositories.findIndex((r) => r.path === abs)
    if (i < 0) continue
    const cur = setting.repositories[i]!
    if (cur.name_custom || /[\u4e00-\u9fff]/.test(cur.display_name || '')) continue
    cur.display_name = n
    dirty = true
    console.error(`✅ ${cur.alias} → ${n}`)
  }
  if (dirty) writeSetting(setting)
}

export async function runReport(options: ReportOptions = {}): Promise<void> {
  const prefs = await ensurePrefs({ role: options.role })
  const date = options.date || new Date().toISOString().slice(0, 10)

  let append = [...(options.append ?? [])]
  let onlyPaths: string[] | undefined
  let dayStart = options.dayStart
  let dayEnd = options.dayEnd
  let autoCopy = prefs.autoCopy

  if (prefs.useGit) {
    let repos = discoverRepos({ userRepos: options.userRepos })
    // 本地词典先猜；真打 AI 时 createAgentClient 才拦截配置
    repos = await fillMissingDisplayNames(repos, { quiet: Boolean(options.json) })

    const interactive = process.stdin.isTTY && !options.json
    if (interactive) {
      // 默认进补充输入框；--roster 才先打开快捷键区。工时/剪贴板不主动弹。
      const picked = await promptReportInteractive(repos, {
        focusKeys: Boolean(options.forceRoster),
        date,
      })
      onlyPaths = picked.repos.filter((r) => r.enabled).map((r) => r.path)
      if (picked.append) append.push(picked.append)
      if (picked.dayStart) dayStart = picked.dayStart
      if (picked.dayEnd) dayEnd = picked.dayEnd
      autoCopy = picked.autoCopy
    } else {
      onlyPaths = repos.filter((r) => r.enabled).map((r) => r.path)
    }
  }

  if (!dayStart || !dayEnd) {
    const s = loadSetting()
    const win = resolveWorkWindow(s, date, { dayStart, dayEnd })
    dayStart = dayStart || win.dayStart
    dayEnd = dayEnd || win.dayEnd
    if (!win.enabled) {
      console.error(
        chalk.dim(`今日（${WEEKDAY_LABELS[win.weekday]}）未勾选工作日，仍按 ${dayStart}→${dayEnd} 生成`),
      )
    }
  }

  const gather = prefs.useGit
    ? gatherToday({
        date,
        dayStart,
        dayEnd,
        userRepos: options.userRepos,
        onlyPaths,
      })
    : { date, repos: [], sessionHours: 0, commitCount: 0 }

  if (!prefs.useGit) {
    console.error(chalk.dim('非开发角色：跳过 git gather'))
  } else if (gather.commitCount === 0) {
    console.error(chalk.yellow('今日无 commit（或未勾选仓库），将按主动型类目补齐（可附带补充）'))
  } else {
    console.error(
      chalk.dim(
        `采集 ${gather.repos.length} 仓 · ${gather.commitCount} commit · 工时窗 ${dayStart}→${dayEnd} · session ${gather.sessionHours}h`,
      ),
    )
  }

  // 目标工时：完全以用户设定窗为准（--target-hours 显式覆盖时仍用该值）
  const windowHours = maxDayHours(dayStart!, dayEnd!)
  const targetHours =
    options.targetHours != null ? Math.max(0.5, options.targetHours) : windowHours

  console.error(chalk.dim(`目标工时 ${targetHours}h（以 ${dayStart} → ${dayEnd} 为准）`))

  const plan = await generateDailyPlan({
    role: prefs.role,
    categories: prefs.categories,
    targetHours,
    gather,
    append,
    dayStart,
    dayEnd,
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
    autoCopy,
    noClipboard: options.noClipboard,
    print: !options.json,
  })
}
