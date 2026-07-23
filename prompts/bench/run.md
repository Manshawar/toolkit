# bench.run

Agent 驱动 `tkt bench` / `tkt ui` 做网关模型测速。先 `tkt prompt show bench.run`，再只跑下方 CLI。

## 分工

| 谁 | 做什么 |
| --- | --- |
| `tkt config` | 写/查 `AI_BASE_URL` · `AI_API_KEY` · `AI_MODEL` |
| `tkt bench` | 拉 `/v1/models`、流式测 TTFT+Total、打表、写 history |
| `tkt ui` | 单端口 Hono；页面 `/bench`，API `/api/bench/*` |
| 你 | 选 CLI/UI、缺配置时引导 `tkt config`、把排行与推荐贴给用户 |

禁止：手写 curl、浏览器直连网关塞 key、另起 Express/Vite 端口、聊天回显完整 key。

## 命令契约

### 配置

```bash
tkt config          # 缺则停，引导填写；勿让用户把真实 key 贴回对话
tkt config --show   # Key 脱敏
```

### CLI 测速

```bash
tkt bench [--rounds N] [--sort ttft|total] [-c N] [--stagger MS] \
  [--models a,b] [--exclude a,b] [--json] [--no-save]
```

- 出：排行表（或 `--json`）；history → `~/.config/tkt/bench/history/`
- 必须是 **stream 首包 TTFT** + Total；列表来自网关（或用户 `--models`）

### UI

```bash
tkt ui [--port N]         # 默认 8787；打印 http://127.0.0.1:端口/bench
tkt bench ui [--port N]   # 同上
```

- 定时探测跑在 **该 Node 进程**（可关浏览器）；状态 `~/.config/tkt/bench/watch-state.json`
- 告知 URL + Ctrl+C 结束

## 你何时跑什么

1. 用户要页面/可视化 → `tkt ui`；否则 → `tkt bench`
2. 缺 AI env → 只指导 `tkt config`，不继续测
3. CLI 结束后交付必须含：TTFT+Total 排行、一句「现在优先用 `<model>`（…）」、失败原因（若有）

## 禁止

- 非流式 / 只比总耗时冒充首包  
- 瞎编模型列表  
- 硬编码公司主机名（示例用 `example.com`）  
- 用墙钟「结束时刻」排序  
