/**
 * 交互询问：是否自动推送（选项式 Yes / No）。
 * 非 TTY 默认不推送；Ctrl+C 取消视为不推送并退出。
 */
import * as p from '@clack/prompts'

/** true = 推送；false = 不推送 */
export async function askAutoPush(): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  const choice = await p.select({
    message: '是否开启自动推送？',
    options: [
      { value: false, label: 'No', hint: '只 commit，不 push' },
      { value: true, label: 'Yes', hint: 'commit 后自动 push' },
    ],
    initialValue: false,
  })

  if (p.isCancel(choice)) {
    p.cancel('已取消')
    process.exit(0)
  }

  return choice
}
