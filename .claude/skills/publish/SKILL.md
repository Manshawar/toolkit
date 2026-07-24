---
name: publish
description: npm publish @manshawar/tkt — bump version, build, publish, git tag + push
---

# publish

IRON LAW: 永远先 bump → build → publish 三步，不可跳过 build 直接 publish。publish 前确认版本号和变更摘要。

## 触发词

`/publish`、`发布`、`publish`、`版本发布`

## Workflow

```
- [ ] Step 1: 确认变更 ⚠️ REQUIRED
  - [ ] 1.1 查看 git diff，总结本次变更
  - [ ] 1.2 确认 bump 类型（patch / minor / major）
- [ ] Step 2: Bump + Build + Publish ⛔ BLOCKING
  - [ ] 2.1 npm version <patch|minor|major>
  - [ ] 2.2 pnpm build（build 失败则终止）
  - [ ] 2.3 pnpm publish
- [ ] Step 3: Git push
  - [ ] 3.1 git push origin main
  - [ ] 3.2 git push origin <tag>
```

## 执行

### Step 1 — 确认变更

向用户展示即将发布的变更摘要和 bump 类型。重要：publish 操作不可逆，必须确认。

### Step 2 — Bump → Build → Publish

```bash
npm version <patch|minor|major>   # 1. bump，自动生成 tag
pnpm build                        # 2. build，失败即终止
pnpm publish                      # 3. 发布
```

### Step 3 — 推送到远端

```bash
git push origin main
git push origin v<version>
```

## Anti-Patterns

- ❌ 跳过 build 直接 publish（prepublishOnly 虽会触发 build，但显式跑一次更快看到错误）
- ❌ 不 push tag 到远端
- ❌ 不确认变更内容就 bump
- ❌ 用 `--no-git-tag-version` 跳过 tag（npm version 自动 tag 是好的）
