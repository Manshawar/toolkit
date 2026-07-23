/**
 * `tkt report` — Agent 调用的日报脚手架（纯 CLI，不跑本地 AI）
 *
 * init | gather | emit | clipboard | save-repo | list-repos | set-display-name
 */
import { Command } from 'commander'
import {
  cmdClipboard,
  cmdEmit,
  cmdGather,
  cmdInit,
  cmdListRepos,
  cmdSaveRepo,
  cmdSetDisplayName,
} from './commands'

function collect(value: string, prev: string[]): string[] {
  return prev.concat([value])
}

export function registerReportCommands(program: Command): void {
  const report = program.command('report').description('日报脚手架（Agent 用：init/gather/emit）')

  report
    .command('init')
    .description('初始化/读取配置（JSON）')
    .option('--role <角色>', '前端|后端|运维|测试|产品')
    .option('--auto-copy <bool>', 'true|false')
    .option('--day-start <HH:MM>', '黑心上班上限')
    .option('--day-end <HH:MM>', '黑心下班下限')
    .action((opts) => {
      cmdInit({
        role: opts.role,
        autoCopy: opts.autoCopy,
        dayStart: opts.dayStart,
        dayEnd: opts.dayEnd,
      })
    })

  report
    .command('gather')
    .description('采集当日 commit + 工时（JSON）')
    .option('--date <YYYY-MM-DD>', '日期，默认今天')
    .option('--author <email>', '覆盖 git_user_email')
    .option('--day-start <HH:MM>', '临时覆盖上班上限')
    .option('--day-end <HH:MM>', '临时覆盖下班下限')
    .option('--user-repo <path>', '追加仓库（可多次）', collect, [])
    .option('--repos <json>', '显式仓库 JSON 数组')
    .action((opts) => {
      cmdGather({
        date: opts.date,
        author: opts.author,
        dayStart: opts.dayStart,
        dayEnd: opts.dayEnd,
        userRepos: opts.userRepo,
        reposJson: opts.repos,
      })
    })

  report
    .command('emit')
    .description('校验分点+sheetTime，归档并可选复制剪贴板')
    .requiredOption('--daily <text>', '纯分点日报')
    .requiredOption('--sheet-time <text>', '单行概括（无 sheetTime: 前缀）')
    .option('--date <YYYY-MM-DD>', '归档日期')
    .option('--no-clipboard', '跳过剪贴板')
    .action((opts) => {
      cmdEmit({
        daily: opts.daily,
        sheetTime: opts.sheetTime,
        date: opts.date,
        noClipboard: Boolean(opts.noClipboard),
      })
    })

  report
    .command('clipboard')
    .description('stdin → 剪贴板')
    .action(() => cmdClipboard())

  report
    .command('save-repo')
    .description('永久存档仓库')
    .option('--path <path>', '仓库路径')
    .option('--alias <alias>', '别名')
    .option('--display-name <name>', '中文展示名')
    .option('--cwd', '使用当前目录')
    .option('--touch', '只更新 last_used_at')
    .action((opts) => {
      cmdSaveRepo({
        path: opts.path,
        alias: opts.alias,
        displayName: opts.displayName,
        cwd: Boolean(opts.cwd),
        touch: Boolean(opts.touch),
      })
    })

  report
    .command('list-repos')
    .description('列出已存档仓库')
    .option('--json', 'JSON')
    .option('--current', '只打当前 cwd 的 alias')
    .option('--auto-detect-cwd', '探测并存档 cwd')
    .action((opts) => {
      cmdListRepos({
        json: Boolean(opts.json),
        current: Boolean(opts.current),
        autoDetectCwd: Boolean(opts.autoDetectCwd),
      })
    })

  report
    .command('set-display-name')
    .description('写入仓库中文 display_name')
    .requiredOption('--path <path>', '仓库路径')
    .requiredOption('--name <name>', '中文名')
    .action((opts) => {
      cmdSetDisplayName({ path: opts.path, name: opts.name })
    })
}
