import type { Hono } from 'hono'

/** 各 feature 向共享 Hono app 挂载路由 */
export type FeatureMount = (app: Hono) => void
