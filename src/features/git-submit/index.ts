/**
 * git-submit 入口：
 * - 本地：`tkt gc` → AI SDK 生成 Plan → commit（可选 push）
 * - Skill：`tkt agent git-submit prepare|apply` → 宿主出 Plan，CLI 校验执行
 */
import * as fs from 'fs'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { z } from 'zod'
import {
  AgentListSchema,
  emitCliError,
  emitJson,
  GitSubmitResultSchema,
} from '../../core/cli'
import { printAutoPushStatus, resolveAutoPush } from './ask'
import { GitSubmitError } from './errors'
import { runWorkflow } from './run'
import { CommitPlanSchema, type CommitPlan, type GitSubmitOptions } from './types'

export type { GitSubmitOptions, CommitPlan, AiMode } from './types'
export { CommitPlanSchema } from './types'

export async function runGitSubmit(options: GitSubmitOptions): Promise<void> {
  try {
    const ctx = await runWorkflow(options)

    if (options.prepare || (options.ai === 'agent' && !ctx.commitPlan)) {
      if (!options.json) {
        console.error(chalk.dim('→ tkt agent git-submit apply --plan-file <plan.json>'))
      }
      return
    }

    const commits = (ctx.commitPlan?.commits ?? []).map((c, i) => ({
      message: c.message,
      hash: ctx.commitHashes?.[i] ?? '',
    }))
    const pushed = Boolean(ctx.pushed)

    if (options.json) {
      emitJson(GitSubmitResultSchema, {
        ok: true as const,
        commits,
        pushed,
        gerrit: ctx.isGerrit,
      })
      return
    }

    if (options.dryRun) {
      console.log(chalk.yellow('dry-run 完成'))
      return
    }
    console.log(
      chalk.green(
        `完成：${commits.length} 个 commit${
          pushed ? (ctx.isGerrit ? ' + gerrit + push' : ' + push') : ''
        }`,
      ),
    )
  } catch (e) {
    if (e instanceof GitSubmitError && e.code === 'CLEAN') {
      if (options.json) emitCliError({ ok: false, code: 'CLEAN', message: e.message })
      else console.log(chalk.dim(e.message))
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof GitSubmitError ? e.code : 'GIT_SUBMIT'
    if (options.json) emitCliError({ ok: false, code, message: msg })
    else console.error(chalk.red(msg))
    process.exitCode = 1
  }
}

// ── Skill CLI ───────────────────────────────────────────────────────

const PrepareSchema = z.object({
  noPull: z.boolean().default(false),
})

const ApplySchema = z
  .object({
    planFile: z.string().optional(),
    plan: z.string().optional(),
    noPull: z.boolean().default(false),
    noPush: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    json: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.planFile || v.plan), { message: '需要 --plan-file 或 --plan' })

function readPlan(args: { planFile?: string; plan?: string }): CommitPlan {
  const raw = args.planFile
    ? fs.readFileSync(args.planFile, 'utf8').trim()
    : (args.plan ?? '').trim()
  if (!raw) throw new Error('CommitPlan 为空')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`CommitPlan JSON 无效: ${raw.slice(0, 120)}`)
  }
  return CommitPlanSchema.parse(parsed)
}

function failAgent(e: unknown): void {
  emitCliError({
    ok: false,
    code: 'AGENT_GIT_SUBMIT',
    message: e instanceof Error ? e.message : String(e),
  })
  process.exitCode = 1
}

/** 注册 `tkt gc` + `tkt agent …` */
export function registerGitSubmitCommands(program: Command): void {
  program
    .command('gc')
    .description('AI 提交：Pull → CommitPlan → Commit（可选 Push）')
    .option('--dry-run', '不提交不推送')
    .option('--no-pull', '跳过 pull')
    .addOption(new Option('--push', '开启自动推送并记住'))
    .addOption(new Option('--no-push', '关闭自动推送并记住'))
    .option('--json', 'JSON 结果')
    .action(async (opts) => {
      const { noPush, enable } = await resolveAutoPush({
        push: Boolean(opts.push),
        noPush: Boolean(opts.noPush),
        json: Boolean(opts.json),
        dryRun: Boolean(opts.dryRun),
      })
      if (!opts.json) printAutoPushStatus(enable)
      await runGitSubmit({
        ai: 'local',
        dryRun: Boolean(opts.dryRun),
        noPull: !opts.pull,
        noPush,
        json: Boolean(opts.json),
      })
    })

  const agent = program
    .command('agent')
    .description('Skill 入口（校验参数后转脚手架，不走本地 AI）')

  agent
    .command('list')
    .description('列出能力')
    .action(() => {
      emitJson(AgentListSchema, {
        ok: true as const,
        agents: [
          {
            name: 'git-submit',
            description: 'prepare → envelope；apply → 校验 Plan 后提交',
          },
        ],
      })
    })

  const cmd = agent.command('git-submit').description('Skill：prepare / apply CommitPlan')

  cmd
    .command('prepare')
    .description('收集 context，输出 AgentEnvelope')
    .option('--no-pull', '跳过 pull')
    .action(async (opts) => {
      try {
        const args = PrepareSchema.parse({ noPull: !opts.pull })
        await runGitSubmit({
          ai: 'agent',
          prepare: true,
          noPull: args.noPull,
          json: true,
        })
      } catch (e) {
        failAgent(e)
      }
    })

  cmd
    .command('apply')
    .description('校验 CommitPlan 后 commit/push')
    .option('--plan-file <path>', 'CommitPlan JSON 文件')
    .option('--plan <json>', '内联 CommitPlan JSON')
    .option('--no-pull', '跳过 pull')
    .option('--no-push', '跳过 push')
    .option('--dry-run', '不落库')
    .option('--human', '人类可读输出（默认 JSON）')
    .action(async (opts) => {
      try {
        const args = ApplySchema.parse({
          planFile: opts.planFile,
          plan: opts.plan,
          noPull: !opts.pull,
          noPush: !opts.push,
          dryRun: Boolean(opts.dryRun),
          json: !opts.human,
        })
        await runGitSubmit({
          ai: 'agent',
          commitPlan: readPlan(args),
          noPull: args.noPull,
          noPush: args.noPush,
          dryRun: args.dryRun,
          json: args.json,
        })
      } catch (e) {
        failAgent(e)
      }
    })
}
