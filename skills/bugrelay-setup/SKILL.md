---
name: bugrelay-setup
description: "把任意 H5 项目接入 tkt bugrelay（AI 辅助 bug 归属分析：ws 采集页面日志/请求/Vuex，Claude 判定前后端归属并出结构化报告）。当用户说「接入 bugrelay」「注入 bug 采集」「测试环境采集日志」「staging 注入 vconsole/collector」「手机 webview 抓请求」「bug 归属分析」「前后端归属判定」时使用。Actions: setup, inject, onboard, connect, troubleshoot bugrelay。场景：vue-cli chainWebpack / vite transformIndexHtml 按 staging 环境变量门控注入、adb reverse 安卓真机、iOS 局域网、蓝信 webview 连通排错。"
---

# bugrelay-setup

**Iron Law：所有动作落到 `tkt bugrelay` 子命令。skill 不含逻辑——不手写 collector、不手写服务。注入走构建配置 + `process.env.ENV === 'staging'` 门控（与公司 vconsole 同款姿势）；生产免疫靠构建期门控，不靠域名白名单。**

## 前置 ⛔ BLOCKING

`tkt` 已全局安装（`npm i @manshawar/tkt -g`）且版本含 bugrelay（`tkt bugrelay --help` 有输出）。未装先装。

## 接入流程

```
- [ ] 1. 启动服务 ⚠️ REQUIRED
- [ ] 2. 检测构建工具（vue-cli / vite）⚠️ REQUIRED
- [ ] 3. 构建配置注入 collector（staging 门控，head 最前）⚠️ REQUIRED
- [ ] 4. 按使用入口配置连通
- [ ] 5. --add-dir 挂源码（要 file:line 定位时）
- [ ] 6. doctor + 浮层验证 ⚠️ REQUIRED
```

### 1. 启动服务

```bash
tkt bugrelay        # 长驻，固定 :9527，占用报错不顺延
```

另开终端后续操作，或 `tkt bugrelay ui` 直接开分析页。

### 2. 检测构建工具

| 标志文件 | 构建工具 | 跳 |
|---|---|---|
| `vue.config.js` | vue-cli | 3A |
| `vite.config.*` | vite | 3B |

### 3A. vue-cli 注入

`vue.config.js` 经 chainWebpack 给 html 模板传参（与项目里 `externalJs` 注入 vconsole 同机制）：

```js
// vue.config.js
chainWebpack: config => {
  config.plugin('html').tap(args => {
    if (process.env.ENV === 'staging') {
      args[0].bugrelayCollector = 'http://127.0.0.1:9527/bugrelay/collector.js'
    }
    return args
  })
}
```

`public/index.html` `<head>` 内、所有其他 `<script>` **之前**：

```html
<% if (htmlWebpackPlugin.options.bugrelayCollector) { %>
<script src="<%= htmlWebpackPlugin.options.bugrelayCollector %>" async></script>
<% } %>
```

项目若已有 `externalJs` 数组式注入位，直接条件追加 `'http://127.0.0.1:9527/bugrelay/collector.js'` 亦可，效果等同。

### 3B. vite 注入

`vite.config.ts` 加本地插件：

```ts
{
  name: 'bugrelay-inject',
  apply: 'build',                    // staging 是构建部署；dev 自验可改 'serve'
  transformIndexHtml: {
    order: 'pre',                    // head 最前
    handler: () =>
      process.env.ENV === 'staging'
        ? [{
            tag: 'script',
            attrs: { src: 'http://127.0.0.1:9527/bugrelay/collector.js', async: true },
            injectTo: 'head-prepend',
          }]
        : [],
  },
}
```

公司若用 `vite build --mode staging`，改用 `defineConfig(({ mode }) => ...)` + `mode === 'staging'` 更贴 vite 惯例；CI 注环境变量则 `process.env.ENV` 即可。

### 3C. 兜底：无构建配置入口（纯静态页）

`tkt bugrelay snippet` 取白名单片段贴 `<head>` 最前。仅兜底，常规项目不用。

### 4. 连通（按入口选一）

| 入口 | 动作 |
|---|---|
| PC 浏览器 / PC 客户端 webview（与 tkt 同机） | 零配置 |
| Android 真机 + USB | `adb reverse tcp:9527 tcp:9527` |
| iOS / 无 USB | 页面 URL 加 `?bugrelay_server=http://<PC局域网IP>:9527`（IP 用 `tkt bugrelay snippet` 输出里的） |

注意：注入写死 `127.0.0.1:9527` 不影响 iOS——collector 运行时按 `?bugrelay_server=` query > localStorage > 脚本源 覆盖服务地址。连通矩阵与 https→loopback 排错见 [references/connectivity.md](references/connectivity.md)。

### 5. 挂源码（要 file:line 定位时）

```bash
tkt bugrelay --add-dir <目标项目 src 绝对路径>    # 持久化，可多次
```

### 6. 验证 ⚠️ REQUIRED

```bash
tkt bugrelay doctor    # 端口 / claude CLI / adb / add_dirs / 在线会话
```

- **构建产物确认**：staging 构建出的 `dist/index.html` 含 collector script；非 staging 构建产物不含
- 手机端右下角圆钮变绿（BR●）= collector 活着且 ws 连上；点圆钮开面板看采集计数
- 分析页 `http://127.0.0.1:9527/bugrelay` 左栏出现会话

## 反模式

- ❌ 不加 staging 门控直接注入——生产环境会带着采集脚本上线
- ❌ 用域名白名单替代 staging 门控——公司约定是构建期环境变量，两套防线混用难维护
- ❌ 把 script 注入到 `<body>` 或 `<head>` 末尾——collector 加载前的请求抓不到
- ❌ vite 插件只写 `apply: 'serve'`——staging 是 build 部署，serve 只在本地 dev 生效
- ❌ 手写 eruda/vConsole 替代 collector——看不到 ws 状态且双份采集
- ❌ 改 collector.js 源码适配单项目——collector 由 tkt host，改源码全项目生效
- ❌ 让服务自动顺延端口——adb reverse 与 collector 默认地址都要求 9527 稳定

## 交付前检查

- [ ] `tkt bugrelay doctor` 全绿
- [ ] 注入逻辑包在 `process.env.ENV === 'staging'`（或 vite `mode === 'staging'`）内
- [ ] collector script 在 `<head>` 第一个 `<script>` 位置（head-prepend / 模板顶部）
- [ ] staging 构建产物含 collector，生产构建产物不含
- [ ] 目标入口连通方式已配置（adb reverse 或 ?bugrelay_server=）
- [ ] 浮层圆钮绿色，面板内请求/日志计数 > 0
- [ ] 分析页选中会话 → 提问 → 出归属结论
