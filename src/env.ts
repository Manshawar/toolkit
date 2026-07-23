/** 读取必填环境变量 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请在 .env 中配置（参考 .env.example）`)
  }
  return value
}

export function getEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback
}

/** 优先 TKT_*，兼容旧 ST_* */
export function getProviderId(fallback = 'minimax'): string {
  return getEnv('TKT_PROVIDER') || getEnv('ST_PROVIDER', fallback)
}
