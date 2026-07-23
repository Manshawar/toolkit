/**
 * `tkt report` — 本地 AI 编排日报（同 tkt gc 模式）
 */
import { Command } from 'commander'
import { runReport } from './run'

function collect(value: string, prev: string[]): string[] {
  return prev.concat(value)
}

export function registerReportCommands(program: Command): void {
  program
    .command('report')
    .description('本地 AI 生成日报：gather → 写分点 → 归档/剪贴板')
    .option('--date <YYYY-MM-DD>', '日期，默认今天')
    .option('--yesterday', '昨天')
    .option('--role <角色>', '前端|后端|运维|测试|产品（首次可交互）')
    .option('--user-repo <path>', '追加仓库', collect, [])
    .option('--append <text>', '用户补充条目', collect, [])
    .option('--target-hours <n>', '目标总工时下限（默认 max(8, session)）')
    .option('--day-start <HH:MM>', '临时上班上限')
    .option('--day-end <HH:MM>', '临时下班下限')
    .option('--no-clipboard', '不复制剪贴板')
    .option('--dry-run', '只生成不归档')
    .option('--json', '输出 JSON（含 plan）')
    .action(async (opts) => {
      try {
        let date: string | undefined = opts.date
        if (opts.yesterday) {
          const d = new Date()
          d.setDate(d.getDate() - 1)
          date = d.toISOString().slice(0, 10)
        }
        await runReport({
          date,
          role: opts.role,
          userRepos: opts.userRepo,
          append: opts.append,
          targetHours: opts.targetHours != null ? Number(opts.targetHours) : undefined,
          dayStart: opts.dayStart,
          dayEnd: opts.dayEnd,
          noClipboard: Boolean(opts.noClipboard),
          dryRun: Boolean(opts.dryRun),
          json: Boolean(opts.json),
        })
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })
}
