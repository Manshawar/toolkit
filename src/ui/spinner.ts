/**
 * CLI 等待动画：
 * - createSpinner / withSpinner：ora 行内（collect / commit / push）
 * - createCatRun / withCatRun：状态栏「→ 思考中」+ 下一行机器人颜文字切换（AI analyze）
 *
 * 颜文字参考：https://kaomojis.jp/zh/search?q=%E6%9C%BA%E5%99%A8%E4%BA%BA
 *
 * AI 调用约定：createAiClient() 放在 withCatRun 外，缺配置先填再动画。
 *
 * ```ts
 * const ai = await createAiClient()
 * await withCatRun('analyze', async () => ai.generateObject(…))
 * ```
 */
import chalk from 'chalk'
import ora, { type Ora } from 'ora'

export type SpinnerStatus = 'idle' | 'running' | 'success' | 'error' | 'cancel'

export interface Spinner {
  start(message?: string): void
  update(message: string): void
  succeed(message?: string): void
  fail(message?: string): void
  cancel(message?: string): void
  readonly status: SpinnerStatus
}

export interface SpinnerOptions {
  quiet?: boolean
}

export const CAT_FACE = '(=^･ω･^=)'

/**
 * 状态栏下一行切换的机器人颜文字
 * @see https://kaomojis.jp/zh/search?q=%E6%9C%BA%E5%99%A8%E4%BA%BA
 */
const ROBOT_KAOMOJI = [
  '⟦◕ω◕⟧ﾉ~',
  '⟦●‿●⟧~',
  '[◐▃◐]๑๑',
  '[▣_▣]๑๑๑',
  '⟦•‿•⟧⚙~',
  '[◉_◉]ﾉ',
  '{◕‿◕}⚙',
  '⟦◕ᴗ◕⟧♪',
  '[◕ω◕]ﾉ⚙✨',
  'd[°□°]b',
  '{●_●}ﾉ',
  '[◐]‿[◐]',
  '⊙‿⊙✌',
  '⟦°‿°⟧⚡~',
  '{>◡<}',
  '╰(◕ω◕)╯⚙',
]

/** 状态栏 2 行：→ 思考中 / 颜文字 */
const THINK_HEIGHT = 2
const THINK_INTERVAL_MS = 450

const ORA_SPINNER = {
  interval: 120,
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
}

/** 终端显示宽度粗估（CJK 双宽） */
function displayWidth(s: string): number {
  let w = 0
  for (const c of s) {
    const cp = c.codePointAt(0)!
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

const ROBOT_PAD = Math.max(...ROBOT_KAOMOJI.map(displayWidth))

function padRobot(face: string): string {
  return face + ' '.repeat(Math.max(0, ROBOT_PAD - displayWidth(face)))
}

function shouldQuiet(explicit?: boolean): boolean {
  if (explicit != null) return explicit
  if (process.env.CI === 'true') return true
  if (!process.stdout.isTTY) return true
  return false
}

function noopSpinner(): Spinner {
  let status: SpinnerStatus = 'idle'
  return {
    get status() {
      return status
    },
    start() {
      status = 'running'
    },
    update() {},
    succeed() {
      status = 'success'
    },
    fail() {
      status = 'error'
    },
    cancel() {
      status = 'cancel'
    },
  }
}

function createOraSpinner(label: string): Spinner {
  let status: SpinnerStatus = 'idle'
  let current = label
  let inner: Ora | null = null

  const ensure = () => {
    if (inner) return inner
    inner = ora({
      text: chalk.cyan(current),
      spinner: ORA_SPINNER,
      color: 'magenta',
      discardStdin: false,
    })
    return inner
  }

  return {
    get status() {
      return status
    },
    start(message) {
      if (status === 'running') {
        if (message) {
          current = message
          inner?.start(chalk.cyan(current))
        }
        return
      }
      current = message ?? current
      status = 'running'
      ensure().start(chalk.cyan(current))
    },
    update(message) {
      current = message
      if (status === 'running' && inner) inner.text = chalk.cyan(current)
    },
    succeed(message) {
      const text = message ?? current
      status = 'success'
      if (inner) {
        inner.succeed(`${chalk.magenta(CAT_FACE)} ${chalk.green(text)}`)
        inner = null
      } else {
        console.log(`${chalk.magenta(CAT_FACE)} ${chalk.green(`✔ ${text}`)}`)
      }
    },
    fail(message) {
      const text = message ?? current
      status = 'error'
      if (inner) {
        inner.fail(`${chalk.magenta('(=；ω；=)')} ${chalk.red(text)}`)
        inner = null
      } else {
        console.log(`${chalk.magenta('(=；ω；=)')} ${chalk.red(`✖ ${text}`)}`)
      }
    },
    cancel(message) {
      const text = message ?? current
      status = 'cancel'
      if (inner) {
        inner.warn(`${chalk.magenta('(=￣ω￣=)')} ${chalk.yellow(text)}`)
        inner = null
      } else {
        console.log(`${chalk.magenta('(=￣ω￣=)')} ${chalk.yellow(`■ ${text}`)}`)
      }
    },
  }
}

/**
 * 对齐 pull/diff 状态栏：
 *   → 思考中
 *   ⟦◕ω◕⟧ﾉ~     ← 仅这一行切换颜文字
 */
function createCatRunSpinner(label: string): Spinner {
  let status: SpinnerStatus = 'idle'
  let current = label
  let timer: ReturnType<typeof setInterval> | null = null
  let frame = 0
  let reserved = false

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  const showCursor = () => process.stdout.write('\x1b[?25h')
  const hideCursor = () => process.stdout.write('\x1b[?25l')

  const eraseBlock = () => {
    if (!reserved) return
    process.stdout.write(`\x1b[${THINK_HEIGHT}A`)
    for (let i = 0; i < THINK_HEIGHT; i++) {
      process.stdout.write('\x1b[2K')
      if (i < THINK_HEIGHT - 1) process.stdout.write('\n')
    }
    if (THINK_HEIGHT > 1) process.stdout.write(`\x1b[${THINK_HEIGHT - 1}A`)
    process.stdout.write('\r')
  }

  const paint = () => {
    const face = padRobot(ROBOT_KAOMOJI[frame % ROBOT_KAOMOJI.length])
    process.stdout.write(`\x1b[${THINK_HEIGHT}A`)
    process.stdout.write(`\x1b[2K\r${chalk.dim('→ 思考中')}\n`)
    process.stdout.write(`\x1b[2K\r${chalk.magenta(face)}\n`)
    frame++
  }

  const finish = (line: string) => {
    stopTimer()
    eraseBlock()
    showCursor()
    console.log(line)
    if (THINK_HEIGHT > 1) process.stdout.write(`\x1b[${THINK_HEIGHT - 1}B\r`)
    reserved = false
  }

  return {
    get status() {
      return status
    },
    start(message) {
      if (status === 'running') {
        if (message) current = message
        return
      }
      current = message ?? current
      status = 'running'
      hideCursor()
      process.stdout.write('\n'.repeat(THINK_HEIGHT))
      reserved = true
      paint()
      timer = setInterval(paint, THINK_INTERVAL_MS)
    },
    update(message) {
      current = message
    },
    succeed(message) {
      const text = message ?? current
      status = 'success'
      finish(`${chalk.magenta(CAT_FACE)} ${chalk.green(`✔ ${text}`)}`)
    },
    fail(message) {
      const text = message ?? current
      status = 'error'
      finish(`${chalk.magenta('(=；ω；=)')} ${chalk.red(`✖ ${text}`)}`)
    },
    cancel(message) {
      const text = message ?? current
      status = 'cancel'
      finish(`${chalk.magenta('(=￣ω￣=)')} ${chalk.yellow(`■ ${text}`)}`)
    },
  }
}

export function createSpinner(label = '', opts: SpinnerOptions = {}): Spinner {
  if (shouldQuiet(opts.quiet)) return noopSpinner()
  return createOraSpinner(label)
}

/** AI 分析用：状态栏思考中 + 颜文字切换 */
export function createCatRun(label = '', opts: SpinnerOptions = {}): Spinner {
  if (shouldQuiet(opts.quiet)) return noopSpinner()
  return createCatRunSpinner(label)
}

export async function withSpinner<T>(
  label: string,
  fn: (spin: Spinner) => Promise<T>,
  opts: SpinnerOptions = {},
): Promise<T> {
  const spin = createSpinner(label, opts)
  spin.start()
  try {
    const result = await fn(spin)
    if (spin.status === 'running') spin.succeed(label)
    return result
  } catch (e) {
    if (spin.status === 'running') {
      const msg = e instanceof Error ? e.message : String(e)
      spin.fail(`${label}: ${msg}`)
    }
    throw e
  }
}

export async function withCatRun<T>(
  label: string,
  fn: (spin: Spinner) => Promise<T>,
  opts: SpinnerOptions = {},
): Promise<T> {
  const spin = createCatRun(label, opts)
  spin.start()
  try {
    const result = await fn(spin)
    if (spin.status === 'running') spin.succeed(label)
    return result
  } catch (e) {
    if (spin.status === 'running') {
      const msg = e instanceof Error ? e.message : String(e)
      spin.fail(`${label}: ${msg}`)
    }
    throw e
  }
}
