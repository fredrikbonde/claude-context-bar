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
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { isShown: boolean; snapshot: ContextBarSnapshot | null }
  }
}
