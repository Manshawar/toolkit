/**
 * bugrelay collector —— 注入被测页面的采集端（ES5 单文件，零依赖）。
 * 由 tkt bugrelay 服务 host（/bugrelay/collector.js），snippet 白名单引入。
 *
 * - S 级采集：XHR/fetch（含 errcode 提取）/ console / JS+Promise 异常 / 资源加载失败 / 路由轨迹 / 环境
 * - A 级采集（best-effort）：Vuex mutation 序列 + state 快照 / 点击轨迹 / Vue errorHandler
 * - ring buffer：日志 100 / 请求 50 / 点击 30 / mutation 50 / 异常 30，body 截断 1KB
 * - 混合上报：异常经 ws 即时推，其余存 buffer 等命令拉取
 * - 脱敏：敏感键值替换 ***；storage 只报键名+是否存在
 * - 自我排除：跳过发往 bugrelay 自身的流量
 * - 浮层：可拖拽圆钮 + 半屏 panel（请求/日志/异常/Vuex/轨迹/状态 + snapshot 复制）
 * - 开关：localStorage bugrelay_off=1 关闭；bugrelay_server 覆盖服务地址
 */
(function () {
  'use strict'
  if (window.__bugrelay) return
  if (localStorage.getItem('bugrelay_off') === '1') return

  // ---------- 服务地址：query > localStorage > 自身脚本源 > 默认 ----------
  var DEFAULT_SERVER = 'http://127.0.0.1:9527'
  function serverOrigin() {
    try {
      var q = new URLSearchParams(location.search).get('bugrelay_server')
      if (q) {
        localStorage.setItem('bugrelay_server', q)
        return q
      }
    } catch (e) {}
    var saved = localStorage.getItem('bugrelay_server')
    if (saved) return saved
    try {
      var cs = document.currentScript
      if (cs && cs.src) return new URL(cs.src).origin
    } catch (e) {}
    return DEFAULT_SERVER
  }
  var SERVER = serverOrigin().replace(/\/+$/, '')

  // ---------- 工具 ----------
  var REDACT_KEYS = ['token', 'authorization', 'cookie', 'password', 'secret', 'ticket', 'session']
  function now() {
    return Date.now()
  }
  function truncate(s, n) {
    s = String(s)
    return s.length > n ? s.slice(0, n) + '…(' + s.length + ')' : s
  }
  function safeSerialize(v, depth) {
    depth = depth || 0
    if (v == null) return v
    if (v instanceof Error) return v.message + '\n' + (v.stack || '')
    var t = typeof v
    if (t === 'string') return truncate(v, 500)
    if (t === 'number' || t === 'boolean') return v
    if (t === 'function') return '[function]'
    if (depth > 3) return '[deep]'
    if (Array.isArray(v)) {
      var arr = []
      for (var i = 0; i < Math.min(v.length, 20); i++) arr.push(safeSerialize(v[i], depth + 1))
      return arr
    }
    if (t === 'object') {
      var o = {}
      var n = 0
      for (var k in v) {
        if (n++ >= 30) break
        try {
          o[k] = safeSerialize(v[k], depth + 1)
        } catch (e) {
          o[k] = '[unreadable]'
        }
      }
      return o
    }
    return String(v)
  }
  function argsToText(args) {
    var parts = []
    for (var i = 0; i < args.length; i++) {
      var a = args[i]
      if (typeof a === 'string') parts.push(a)
      else {
        try {
          parts.push(JSON.stringify(safeSerialize(a)))
        } catch (e) {
          parts.push(String(a))
        }
      }
    }
    return truncate(parts.join(' '), 1000)
  }
  /** 脱敏：JSON 文本中敏感键值替换 ***（best-effort） */
  function redact(text) {
    if (typeof text !== 'string') return text
    for (var i = 0; i < REDACT_KEYS.length; i++) {
      var k = REDACT_KEYS[i]
      text = text.replace(
        new RegExp('("' + k + '[^"]*"\\s*:\\s*")[^"]*(")', 'gi'),
        '$1***$2'
      )
      text = text.replace(new RegExp('(' + k + '=)[^&\\s]+', 'gi'), '$1***')
    }
    return text
  }
  function isSelfUrl(url) {
    return typeof url === 'string' && url.indexOf(SERVER) === 0
  }
  function pushRing(arr, item, cap) {
    arr.push(item)
    while (arr.length > cap) arr.shift()
  }

  // ---------- ring buffer ----------
  var logs = [] // {level,text,ts}
  var requests = [] // {method,url,status,errcode,ms,reqBody,respBody,ts}
  var errors = [] // {kind,message,stack,source,line,component,ts}
  var clicks = [] // {selector,text,ts}
  var mutations = [] // {type,payload,ts}
  var routes = [] // {from,to,ts}

  // ---------- 环境 ----------
  function envInfo() {
    var ua = navigator.userAgent || ''
    var m = ua.match(/Lanxin(?:Cloud)?\/([\d.]+)/i) || ua.match(/lxapp\/([\d.]+)/i)
    var conn = navigator.connection || {}
    return {
      url: location.href,
      title: document.title,
      ua: ua,
      lanxinVer: m ? m[1] : undefined,
      net: conn.effectiveType || (navigator.onLine ? 'online' : 'offline'),
    }
  }

  // ---------- console hook ----------
  var LEVELS = ['log', 'info', 'warn', 'error', 'debug']
  for (var ci = 0; ci < LEVELS.length; ci++) {
    ;(function (level) {
      var orig = console[level] || function () {}
      console[level] = function () {
        pushRing(logs, { level: level, text: redact(argsToText(arguments)), ts: now() }, 100)
        return orig.apply(console, arguments)
      }
    })(LEVELS[ci])
  }

  // ---------- 异常（即时推） ----------
  function recordError(kind, data) {
    data.kind = kind
    data.ts = now()
    pushRing(errors, data, 30)
    pushRing(logs, { level: 'error', text: '[' + kind + '] ' + (data.message || ''), ts: now() }, 100)
    sendEvent(kind === 'promise' ? 'unhandledrejection' : 'jserror', data)
  }
  window.addEventListener('error', function (e) {
    // 资源加载失败（捕获阶段，target 非 window）
    if (e && e.target && e.target !== window) {
      var t = e.target
      var src = t.src || t.href || ''
      if (src && !isSelfUrl(src)) {
        recordError('resource', { message: '资源加载失败: ' + truncate(src, 300) })
      }
      return
    }
    recordError('jserror', {
      message: String(e.message || ''),
      stack: e.error && e.error.stack ? String(e.error.stack) : undefined,
      source: e.filename,
      line: e.lineno,
    })
  }, true)
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    recordError('promise', {
      message: r instanceof Error ? r.message : truncate(String(r), 300),
      stack: r instanceof Error && r.stack ? String(r.stack) : undefined,
    })
  })

  // ---------- XHR hook ----------
  function extractErrcode(text) {
    if (typeof text !== 'string' || text.length > 200 * 1024) return undefined
    var m = text.match(/"errcode"\s*:\s*(-?\d+)/)
    return m ? Number(m[1]) : undefined
  }
  var XO = XMLHttpRequest.prototype.open
  var XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__br = { method: String(method || 'GET').toUpperCase(), url: String(url || ''), ts: 0 }
    return XO.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function (body) {
    var meta = this.__br
    if (meta && !isSelfUrl(meta.url)) {
      meta.ts = now()
      meta.reqBody = redact(truncate(typeof body === 'string' ? body : '', 1024))
      var xhr = this
      xhr.addEventListener('loadend', function () {
        var respText = ''
        try {
          if (!xhr.responseType || xhr.responseType === 'text') respText = xhr.responseText || ''
        } catch (e) {}
        pushRing(
          requests,
          {
            method: meta.method,
            url: truncate(meta.url, 500),
            status: xhr.status,
            errcode: extractErrcode(respText),
            ms: now() - meta.ts,
            reqBody: meta.reqBody,
            respBody: redact(truncate(respText, 1024)),
            ts: meta.ts,
          },
          50
        )
      })
    }
    return XS.apply(this, arguments)
  }

  // ---------- fetch hook ----------
  if (window.fetch) {
    var origFetch = window.fetch
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : ''
      var method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET'
      var start = now()
      var reqBody = redact(truncate(init && typeof init.body === 'string' ? init.body : '', 1024))
      var self = isSelfUrl(url)
      return origFetch.apply(this, arguments).then(function (resp) {
        if (!self) {
          var entry = {
            method: String(method).toUpperCase(),
            url: truncate(String(url), 500),
            status: resp.status,
            ms: now() - start,
            reqBody: reqBody,
            ts: start,
          }
          try {
            resp
              .clone()
              .text()
              .then(function (text) {
                entry.errcode = extractErrcode(text)
                entry.respBody = redact(truncate(text, 1024))
                pushRing(requests, entry, 50)
              })
              .catch(function () {
                pushRing(requests, entry, 50)
              })
          } catch (e) {
            pushRing(requests, entry, 50)
          }
        }
        return resp
      })
    }
  }

  // ---------- 路由轨迹 ----------
  var lastRoute = location.href
  function recordRoute() {
    if (location.href !== lastRoute) {
      pushRing(routes, { from: lastRoute, to: location.href, ts: now() }, 30)
      lastRoute = location.href
    }
  }
  for (var hi = 0; hi < 2; hi++) {
    ;(function (fnName) {
      var orig = history[fnName]
      history[fnName] = function () {
        var r = orig.apply(this, arguments)
        recordRoute()
        return r
      }
    })(hi === 0 ? 'pushState' : 'replaceState')
  }
  window.addEventListener('popstate', recordRoute)
  window.addEventListener('hashchange', recordRoute)

  // ---------- 点击轨迹（不记输入值，节流） ----------
  var lastClick = 0
  function selectorOf(el) {
    if (!el || !el.tagName) return ''
    var parts = []
    var cur = el
    for (var i = 0; i < 4 && cur && cur.tagName; i++) {
      var s = cur.tagName.toLowerCase()
      if (cur.id) {
        s += '#' + cur.id
        parts.unshift(s)
        break
      }
      if (cur.className && typeof cur.className === 'string') {
        s += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.')
      }
      parts.unshift(s)
      cur = cur.parentElement
    }
    return parts.join('>')
  }
  document.addEventListener('click', function (e) {
    var t = now()
    if (t - lastClick < 200) return
    lastClick = t
    if (panelRoot && panelRoot.contains(e.target)) return // 浮层自身操作不记
    var el = e.target
    var text = el && el.tagName === 'INPUT' ? '' : el && el.innerText ? truncate(el.innerText, 30) : ''
    pushRing(clicks, { selector: selectorOf(el), text: text, ts: t }, 30)
  }, true)

  // ---------- Vue / Vuex（best-effort 探测） ----------
  var vueStore = null
  var vueHooked = false
  function tryHookVue() {
    if (vueHooked) return
    var rootEl = document.getElementById('app') || document.body.firstElementChild
    var vm = rootEl && rootEl.__vue__
    var app3 = rootEl && rootEl.__vue_app__
    var Vue = window.Vue
    if (vm) {
      // Vue 2
      if (vm.$store) vueStore = vm.$store
      if (Vue && Vue.config && !Vue.config.__brErrHooked) {
        Vue.config.__brErrHooked = true
        var origErr = Vue.config.errorHandler
        Vue.config.errorHandler = function (err, instance, info) {
          var comp = instance && instance.$options ? instance.$options.name || instance.$options._componentTag : ''
          recordError('vue', {
            message: String((err && err.message) || err),
            stack: err && err.stack ? String(err.stack) : undefined,
            component: comp,
            info: info,
          })
          if (origErr) return origErr.apply(this, arguments)
        }
      }
    } else if (app3 && app3.config && app3.config.globalProperties) {
      vueStore = app3.config.globalProperties.$store || null
    }
    if (vueStore && typeof vueStore.subscribe === 'function') {
      vueHooked = true
      vueStore.subscribe(function (mutation) {
        pushRing(
          mutations,
          {
            type: mutation.type,
            payload: truncate(JSON.stringify(safeSerialize(mutation.payload)), 300),
            ts: now(),
          },
          50
        )
      })
    }
  }
  var vueTries = 0
  var vueTimer = setInterval(function () {
    tryHookVue()
    if (vueHooked || ++vueTries > 20) clearInterval(vueTimer)
  }, 1000)

  // ---------- 命令实现（白名单，禁 eval） ----------
  function snapshotData() {
    return {
      env: envInfo(),
      logs: logs.slice(),
      requests: requests.slice(),
      errors: errors.slice(),
      clicks: clicks.slice(),
      mutations: mutations.slice(-20),
      routes: routes.slice(),
    }
  }
  function vueStateData() {
    tryHookVue()
    if (!vueStore) return { error: '未探测到 Vuex store' }
    var state
    try {
      state = JSON.parse(redact(JSON.stringify(safeSerialize(vueStore.state, 1))))
    } catch (e) {
      state = '[序列化失败: ' + e.message + ']'
    }
    return { state: state, getters: Object.keys(vueStore.getters || {}) }
  }
  function domData() {
    var text = document.body ? document.body.innerText || '' : ''
    return {
      text: truncate(text, 2000),
      childCount: document.body ? document.body.children.length : 0,
      blank: text.trim().length < 10,
      viewport: { w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY },
    }
  }
  function perfData() {
    var out = {}
    try {
      var nav = performance.getEntriesByType('navigation')[0]
      if (nav) out.timing = { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) }
      if (performance.memory) {
        out.memory = {
          usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
          limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
        }
      }
      var longtasks = performance.getEntriesByType('longtask')
      out.longtasks = longtasks.length
    } catch (e) {}
    return out
  }
  function storageData() {
    function keysOf(store) {
      var out = []
      try {
        for (var i = 0; i < store.length; i++) {
          var k = store.key(i)
          var sensitive = false
          for (var j = 0; j < REDACT_KEYS.length; j++) {
            if (k.toLowerCase().indexOf(REDACT_KEYS[j]) >= 0) {
              sensitive = true
              break
            }
          }
          // 敏感键只报键名+存在性；非敏感键值截断
          out.push({ key: k, value: sensitive ? '***' : truncate(store.getItem(k) || '', 100), redacted: sensitive })
        }
      } catch (e) {}
      return out
    }
    return {
      localStorage: keysOf(localStorage),
      sessionStorage: keysOf(sessionStorage),
      cookieKeys: (document.cookie || '').split(';').map(function (c) {
        return c.split('=')[0].trim()
      }).filter(Boolean),
    }
  }
  var COMMANDS = {
    get_snapshot: function () {
      return snapshotData()
    },
    get_vue_state: function () {
      return vueStateData()
    },
    get_vuex_trace: function () {
      return { mutations: mutations.slice() }
    },
    get_breadcrumbs: function () {
      return { clicks: clicks.slice(), routes: routes.slice() }
    },
    get_dom: function () {
      return domData()
    },
    get_perf: function () {
      return perfData()
    },
    get_storage: function () {
      return storageData()
    },
  }

  // ---------- ws 通道 ----------
  var ws = null
  var wsState = 'init' // init/connecting/online/retry
  var retryDelay = 1000
  var sessionId = sessionStorage.getItem('bugrelay_sid')
  if (!sessionId) {
    sessionId = 's' + now().toString(36) + Math.random().toString(36).slice(2, 8)
    sessionStorage.setItem('bugrelay_sid', sessionId)
  }

  function wsUrl() {
    return SERVER.replace(/^http/, 'ws') + '/bugrelay/ws'
  }
  function hello() {
    send({
      type: 'hello',
      sessionId: sessionId,
      page: envInfo(),
      route: location.pathname + location.hash,
      caps: ['snapshot', 'vuex', 'trace', 'breadcrumbs', 'dom', 'perf', 'storage'],
    })
  }
  function send(obj) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(obj))
      } catch (e) {}
    }
  }
  function sendEvent(kind, data) {
    send({ type: 'event', sessionId: sessionId, kind: kind, data: safeSerialize(data, 1) })
  }
  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return
    wsState = 'connecting'
    updateStatus()
    try {
      ws = new WebSocket(wsUrl())
    } catch (e) {
      scheduleRetry()
      return
    }
    ws.onopen = function () {
      wsState = 'online'
      retryDelay = 1000
      hello()
      updateStatus()
    }
    ws.onmessage = function (e) {
      var msg
      try {
        msg = JSON.parse(e.data)
      } catch (err) {
        return
      }
      if (msg.type === 'ping') {
        send({ type: 'pong', sessionId: sessionId })
      } else if (msg.type === 'command') {
        var fn = COMMANDS[msg.cmd]
        if (!fn) {
          send({ type: 'result', sessionId: sessionId, cmdId: msg.cmdId, ok: false, error: '未知命令: ' + msg.cmd })
          return
        }
        var out, ok = true, errMsg
        try {
          out = fn(msg.params || {})
        } catch (err2) {
          ok = false
          errMsg = String(err2 && err2.message ? err2.message : err2)
        }
        send({ type: 'result', sessionId: sessionId, cmdId: msg.cmdId, ok: ok, data: ok ? out : undefined, error: errMsg })
      }
    }
    ws.onclose = function () {
      wsState = 'retry'
      updateStatus()
      scheduleRetry()
    }
    ws.onerror = function () {
      // onclose 随后触发重连
    }
  }
  function scheduleRetry() {
    setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)
  }
  connect()

  // ---------- 浮层（可拖拽圆钮 + 半屏 panel） ----------
  var panelRoot = null
  var fab = null
  var panelVisible = false
  var activeTab = 'requests'
  var CSS =
    '#__br_fab{position:fixed;right:16px;bottom:80px;width:44px;height:44px;border-radius:50%;' +
    'background:#e6a23c;color:#fff;font:700 12px/44px sans-serif;text-align:center;cursor:move;' +
    'z-index:2147483000;box-shadow:0 2px 8px rgba(0,0,0,.3);user-select:none}' +
    '#__br_fab.on{background:#67c23a}#__br_fab.off{background:#f56c6c}' +
    '#__br_panel{position:fixed;left:0;right:0;bottom:0;height:50%;background:#1e1e1e;color:#ddd;' +
    'z-index:2147483000;font:12px/1.5 monospace;display:flex;flex-direction:column;' +
    'box-shadow:0 -2px 12px rgba(0,0,0,.4)}' +
    '#__br_panel .br-tabs{display:flex;border-bottom:1px solid #333;flex:none}' +
    '#__br_panel .br-tab{padding:6px 10px;cursor:pointer;color:#999;white-space:nowrap}' +
    '#__br_panel .br-tab.act{color:#fff;border-bottom:2px solid #e6a23c}' +
    '#__br_panel .br-body{flex:1;overflow:auto;padding:6px 10px}' +
    '#__br_panel .br-row{padding:2px 0;border-bottom:1px solid #2a2a2a;word-break:break-all}' +
    '#__br_panel .br-err{color:#f56c6c}#__br_panel .br-warn{color:#e6a23c}#__br_panel .br-ok{color:#67c23a}' +
    '#__br_panel .br-dim{color:#777}' +
    '#__br_panel .br-btn{padding:6px 10px;background:#333;color:#ddd;border:none;cursor:pointer;margin:4px}'

  function el(tag, cls, text) {
    var d = document.createElement(tag)
    if (cls) d.className = cls
    if (text != null) d.textContent = text
    return d
  }
  function updateStatus() {
    if (!fab) return
    fab.className = wsState === 'online' ? 'on' : wsState === 'connecting' ? '' : 'off'
    fab.textContent = wsState === 'online' ? 'BR●' : 'BR○'
  }
  function esc(s) {
    var d = document.createElement('div')
    d.textContent = String(s)
    return d.innerHTML
  }
  var TABS = [
    ['requests', '请求'],
    ['logs', '日志'],
    ['errors', '异常'],
    ['vuex', 'Vuex'],
    ['trace', '轨迹'],
    ['status', '状态'],
  ]
  function renderBody(body) {
    body.innerHTML = ''
    function row(html, cls) {
      var d = el('div', 'br-row ' + (cls || ''))
      d.innerHTML = html
      body.appendChild(d)
    }
    if (activeTab === 'requests') {
      var rs = requests.slice(-50).reverse()
      if (!rs.length) row('暂无请求', 'br-dim')
      for (var i = 0; i < rs.length; i++) {
        var r = rs[i]
        var bad = (r.status >= 400) || (r.errcode != null && r.errcode !== 200)
        row(
          esc(r.method) + ' ' + esc(r.url) +
            ' <span class="' + (bad ? 'br-err' : 'br-ok') + '">' + esc(r.status) +
            (r.errcode != null ? ' errcode=' + esc(r.errcode) : '') + '</span> ' +
            '<span class="br-dim">' + esc(r.ms) + 'ms</span>',
          bad ? 'br-err' : ''
        )
      }
    } else if (activeTab === 'logs') {
      var ls = logs.slice(-80).reverse()
      if (!ls.length) row('暂无日志', 'br-dim')
      for (var j = 0; j < ls.length; j++) {
        var l = ls[j]
        row('<span class="br-dim">[' + esc(l.level) + ']</span> ' + esc(l.text), l.level === 'error' ? 'br-err' : l.level === 'warn' ? 'br-warn' : '')
      }
    } else if (activeTab === 'errors') {
      var es = errors.slice().reverse()
      if (!es.length) row('暂无异常', 'br-dim')
      for (var k = 0; k < es.length; k++) {
        var er = es[k]
        row('[' + esc(er.kind) + '] ' + esc(er.message) + (er.component ? ' @' + esc(er.component) : ''), 'br-err')
      }
    } else if (activeTab === 'vuex') {
      var ms = mutations.slice(-30).reverse()
      if (!ms.length) row(vueStore ? '暂无 mutation' : '未探测到 Vuex store', 'br-dim')
      for (var m2 = 0; m2 < ms.length; m2++) {
        row(esc(ms[m2].type) + ' <span class="br-dim">' + esc(ms[m2].payload || '') + '</span>')
      }
    } else if (activeTab === 'trace') {
      var cs2 = clicks.slice(-30).reverse()
      if (!cs2.length) row('暂无点击轨迹', 'br-dim')
      for (var c2 = 0; c2 < cs2.length; c2++) {
        row(esc(cs2[c2].selector) + ' <span class="br-dim">' + esc(cs2[c2].text || '') + '</span>')
      }
    } else if (activeTab === 'status') {
      row('ws: <span class="' + (wsState === 'online' ? 'br-ok' : 'br-err') + '">' + esc(wsState) + '</span>')
      row('server: ' + esc(SERVER), 'br-dim')
      row('sessionId: ' + esc(sessionId), 'br-dim')
      row('请求 ' + requests.length + ' / 日志 ' + logs.length + ' / 异常 ' + errors.length + ' / 点击 ' + clicks.length, 'br-dim')
      var btn = el('button', 'br-btn', '复制 snapshot')
      btn.onclick = function () {
        var text = JSON.stringify(snapshotData())
        copyText(text, function () {
          btn.textContent = '已复制 ✓'
          setTimeout(function () {
            btn.textContent = '复制 snapshot'
          }, 1500)
        })
      }
      body.appendChild(btn)
    }
  }
  function copyText(text, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(cb, function () {
        fallbackCopy(text, cb)
      })
    } else {
      fallbackCopy(text, cb)
    }
  }
  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch (e) {}
    document.body.removeChild(ta)
    if (cb) cb()
  }
  function togglePanel() {
    panelVisible = !panelVisible
    if (panelRoot) panelRoot.style.display = panelVisible ? 'flex' : 'none'
    if (panelVisible) renderPanel()
  }
  function renderPanel() {
    if (!panelRoot || !panelVisible) return
    var tabs = panelRoot.querySelector('.br-tabs')
    tabs.innerHTML = ''
    for (var i = 0; i < TABS.length; i++) {
      ;(function (key, label) {
        var t = el('div', 'br-tab' + (activeTab === key ? ' act' : ''), label)
        t.onclick = function () {
          activeTab = key
          renderPanel()
        }
        tabs.appendChild(t)
      })(TABS[i][0], TABS[i][1])
    }
    renderBody(panelRoot.querySelector('.br-body'))
  }
  function mountOverlay() {
    if (fab || !document.body) return
    var style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    fab = el('div', '', 'BR○')
    fab.id = '__br_fab'
    updateStatus()
    // 拖拽与点击区分：位移 >5px 视为拖拽
    var drag = null
    fab.addEventListener('touchstart', startDrag, { passive: true })
    fab.addEventListener('mousedown', startDrag)
    function startDrag(e) {
      var p = e.touches ? e.touches[0] : e
      drag = { x: p.clientX, y: p.clientY, moved: false }
      var move = function (ev) {
        if (!drag) return
        var q = ev.touches ? ev.touches[0] : ev
        var dx = q.clientX - drag.x
        var dy = q.clientY - drag.y
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true
        if (drag.moved) {
          fab.style.right = Math.max(0, window.innerWidth - q.clientX - 22) + 'px'
          fab.style.bottom = Math.max(0, window.innerHeight - q.clientY - 22) + 'px'
        }
        if (ev.cancelable && drag.moved) ev.preventDefault()
      }
      var up = function () {
        document.removeEventListener('touchmove', move)
        document.removeEventListener('touchend', up)
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        if (drag && !drag.moved) togglePanel()
        drag = null
      }
      document.addEventListener('touchmove', move, { passive: false })
      document.addEventListener('touchend', up)
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    }
    document.body.appendChild(fab)

    panelRoot = el('div')
    panelRoot.id = '__br_panel'
    panelRoot.style.display = 'none'
    panelRoot.appendChild(el('div', 'br-tabs'))
    panelRoot.appendChild(el('div', 'br-body'))
    document.body.appendChild(panelRoot)
  }
  if (document.body) mountOverlay()
  else document.addEventListener('DOMContentLoaded', mountOverlay)

  // 面板开着时 2s 自刷
  setInterval(function () {
    if (panelVisible) renderPanel()
    updateStatus()
  }, 2000)

  // ---------- 控制台手动入口 ----------
  window.__bugrelay = {
    snapshot: snapshotData,
    sessionId: sessionId,
    server: SERVER,
    state: function () {
      return { ws: wsState, requests: requests.length, logs: logs.length, errors: errors.length }
    },
  }
})()
