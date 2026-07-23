/**
 * CLI 等待动画：
 * - createSpinner / withSpinner：ora 行内（collect / commit / push）
 * - createCatRun / withCatRun：颜文字小猫循环 + 往前跑（AI analyze）
 *
 * 颜文字参考：https://symboldb.org/zh/kaomoji/cat-kaomoji/
 *
 * ```ts
 * await withCatRun('analyze', async (spin) => { … })
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
 * 小猫颜文字帧（经典 + 表情），循环切换看起来在动。
 * @see https://symboldb.org/zh/kaomoji/cat-kaomoji/
 */
const CAT_KAOMOJI = [
  '(=^･ω･^=)',
  '(=^･ｪ･^=)',
  '(=ΦωΦ=)',
  '(=◕ω◕=)',
  '(=・ω・=)',
  '(=^∇^=)',
  '(=①ω①=)',
  '(=✪ω✪=)',
  '(=●ω●=)',
  '(=⌒‿‿⌒=)',
  '(=´∇｀=)',
  '(=✧ω✧=)',
  '(=♡ω♡=)',
  '(=^▽^=)',
  '(=￣ω￣=)',
  '(=ﾟωﾟ=)',
]

/** 颜文字轮播 + 水平位移 → 往前跑 */
function buildKaomojiRunFrames(track: number): string[] {
  const maxFace = Math.max(...CAT_KAOMOJI.map((s) => s.length))
  const frames: string[] = []
  for (let i = 0; i < track; i++) {
    const face = CAT_KAOMOJI[i % CAT_KAOMOJI.length]
    const left = ' '.repeat(i)
    const right = ' '.repeat(track - 1 - i + (maxFace - face.length))
    frames.push(`${left}${face}${right}`)
  }
  return frames
}

const ORA_SPINNER = {
  interval: 120,
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
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
 * 单独空一行：小猫颜文字轮播并往前跑。
 * 结束后清掉该行，再打印结果颜文字。
 */
function createCatRunSpinner(label: string): Spinner {
  let status: SpinnerStatus = 'idle'
  let current = label
  let timer: ReturnType<typeof setInterval> | null = null
  let frame = 0
  const cols = process.stdout.columns ?? 80
  const maxFace = Math.max(...CAT_KAOMOJI.map((s) => s.length))
  const track = Math.max(8, Math.min(24, cols - maxFace - 2))
  const frames = buildKaomojiRunFrames(track)

  const clearLine = () => {
    const w = process.stdout.columns ?? 80
    process.stdout.write(`\r${' '.repeat(w)}\r`)
  }

  const paint = () => {
    process.stdout.write(`\r${chalk.magenta(frames[frame % frames.length])}`)
    frame++
  }

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
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
      process.stdout.write('\n')
      paint()
      timer = setInterval(paint, 140)
    },
    update(message) {
      current = message
    },
    succeed(message) {
      const text = message ?? current
      status = 'success'
      stopTimer()
      clearLine()
      console.log(`${chalk.magenta(CAT_FACE)} ${chalk.green(`✔ ${text}`)}`)
    },
    fail(message) {
      const text = message ?? current
      status = 'error'
      stopTimer()
      clearLine()
      console.log(`${chalk.magenta('(=；ω；=)')} ${chalk.red(`✖ ${text}`)}`)
    },
    cancel(message) {
      const text = message ?? current
      status = 'cancel'
      stopTimer()
      clearLine()
      console.log(`${chalk.magenta('(=￣ω￣=)')} ${chalk.yellow(`■ ${text}`)}`)
    },
  }
}

export function createSpinner(label = '', opts: SpinnerOptions = {}): Spinner {
  if (shouldQuiet(opts.quiet)) return noopSpinner()
  return createOraSpinner(label)
}

/** AI 分析用：颜文字小猫往前跑 */
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
