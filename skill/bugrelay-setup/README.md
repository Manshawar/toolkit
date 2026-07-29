# bugrelay-setup

把任意 H5 项目接入 [tkt bugrelay](../../readme.md#tkt-bugrelay--ai-辅助-bug-归属分析) 的 agent skill —— 接入 SOP，不含功能逻辑（collector、ws 服务、AI 分析全在 CLI 里）。

## 安装

```bash
npx skills add Manshawar/toolkit
```

前置：`npm i @manshawar/tkt -g`（skill 只指挥 `tkt bugrelay` 子命令干活）。

## 触发

对 agent 说「接入 bugrelay」「staging 注入采集」「手机 webview 抓请求」「bug 归属分析」等，skill 自动加载。

## 内容

| 文件 | 作用 |
|---|---|
| `SKILL.md` | 接入流程：起服务 → 检测构建工具 → staging 门控注入（vue-cli chainWebpack / vite transformIndexHtml）→ 连通配置 → doctor 验证；含反模式与交付检查 |
| `references/connectivity.md` | 连通矩阵（PC webview / adb reverse / iOS 局域网）、https→loopback PNA 说明、浮层排错表 |

## 注入方式速览

staging 构建期门控（`process.env.ENV === 'staging'`），产物仅一行远程 URL：

```html
<script src="http://127.0.0.1:9527/bugrelay/collector.js" async></script>
```

CI/构建机零依赖；collector 由访问者本机的 `tkt bugrelay` 服务响应，升级 tkt 即更新。生产构建不含注入，天然免疫。
