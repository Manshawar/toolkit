/**
 * CLI 等待动画：blessed 小卡片画猫猫动耳朵。
 *
 * blessed 会进备用屏（像 vim），结束 destroy 后原命令行内容会回来；
 * 卡片只占底部一小块，不是铺满业务 UI。
 */
import blessed from 'blessed'
import chalk from 'chalk'

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

/** 耳朵帧 */
const EAR_FRAMES = ['∧＿∧', '∩＿∩', '∧＿∧', '／￣＼'] as const

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

function escapeTag(s: string): string {
  return s.replace(/[{}]/g, '')
}

function createBlessedCatSpinner(label: string): Spinner {
  let status: SpinnerStatus = 'idle'
  let current = label
  let screen: blessed.Widgets.Screen | null = null
  let box: blessed.Widgets.BoxElement | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let tick = 0
  let startedAt = 0

  const paint = () => {
    if (!box || !screen) return
    const ears = EAR_FRAMES[tick % EAR_FRAMES.length]
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    box.setContent(
      [
        `{center}{magenta-fg}${ears}{/}{/center}`,
        `{center}{magenta-fg}( ̳• · • ̳){/}{/center}`,
        `{center}{cyan-fg}${escapeTag(current)}{/}{/center}`,
        `{center}{gray-fg}${elapsed}s · 耳朵动起来{/}{/center}`,
      ].join('\n'),
    )
    screen.render()
    tick++
  }

  const teardown = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (screen) {
      screen.destroy()
      screen = null
      box = null
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
      startedAt = Date.now()
      tick = 0

      screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
        warnings: false,
        // 备用屏：结束后恢复原终端内容
        title: 'tkt',
      })

      // 半透明感：整屏只留底色，猫猫卡片贴底部中央
      blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        style: { bg: 'black' },
      })

      box = blessed.box({
        parent: screen,
        bottom: 1,
        left: 'center',
        width: 36,
        height: 8,
        padding: { left: 1, right: 1, top: 0, bottom: 0 },
        tags: true,
        border: { type: 'line' },
        label: ' {magenta-fg}(=^･ω･^=){/} ',
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'magenta' },
          label: { fg: 'magenta' },
        },
      })

      screen.key(['escape', 'q', 'C-c'], () => {
        teardown()
        status = 'cancel'
        process.exit(130)
      })

      timer = setInterval(paint, 160)
      paint()
    },
    update(message) {
      current = message
    },
    succeed(message) {
      const text = message ?? current
      teardown()
      status = 'success'
      console.log(`${chalk.magenta('(=^･ω･^=)')} ${chalk.green(`✔ ${text}`)}`)
    },
    fail(message) {
      const text = message ?? current
      teardown()
      status = 'error'
      console.log(`${chalk.magenta('(;-_-;)')} ${chalk.red(`✖ ${text}`)}`)
    },
    cancel(message) {
      const text = message ?? current
      teardown()
      status = 'cancel'
      console.log(`${chalk.magenta('(=ｘェｘ=)')} ${chalk.yellow(`■ ${text}`)}`)
    },
  }
}

export function createSpinner(label = '', opts: SpinnerOptions = {}): Spinner {
  if (shouldQuiet(opts.quiet)) return noopSpinner()
  return createBlessedCatSpinner(label)
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
