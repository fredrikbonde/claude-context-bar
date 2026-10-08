import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextBarCategory, ContextBarSnapshot } from '../types'

const COMMAND = 'context-bar'
const isShown = atom({ plugin: 'context-bar', key: 'isShown' } as const, true)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)

const CELL_CHAR: Record<ContextBarCategory['kind'], string> = {
  used: '█',
  free: '░',
  buffer: '▒',
}

// 'summary' estimates locally; 'full' would send a token-count request per tool and memory file on every refresh.
async function refresh($: EngineInterface): Promise<void> {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const breakdown = context.breakdown
  if (!breakdown) {
    return
  }

  const categories: ContextBarCategory[] = []
  for (const c of breakdown.categories) {
    if (c.kind !== 'deferred') {
      categories.push({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })
    }
  }

  const next: ContextBarSnapshot = {
    categories,
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    percentage: breakdown.percentage,
    autoCompactThreshold:
      breakdown.isAutoCompactEnabled && breakdown.autoCompactThreshold !== undefined
        ? breakdown.autoCompactThreshold
        : null,
  }
  await update($, snapshot, () => next)
}

// Background refreshes run after the engine's own work: a failed measurement must not fail the tool call, turn or
// compaction it rides on, so it is reported in the transcript and the band keeps its last reading.
async function refreshAfter($: EngineInterface, where: string): Promise<void> {
  try {
    await refresh($)
  } catch (error) {
    $.ui.log(`context-bar: refresh after ${where} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${trimZero((tokens / 1_000_000).toFixed(1))}M`
  }
  if (tokens >= 10_000) {
    return `${Math.round(tokens / 1000)}k`
  }
  if (tokens >= 1000) {
    return `${trimZero((tokens / 1000).toFixed(1))}k`
  }
  return `${tokens}`
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function formatShare(tokens: number, max: number): string {
  const share = (tokens / max) * 100
  return share < 1 ? `${share.toFixed(1)}%` : `${Math.round(share)}%`
}

export type BarRun = { color: string; text: string }

// Largest-remainder rounding so the runs fill exactly `width` cells, and any non-empty category keeps at least one.
export function layoutBar(s: ContextBarSnapshot, width: number): BarRun[] {
  const visible = s.categories.filter(c => c.tokens > 0)
  const exact = visible.map(c => (c.tokens / s.maxTokens) * width)
  const cells = exact.map(x => Math.max(1, Math.floor(x)))
  let spare = width - cells.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest)
  for (let k = 0; spare > 0 && order.length > 0; k = (k + 1) % order.length) {
    cells[order[k]!.i]! += 1
    spare -= 1
  }
  // Over the window, or many 1-cell minimums: take the excess from the widest runs.
  while (spare < 0) {
    const widest = cells.indexOf(Math.max(...cells))
    cells[widest]! -= 1
    spare += 1
  }

  const glyphs: { color: string; char: string }[] = []
  visible.forEach((c, i) => {
    for (let n = 0; n < cells[i]!; n++) {
      glyphs.push({ color: c.color, char: CELL_CHAR[c.kind] })
    }
  })

  if (s.autoCompactThreshold !== null && s.autoCompactThreshold < s.maxTokens) {
    const at = Math.min(width - 1, Math.floor((s.autoCompactThreshold / s.maxTokens) * width))
    if (glyphs[at]) {
      glyphs[at] = { color: 'warning', char: '│' }
    }
  }

  const runs: BarRun[] = []
  for (const g of glyphs) {
    const last = runs[runs.length - 1]
    if (last && last.color === g.color) {
      last.text += g.char
    } else {
      runs.push({ color: g.color, text: g.char })
    }
  }
  return runs
}

function percentColor(percentage: number): string {
  if (percentage >= 80) return 'error'
  if (percentage >= 50) return 'warning'
  return 'success'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle the context window bar above the prompt',
    })
    const result = await next(e)
    await refreshAfter($, 'session start')

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    const shown = !(await read($, isShown))
    await update($, isShown, () => shown)
    if (shown) {
      await refresh($)
    }

    return { text: shown ? 'Context bar shown.' : 'Context bar hidden.' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isShown)) {
      await refreshAfter($, e.tool)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshAfter($, 'turn')

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refreshAfter($, 'compaction')

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    if (s === null) {
      return <Text dimColor>◆ context · measuring…</Text>
    }

    const width = Math.max(10, e.props.bodyColumns)
    const runs = layoutBar(s, width)
    const legend = s.categories.filter(c => c.kind === 'used' && c.tokens > 0)

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between">
          <Text color="claude">◆ context</Text>
          <Text>
            <Text bold>{formatTokens(s.totalTokens)}</Text>
            <Text dimColor> of {formatTokens(s.maxTokens)}</Text>
            {s.autoCompactThreshold !== null && (
              <Text dimColor> · compacts at {formatTokens(s.autoCompactThreshold)}</Text>
            )}{' '}
            <Text inverse color={percentColor(s.percentage)}>
              {' '}
              {Math.round(s.percentage)}%{' '}
            </Text>
          </Text>
        </Box>
        <Box>
          {runs.map(r => (
            <Text color={r.color}>{r.text}</Text>
          ))}
        </Box>
        <Box flexWrap="wrap" columnGap={3}>
          {legend.map(c => (
            <Text>
              <Text color={c.color}>▌</Text> {c.name.toLowerCase()} {formatTokens(c.tokens)}{' '}
              <Text dimColor>{formatShare(c.tokens, s.maxTokens)}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
