export type ContextBarCategory = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer'
}

export type ContextBarSnapshot = {
  categories: ContextBarCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold: number | null
  // Null where the host keeps no cost ledger, so the bar shows nothing rather than $0.00.
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isShown: boolean; snapshot: ContextBarSnapshot | null }
  }
}
