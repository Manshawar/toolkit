export interface QuotaWindow {
  label: string
  remainingPercent: number
  remainsMs?: number
  resetAt?: Date
  used?: number
  total?: number
}

export interface UsageModel {
  name: string
  windows: QuotaWindow[]
  meta?: Record<string, string>
}

export interface UsageSnapshot {
  provider: string
  displayName: string
  fetchedAt: Date
  models: UsageModel[]
}

export interface UsageProvider {
  id: string
  displayName: string
  fetchUsage(): Promise<UsageSnapshot>
}
