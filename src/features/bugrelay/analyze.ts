/**
 * bugrelay 分析链路：claude-agent-sdk + 进程内 MCP tools，agentic 多轮拉取。
 *
 * 流程：ws 拉快照摘要 → 组 prompt → SDK 启动（MCP tools: request_page_info / read_source）
 * → AI 按需多轮拉明细 → outputFormat json_schema 结构化输出。
 *
 * 引擎薄抽象：SDK 撞网关怪问题时，runClaudeAnalysis 是唯一需要替换的函数
 * （降级方案：spawn `claude -p` 单轮，结论照出但无工具多轮）。
 * openai 后端不参与 bugrelay（工具链依赖 SDK 进程内 MCP）。
 */
import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { recordUsage } from '@/agent/shared'
import { sendCommand, setSnapshot, getSession, type BugrelayCommand } from './session'
import { readSettings } from './settings'

export const analysisSchema = z.object({
  attribution: z.enum(['frontend', 'backend', 'uncertain']).describe('bug 归属'),
  confidence: z.number().min(0).max(1).describe('置信度 0~1'),
  summary: z.string().describe('一句话结论'),
  evidence: z.array(z.string()).describe('依据，引用请求/日志/mutation 编号'),
  suggestions: z.array(z.string()).describe('可执行修复建议'),
  routes: z.array(z.string()).describe('涉及前端路由'),
  files: z.array(z.string()).describe('涉及源码文件 file:line'),
})
export type AnalysisResult = z.infer<typeof analysisSchema>

export interface AnalyzeProgress {
  (event: { stage: 'snapshot' | 'analyzing' | 'tool' | 'done' | 'error'; [k: string]: unknown }): void
}

/** zod → CLI --json-schema（剥 draft 2020-12 $schema，CLI 端 ajv 无此 meta） */
function toCliJsonSchema(schema: z.ZodType, title: string): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return { ...rest, title }
}

const SYSTEM_PROMPT = `你是前后端 bug 归属分析助手。被测对象：H5 页面（Vue 技术栈为主），运行在 PC 浏览器或 app webview 内。
页面已注入采集脚本，你可以通过工具按需拉取页面数据，不要一次拉全部。

## 接口契约（常见约定，以实际响应为准）
- 响应统一 { errcode, data }，errcode == 200 成功
- 历史坑：契约残留（误读 res.success）、双端字段不一致

## 归属判定硬标准（满足任一 → 后端）
1. HTTP 4xx/5xx 且前端请求参数按契约核对无误
2. HTTP 200 但 errcode != 200，明显后端业务校验/数据问题
3. 返回结构整体不符契约

## 前端问题典型信号
- console / Vue errorHandler 报错指向前端 JS
- 字段取值笔误 / 契约解析残留 / 校验规则错
- 请求参数缺失或格式错误
- Vuex state 取值与预期不符（附 mutation 轨迹佐证）

## 工作方式
1. 先看快照摘要（用户消息内），定位可疑请求/日志编号
2. 用 request_page_info 按需拉明细（body / vuex / 轨迹）
3. 给了源码目录时，用 read_source grep 定位 file:line（路由 → 组件 → 方法）
4. 证据不足就判 uncertain 并说明缺什么，不要硬猜`

interface PageMeta {
  url?: string
  title?: string
  ua?: string
  lanxinVer?: string
  net?: string
  route?: string
}

/** 快照 → 摘要级（请求不含 body，日志截断），控制首 prompt 体量 */
export function summarizeSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const s = snapshot as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (Array.isArray(s.requests)) {
    out.requests = s.requests.map((r: unknown, i: number) => {
      const req = r as Record<string, unknown>
      return {
        i,
        method: req.method,
        url: typeof req.url === 'string' ? req.url.slice(0, 200) : req.url,
        status: req.status,
        errcode: req.errcode,
        ms: req.ms,
        ts: req.ts,
      }
    })
  }
  if (Array.isArray(s.logs)) {
    out.logs = s.logs.map((l: unknown, i: number) => {
      const log = l as Record<string, unknown>
      return {
        i,
        level: log.level,
        text: typeof log.text === 'string' ? log.text.slice(0, 300) : log.text,
        ts: log.ts,
      }
    })
  }
  if (Array.isArray(s.errors)) out.errors = s.errors
  if (Array.isArray(s.routes)) out.routes = s.routes
  if (Array.isArray(s.mutations)) {
    out.mutations = (s.mutations as unknown[]).slice(-20)
  }
  return out
}

// ---------- read_source 工具实现（fs 直读，边界 = addDirs） ----------

const SOURCE_EXTS = ['.js', '.ts', '.vue', '.tsx', '.jsx', '.json']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'output', '.output'])
const MAX_SCAN_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024

function resolveInDirs(rel: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const abs = path.resolve(dir, rel)
    if (abs.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(abs)) return abs
  }
  // 允许直接给绝对路径，但必须在 addDirs 内
  const abs = path.resolve(rel)
  if (dirs.some((d) => abs.startsWith(path.resolve(d) + path.sep)) && fs.existsSync(abs)) {
    return abs
  }
  return null
}

function walkSourceFiles(dir: string, acc: string[], cap: number): void {
  if (acc.length >= cap) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (acc.length >= cap) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSourceFiles(full, acc, cap)
    } else if (SOURCE_EXTS.includes(path.extname(e.name))) {
      acc.push(full)
    }
  }
}

function grepSource(dirs: string[], pattern: string, maxResults: number) {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const files: string[] = []
  for (const d of dirs) walkSourceFiles(d, files, MAX_SCAN_FILES)
  const matches: { file: string; line: number; text: string }[] = []
  for (const file of files) {
    if (matches.length >= maxResults) break
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_FILE_BYTES) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          matches.push({
            file: file.replace(process.cwd() + path.sep, ''),
            line: i + 1,
            text: lines[i].trim().slice(0, 200),
          })
          if (matches.length >= maxResults) break
        }
      }
    } catch {
      /* 读失败跳过 */
    }
  }
  return { scanned: files.length, matches }
}

function readSourceFile(dirs: string[], rel: string, startLine: number, maxLines: number) {
  const abs = resolveInDirs(rel, dirs)
  if (!abs) return { error: `文件不存在或不在 addDirs 内: ${rel}` }
  const stat = fs.statSync(abs)
  if (stat.isDirectory()) {
    return { dir: abs, entries: fs.readdirSync(abs).slice(0, 200) }
  }
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  const from = Math.max(0, startLine - 1)
  return {
    file: abs,
    totalLines: lines.length,
    from: from + 1,
    content: lines.slice(from, from + maxLines).join('\n'),
  }
}

function globSource(dirs: string[], pattern: string, maxResults: number) {
  const needle = pattern.toLowerCase()
  const files: string[] = []
  for (const d of dirs) walkSourceFiles(d, files, MAX_SCAN_FILES)
  const hits = files.filter((f) => f.toLowerCase().includes(needle)).slice(0, maxResults)
  return { scanned: files.length, matches: hits }
}

// ---------- 主流程 ----------

export async function runAnalysis(opts: {
  sessionId: string
  question: string
  onProgress?: AnalyzeProgress
}): Promise<AnalysisResult> {
  const { sessionId, question, onProgress } = opts
  const emit = onProgress ?? (() => {})
  const session = getSession(sessionId)
  if (!session) throw new Error(`会话不存在: ${sessionId}`)

  // 1. ws 拉快照（摘要进 prompt，全量缓存供报告/工具拉取）
  emit({ stage: 'snapshot' })
  const snapshot = (await sendCommand(sessionId, 'get_snapshot')) as unknown
  setSnapshot(sessionId, snapshot)
  const summary = summarizeSnapshot(snapshot)

  const meta: PageMeta = { ...session.page, route: session.route }
  const settings = readSettings()

  const userPrompt = [
    `## 测试人员描述\n${question}`,
    `## 环境 / 页面\n${JSON.stringify(meta, null, 2)}`,
    `## 快照摘要（请求/日志只有索引与关键字段，明细用工具拉）\n${JSON.stringify(summary, null, 2)}`,
    settings.addDirs.length
      ? `## 源码目录（read_source 可及）\n${settings.addDirs.join('\n')}`
      : '## 源码目录\n（未配置 add_dirs，无法读源码，files 字段留空并说明）',
    '\n## 任务\n输出结构化归属判定。',
  ].join('\n\n')

  // 2. SDK + 进程内 MCP tools 多轮分析
  emit({ stage: 'analyzing' })
  const result = await runClaudeAnalysis({ sessionId, userPrompt, addDirs: settings.addDirs, emit })
  return result
}

/** 引擎隔离层：SDK 专用；降级时只换这个函数 */
async function runClaudeAnalysis(opts: {
  sessionId: string
  userPrompt: string
  addDirs: string[]
  emit: AnalyzeProgress
}): Promise<AnalysisResult> {
  const { sessionId, userPrompt, addDirs, emit } = opts
  const sdk = await import('@anthropic-ai/claude-agent-sdk')

  const tools = [
    sdk.tool(
      'request_page_info',
      '经 ws 命令通道向被测页面拉取明细数据。get_snapshot=全量快照（含请求 body）；get_vue_state=Vuex state 快照；get_vuex_trace=mutation 序列；get_breadcrumbs=用户点击轨迹；get_dom=页面文本摘要；get_perf=性能；get_storage=脱敏存储',
      {
        cmd: z.enum([
          'get_snapshot',
          'get_vue_state',
          'get_vuex_trace',
          'get_breadcrumbs',
          'get_dom',
          'get_perf',
          'get_storage',
        ]),
      },
      async (args) => {
        try {
          const data = await sendCommand(sessionId, args.cmd as BugrelayCommand)
          if (args.cmd === 'get_snapshot') setSnapshot(sessionId, data)
          return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? null) }] }
        } catch (e) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
          }
        }
      },
    ),
    sdk.tool(
      'read_source',
      '读取挂载的前端源码定位 file:line。mode=grep 按正则搜内容；mode=read 读文件片段（path 相对源码目录）；mode=glob 按文件名子串找文件',
      {
        mode: z.enum(['grep', 'read', 'glob']),
        pattern: z.string().optional().describe('grep 正则 / glob 文件名子串'),
        path: z.string().optional().describe('read 模式的文件相对路径'),
        startLine: z.number().optional().describe('read 模式起始行，默认 1'),
        maxResults: z.number().optional().describe('结果上限，默认 50'),
      },
      async (args) => {
        if (!addDirs.length) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: '未配置 add_dirs（tkt bugrelay --add-dir <path>）' }],
          }
        }
        const max = Math.min(args.maxResults ?? 50, 200)
        let out: unknown
        if (args.mode === 'grep') {
          if (!args.pattern) return { isError: true, content: [{ type: 'text' as const, text: 'grep 需要 pattern' }] }
          out = grepSource(addDirs, args.pattern, max)
        } else if (args.mode === 'read') {
          if (!args.path) return { isError: true, content: [{ type: 'text' as const, text: 'read 需要 path' }] }
          out = readSourceFile(addDirs, args.path, args.startLine ?? 1, 300)
        } else {
          if (!args.pattern) return { isError: true, content: [{ type: 'text' as const, text: 'glob 需要 pattern' }] }
          out = globSource(addDirs, args.pattern, max)
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] }
      },
    ),
  ]

  const mcpServer = sdk.createSdkMcpServer({ name: 'bugrelay', version: '1.0.0', tools })
  const abort = new AbortController()
  const killTimer = setTimeout(() => abort.abort(), 180_000)
  killTimer.unref()

  try {
    const q = sdk.query({
      prompt: userPrompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        tools: [],
        mcpServers: { bugrelay: mcpServer },
        allowedTools: ['mcp__bugrelay__request_page_info', 'mcp__bugrelay__read_source'],
        outputFormat: { type: 'json_schema', schema: toCliJsonSchema(analysisSchema, 'BugAttribution') },
        maxTurns: 12,
        permissionMode: 'dontAsk',
        abortController: abort,
      },
    })

    let resultMessage: import('@anthropic-ai/claude-agent-sdk').SDKResultMessage | undefined
    let toolRounds = 0
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const blocks = (msg.message?.content ?? []) as unknown[]
        for (const b of blocks) {
          const block = b as { type?: string; name?: string }
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            toolRounds += 1
            emit({ stage: 'tool', tool: block.name.replace(/^mcp__bugrelay__/, ''), round: toolRounds })
          }
        }
      }
      if (msg.type === 'result') resultMessage = msg
    }
    if (!resultMessage) throw new Error('Claude Code 未返回结果')
    if (resultMessage.subtype !== 'success') {
      throw new Error(`Claude Code 执行失败（${resultMessage.subtype}）`)
    }

    const ok = resultMessage
    const model = Object.keys(ok.modelUsage ?? {})[0] ?? 'claude'
    const u = ok.usage ?? {}
    recordUsage('bugrelay', model, {
      inputTokens:
        (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    })

    let raw: unknown = ok.structured_output
    if (raw == null && typeof ok.result === 'string') {
      const m = ok.result.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          raw = JSON.parse(m[0])
        } catch {
          /* fallthrough */
        }
      }
    }
    const parsed = analysisSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`结构化输出校验失败: ${parsed.error.message}`)
    }
    return parsed.data
  } finally {
    clearTimeout(killTimer)
  }
}
