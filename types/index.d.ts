export type ContextBarCategory = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer'
}

export type UsageWindow = {
  percentUsed: number
  // Epoch milliseconds; null when the response did not say when the window resets.
  resetsAt: number | null
}

export type ContextBarSnapshot = {
  categories: ContextBarCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold: number | null
  // Null where the host keeps no cost ledger, so the bar shows nothing rather than $0.00.
  costUsd: number | null
  // The plan's usage windows as /usage shows them; null (drawn as "?") when the account has no such limit or no API
  // response has reported one yet.
  fiveHour: UsageWindow | null
  week: UsageWindow | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isShown: boolean; snapshot: ContextBarSnapshot | null }
  }
}
