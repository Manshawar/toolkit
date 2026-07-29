/**
 * bugrelay 注入 snippet 生成：index.html <head> 最前白名单片段。
 * vue-cli (public/index.html) 与 vite (根 index.html) 通用，不做构建插件。
 */
import * as os from 'os'

export const DEFAULT_BUGRELAY_PORT = 9527

export function lanIp(): string | null {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

/** 白名单注入片段；server 缺省 http://127.0.0.1:<port>（iOS/局域网场景由 ?bugrelay_server= 覆盖） */
export function buildSnippet(port: number): string {
  return `<script>
(function () {
  var h = location.hostname
  // 白名单: 本地 dev + 局域网 IP (生产域名不在列, 天然免疫)
  // 测试环境域名自行追加, 如: /(^|\\.)eapps-betacloud\\.e\\.lanxin\\.cn$/.test(h)
  var isLocal = h === 'localhost' || h === '127.0.0.1' ||
    /^(192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(h)
  if (!isLocal || localStorage.getItem('bugrelay_off') === '1') return
  // URL query 指定服务地址 (iOS/无 adb 场景), 持久化
  var q = new URLSearchParams(location.search).get('bugrelay_server')
  if (q) localStorage.setItem('bugrelay_server', q)
  var s = document.createElement('script')
  s.src = (localStorage.getItem('bugrelay_server') || 'http://127.0.0.1:${port}') + '/bugrelay/collector.js'
  s.async = true
  document.head.appendChild(s)
})()
</script>`
}
