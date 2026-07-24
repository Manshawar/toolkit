/** 首次交互：角色 + 剪贴板偏好 */
import * as p from '@clack/prompts'
import { ROLES, type Role } from '../types'
import { loadSetting, writeSetting } from '../setting'

function abort(v: unknown): asserts v is string | boolean {
  if (p.isCancel(v)) {
    p.cancel('已取消')
    process.exit(0)
  }
}

export async function ensurePrefs(opts: { role?: string } = {}): Promise<{
  role: string
  autoCopy: boolean
  useGit: boolean
  categories: string[]
}> {
  const setting = loadSetting()

  if (opts.role && (ROLES as readonly string[]).includes(opts.role)) {
    setting.role = opts.role
    writeSetting(setting)
  }

  if (!setting.role || !(ROLES as readonly string[]).includes(setting.role)) {
    if (!process.stdin.isTTY) throw new Error('缺少角色：tkt report --role 前端')
    const role = await p.select({
      message: '选择角色',
      options: ROLES.map((r) => ({ value: r, label: r })),
    })
    abort(role)
    setting.role = role as Role
    writeSetting(setting)
  }

  // 剪贴板默认开；可在快捷键区按 c 关，不再主动弹问
  if (setting.auto_copy == null) {
    setting.auto_copy = true
    writeSetting(setting)
  }

  const def = setting.role_definitions[setting.role]
  return {
    role: setting.role,
    autoCopy: setting.auto_copy !== false,
    useGit: def?.use_git ?? false,
    categories: def?.soft_work_categories ?? [],
  }
}
