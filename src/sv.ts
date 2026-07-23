import { exec, spawn } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/** 按需用 fnm 切 Node 版本后 npm run serve */
export async function runServe(nodeVersion?: string): Promise<void> {
  const cwd = process.cwd()
  const targetVersion = nodeVersion || '14'

  if (isNaN(parseInt(targetVersion, 10))) {
    console.error(`❌ 无效的 Node.js 版本: ${targetVersion}`)
    console.log('请提供有效数字版本号，例如: tkt sv 16')
    return
  }

  console.log('检测当前 Node.js 版本...')
  const { stdout } = await execAsync('node -v', { cwd })
  const version = stdout.trim()
  const major = version.match(/v(\d+)/)?.[1]
  console.log(`当前 Node.js 版本: ${version}`)

  let command: string
  if (major !== targetVersion) {
    console.log(`切换到 Node.js ${targetVersion}...`)
    command = `eval "$(fnm env --use-on-cd)" && fnm use ${targetVersion} && npm run serve`
  } else {
    console.log(`当前已是 Node.js ${targetVersion}，直接启动...`)
    command = 'npm run serve'
  }

  console.log('启动开发服务器...')
  const child = spawn('zsh', ['-c', command], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  child.on('error', (error) => {
    console.error(`启动失败: ${error.message}`)
  })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`进程退出，代码: ${code}`)
    }
  })
}
