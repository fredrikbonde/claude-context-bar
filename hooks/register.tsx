import { atom, read, update } from 'claude-code'
import type { ReactNode } from 'react'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { ContextBarCategory, ContextBarSnapshot, TurnSample, UsageWindow } from '../types'

const COMMAND = 'context-bar'
const isShown = atom({ plugin: 'context-bar', key: 'isShown' } as const, true)
const isCompact = atom({ plugin: 'context-bar', key: 'isCompact' } as const, false)
const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const turns = atom({ plugin: 'context-bar', key: 'turns' } as const, [])
const compactions = atom({ plugin: 'context-bar', key: 'compactions' } as const, 0)
const toolCalls = atom({ plugin: 'context-bar', key: 'toolCalls' } as const, 0)

const MAX_TURNS = 30
const SPARK_TURNS = 20
const GROWTH_TURNS = 5
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const SPARK = '▁▂▃▄▅▆▇█'
// A category holding this share of the used tokens is called out in the stats row.
const TOP_CATEGORY_SHARE = 60
// Pace is meaningless right after a window opens: 2% used in the first minute would "project" to hundreds of percent.
const MIN_ELAPSED_SHARE = 0.05
// Projected usage at reset is only worth a glance once it nears the limit.
const PROJECTION_SHOWN_FROM = 80

const CELL_CHAR: Record<ContextBarCategory['kind'], string> = {
  used: '█',
  free: '░',
  buffer: '▒',
}

// 'summary' estimates locally; 'full' would send a token-count request per tool and memory file on every refresh.
async function refresh($: EngineInterface): Promise<void> {
  const { startedAt, context, cost, rateLimits } = await $.session.usage({ breakdown: 'summary' })
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
    costUsd: cost?.usd ?? null,
    fiveHour: usageWindow($, rateLimits, 'five_hour'),
    week: usageWindow($, rateLimits, 'seven_day'),
    model: breakdown.model.replace(/^claude-/, ''),
    startedAt,
    cacheHitPercent: cacheHit(breakdown.apiUsage),
  }
  await update($, snapshot, () => next)
}

type ApiUsage = { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }

function cacheHit(usage: ApiUsage | null): number | null {
  if (!usage) {
    return null
  }
  const input = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
  return input > 0 ? (usage.cache_read_input_tokens / input) * 100 : null
}

// Samples the snapshot the last refresh stored; if that refresh failed this repeats the old reading, which is harmless.
async function recordTurn($: EngineInterface): Promise<void> {
  const s = await read($, snapshot)
  if (s === null) {
    return
  }
  await update($, turns, prev => [...prev, { tokens: s.totalTokens, costUsd: s.costUsd }].slice(-MAX_TURNS))
}

function usageWindow($: EngineInterface, limits: SessionRateLimit[], kind: string): UsageWindow | null {
  const limit = limits.find(l => l.kind === kind)
  if (!limit) {
    return null
  }
  if (limit.resetsAt === undefined) {
    return { percentUsed: limit.percentUsed, resetsAt: null }
  }
  const resetsAt = Date.parse(limit.resetsAt)
  if (Number.isNaN(resetsAt)) {
    $.ui.log(`context-bar: ${kind} resetsAt is not a timestamp: ${limit.resetsAt}`)
    return { percentUsed: limit.percentUsed, resetsAt: null }
  }
  return { percentUsed: limit.percentUsed, resetsAt }
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

// The engine's cost ledger is in US dollars only; there is no account currency to convert to.
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local wall-clock time rather than a countdown: the band only redraws on refresh, so "in 2h13m" would go stale
// while the session sits idle, and a clock time stays true.
export function formatReset(resetsAt: number, withWeekday: boolean): string {
  const at = new Date(resetsAt)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return withWeekday ? `${WEEKDAYS[at.getDay()]} ${time}` : time
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

export type TurnStats = {
  // Tokens the last turn added; null until two samples exist, or when the last turn did not grow the context.
  lastGrowth: number | null
  // Tokens still to go before auto-compaction (or before the window is full when it is off).
  headroom: number
  // Turns of that headroom at the recent average growth; null without a growth trend.
  turnsLeft: number | null
  lastCost: number | null
}

export function turnStats(s: ContextBarSnapshot, samples: TurnSample[]): TurnStats {
  const limit = s.autoCompactThreshold ?? s.maxTokens
  const deltas: number[] = []
  for (let i = 1; i < samples.length; i++) {
    deltas.push(samples[i]!.tokens - samples[i - 1]!.tokens)
  }
  const last = deltas[deltas.length - 1]
  const growing = deltas.slice(-GROWTH_TURNS).filter(d => d > 0)
  const average = growing.length > 0 ? growing.reduce((a, b) => a + b, 0) / growing.length : 0
  const headroom = Math.max(0, limit - s.totalTokens)

  const [before, after] = samples.slice(-2)
  const cost =
    before?.costUsd != null && after?.costUsd != null && after.costUsd > before.costUsd
      ? after.costUsd - before.costUsd
      : null

  return {
    lastGrowth: last !== undefined && last > 0 ? last : null,
    headroom,
    turnsLeft: average > 0 ? Math.floor(headroom / average) : null,
    lastCost: cost,
  }
}

// One glyph per sample, scaled to where the context is headed: the compaction point, or the whole window.
export function sparkline(samples: TurnSample[], s: ContextBarSnapshot): string {
  const limit = s.autoCompactThreshold ?? s.maxTokens
  return samples
    .slice(-SPARK_TURNS)
    .map(x => SPARK[Math.max(0, Math.min(SPARK.length - 1, Math.floor((x.tokens / limit) * SPARK.length)))])
    .join('')
}

// Where the window ends up at its reset if usage continues at the pace so far; null while too little of the window
// has elapsed (or its reset time is unknown) for the pace to mean anything.
export function projectedPercent(w: UsageWindow, windowMs: number, now: number): number | null {
  if (w.resetsAt === null) {
    return null
  }
  const elapsed = now - (w.resetsAt - windowMs)
  if (elapsed < windowMs * MIN_ELAPSED_SHARE || elapsed > windowMs) {
    return null
  }
  return (w.percentUsed * windowMs) / elapsed
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return '<1m'
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

// The largest used category when it dominates the window's contents, e.g. MCP tools swallowing the budget.
export function topCategory(s: ContextBarSnapshot): { name: string; share: number } | null {
  const used = s.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  const total = used.reduce((a, c) => a + c.tokens, 0)
  const top = used.reduce<ContextBarCategory | null>((a, c) => (a === null || c.tokens > a.tokens ? c : a), null)
  if (top === null || total === 0) {
    return null
  }
  const share = (top.tokens / total) * 100
  return share >= TOP_CATEGORY_SHARE ? { name: top.name.toLowerCase(), share } : null
}

function percentColor(percentage: number): string {
  if (percentage >= 80) return 'error'
  if (percentage >= 50) return 'warning'
  return 'success'
}

// A window on course to run out before it resets is red however little of it is used so far.
export function windowColor(percentUsed: number, projected: number | null): string {
  return projected !== null && projected >= 100 ? 'error' : percentColor(percentUsed)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle the context window bar above the prompt; "compact" toggles the short view',
    })
    const result = await next(e)
    await refreshAfter($, 'session start')
    await recordTurn($)

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() === 'compact') {
      const compact = !(await read($, isCompact))
      await update($, isCompact, () => compact)

      return { text: compact ? 'Context bar compact.' : 'Context bar expanded.' }
    }

    const shown = !(await read($, isShown))
    await update($, isShown, () => shown)
    if (shown) {
      await refresh($)
    }

    return { text: shown ? 'Context bar shown.' : 'Context bar hidden.' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await update($, toolCalls, n => n + 1)
    if (await read($, isShown)) {
      await refreshAfter($, e.tool)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshAfter($, 'turn')
    await recordTurn($)

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // Sizes from before the compaction would read as a huge negative turn, so the trend starts over.
    await update($, turns, () => [])
    await update($, compactions, n => n + 1)
    await refreshAfter($, 'compaction')
    await recordTurn($)

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
    const compact = await read($, isCompact)
    const legend = compact ? [] : s.categories.filter(c => c.kind === 'used' && c.tokens > 0)
    const samples = await read($, turns)
    const now = Date.now()
    const stats = turnStats(s, samples)
    const top = topCategory(s)
    const compactionCount = await read($, compactions)
    const toolCount = await read($, toolCalls)
    const fiveHourPace = s.fiveHour && projectedPercent(s.fiveHour, FIVE_HOUR_MS, now)
    const weekPace = s.week && projectedPercent(s.week, WEEK_MS, now)
    const target = s.autoCompactThreshold !== null ? 'compact' : 'full'
    const statParts: ReactNode[] = []
    if (samples.length >= 3) {
      statParts.push(<Text color="claude">{sparkline(samples, s)}</Text>)
    }
    if (stats.lastGrowth !== null) {
      statParts.push(<Text>+{formatTokens(stats.lastGrowth)} last turn</Text>)
    }
    statParts.push(
      <Text>
        {formatTokens(stats.headroom)} to {target}
        {stats.turnsLeft !== null && <Text dimColor> (~{stats.turnsLeft} turns)</Text>}
      </Text>,
    )
    if (stats.lastCost !== null) {
      statParts.push(<Text>{formatCost(stats.lastCost)} last turn</Text>)
    }
    if (s.cacheHitPercent !== null) {
      statParts.push(<Text>cache {Math.round(s.cacheHitPercent)}%</Text>)
    }
    statParts.push(<Text>{s.model}</Text>)
    statParts.push(<Text>{formatDuration(now - s.startedAt)}</Text>)
    if (compactionCount > 0) {
      statParts.push(<Text>compacted {compactionCount}×</Text>)
    }
    if (toolCount > 0) {
      statParts.push(<Text>{toolCount} tools</Text>)
    }
    if (top !== null) {
      statParts.push(
        <Text color="warning">
          {top.name} {Math.round(top.share)}% of used
        </Text>,
      )
    }

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
            {s.fiveHour !== null && (
              <Text>
                <Text dimColor> · 5h </Text>
                <Text color={windowColor(s.fiveHour.percentUsed, fiveHourPace)}>{`${Math.round(s.fiveHour.percentUsed)}%`}</Text>
                {fiveHourPace !== null && fiveHourPace >= PROJECTION_SHOWN_FROM && (
                  <Text dimColor>{` →${Math.round(fiveHourPace)}%`}</Text>
                )}
                {s.fiveHour.resetsAt !== null && <Text dimColor> ↻ {formatReset(s.fiveHour.resetsAt, false)}</Text>}
              </Text>
            )}
            {s.week !== null && (
              <Text>
                <Text dimColor> · week </Text>
                <Text color={windowColor(s.week.percentUsed, weekPace)}>{`${Math.round(s.week.percentUsed)}%`}</Text>
                {weekPace !== null && weekPace >= PROJECTION_SHOWN_FROM && (
                  <Text dimColor>{` →${Math.round(weekPace)}%`}</Text>
                )}
                {s.week.resetsAt !== null && <Text dimColor> ↻ {formatReset(s.week.resetsAt, true)}</Text>}
              </Text>
            )}
            {s.costUsd !== null && <Text bold> {formatCost(s.costUsd)}</Text>}
          </Text>
        </Box>
        <Box>
          {runs.map(r => (
            <Text color={r.color}>{r.text}</Text>
          ))}
        </Box>
        {!compact && (
          <Box flexWrap="wrap" columnGap={1}>
            {statParts.map((part, i) => (
              <Text dimColor>
                {i > 0 && '· '}
                {part}
              </Text>
            ))}
          </Box>
        )}
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
