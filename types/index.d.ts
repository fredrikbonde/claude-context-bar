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
  // The plan's usage windows as /usage shows them; null off a subscription or before the first API response reports one.
  fiveHour: UsageWindow | null
  week: UsageWindow | null
  // Model id with the vendor prefix dropped, e.g. "opus-5-5".
  model: string
  // Epoch milliseconds the session started.
  startedAt: number
  // Share of the last API call's input served from the prompt cache; null before the first call.
  cacheHitPercent: number | null
}

// One reading taken at session start and after each turn; the history behind the growth, pace and sparkline stats.
export type TurnSample = {
  tokens: number
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      isShown: boolean
      isCompact: boolean
      snapshot: ContextBarSnapshot | null
      turns: TurnSample[]
      compactions: number
      toolCalls: number
    }
  }
}
