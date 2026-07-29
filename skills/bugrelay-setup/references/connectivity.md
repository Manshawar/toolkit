# bugrelay 连通矩阵与排错

接入第 4 步展开。默认端口 9527（`BUGRELAY_PORT` 可覆盖，snippet 与 collector 随之变化）。

## 连通矩阵

| 入口 | 链路 | 配置 |
|---|---|---|
| 蓝信 PC 客户端 webview（与 tkt 同机） | webview → `127.0.0.1:9527` 直连 | 零配置，最稳主力场景（CEF 视 loopback 为安全上下文） |
| PC Chrome dev | localhost / LAN IP 直连 | 零配置 |
| 蓝信 app Android + USB | 手机 `127.0.0.1:9527` → adb 映射 PC | `adb reverse tcp:9527 tcp:9527` |
| 蓝信 app iOS / 无 USB | 同 WiFi → PC 局域网 IP | 页面 URL 加 `?bugrelay_server=http://<PC_IP>:9527`，collector 读取并持久化到 localStorage |

服务监听 `0.0.0.0`，局域网 IP 直连无需额外配置。

## https → loopback（PNA）

https 页面访问 `http://127.0.0.1:9527`：Chromium 视 loopback 为安全上下文，不算 mixed content；但 Chrome 94+ 有 Private Network Access 预检。bugrelay 的 OPTIONS 响应已带 `Access-Control-Allow-Private-Network: true`，理论放行。蓝信 webview / CEF 内核版本不一，**真机首验**。

拦死的退路（按序）：
1. collector.js 放目标项目 `public/` 打进镜像同源加载（script 无 mixed content），上报地址不变
2. mkcert 本地证书让 bugrelay 起 https
3. 退回局域网 http（要求测试环境页面本身为 http）

## 排错（浮层圆钮不变绿）

| 现象 | 查 |
|---|---|
| 圆钮都没有 | 注入没生效：确认构建时 `ENV=staging` 生效（构建产物 dist/index.html 里搜 collector.js）、script 在 `<head>` 最前、`localStorage bugrelay_off` 非 1 |
| 圆钮红色（BR○） | ws 连不上：手机 adb reverse 是否执行；iOS `?bugrelay_server=` 的 IP 是否为 PC 当前局域网 IP；PC 防火墙拦 9527 |
| 绿色但面板无数据 | 采集在页面加载后才开始——早期请求抓不到是预期；操作页面再看计数 |
| 分析页无会话 | 同上 ws 链路；`tkt bugrelay doctor` 看在线会话数 |

## 服务地址优先级

`?bugrelay_server=` query（持久化 localStorage）> localStorage `bugrelay_server` > collector 脚本自身源 > `http://127.0.0.1:9527`。
