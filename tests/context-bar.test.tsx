import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

import {
  formatCost,
  formatDuration,
  formatReset,
  formatTokens,
  layoutBar,
  projectedPercent,
  sparkline,
  topCategory,
  turnStats,
  windowColor,
} from '../hooks/register'
import type { ContextBarSnapshot } from '../types'

const SNAPSHOT: ContextBarSnapshot = {
  categories: [
    { name: 'System prompt', tokens: 3_400, color: 'promptBorder', kind: 'used' },
    { name: 'Messages', tokens: 186_000, color: 'permission', kind: 'used' },
    { name: 'Free space', tokens: 810_600, color: 'inactive', kind: 'free' },
  ],
  totalTokens: 200_000,
  maxTokens: 1_000_000,
  percentage: 20,
  autoCompactThreshold: 950_000,
  costUsd: 1,
  fiveHour: null,
  week: null,
  model: 'opus-5-5',
  startedAt: 0,
  cacheHitPercent: null,
}

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 3_400, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 186_000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 40_000, color: 'ide', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 760_600, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 50_000, color: 'subtle', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 212_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'auto',
  percentage: 21,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: 950_000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

const RUN = {
  command: 'context-bar',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

test('formats tokens like /context', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(3_400)).toBe('3.4k')
  expect(formatTokens(212_000)).toBe('212k')
  expect(formatTokens(1_000_000)).toBe('1M')
})

test('formats cost in dollars', () => {
  expect(formatCost(0)).toBe('$0.00')
  expect(formatCost(1.234)).toBe('$1.23')
  expect(formatCost(12.5)).toBe('$12.50')
})

// Built from local date parts, so the expectations hold in any time zone the tests run in.
test('formats reset times in local time', () => {
  expect(formatReset(new Date(2026, 9, 14, 19, 39).getTime(), false)).toBe('19:39')
  expect(formatReset(new Date(2026, 9, 15, 7, 5).getTime(), false)).toBe('07:05')
  expect(formatReset(new Date(2026, 9, 17, 14, 59).getTime(), true)).toBe('Sat 14:59')
})

test('bar fills exactly the width and skips deferred rows', () => {
  const runs = layoutBar(
    {
      categories: [
        { name: 'System prompt', tokens: 3_400, color: 'promptBorder', kind: 'used' },
        { name: 'Messages', tokens: 186_000, color: 'permission', kind: 'used' },
        { name: 'Free space', tokens: 810_600, color: 'inactive', kind: 'free' },
      ],
      totalTokens: 189_400,
      maxTokens: 1_000_000,
      percentage: 19,
      autoCompactThreshold: 950_000,
      costUsd: null,
      fiveHour: null,
      week: null,
      model: 'opus-5-5',
      startedAt: 0,
      cacheHitPercent: null,
    },
    80,
  )
  expect(runs.map(r => r.text).join('').length).toBe(80)
  expect(runs[0]?.color).toBe('promptBorder')
  expect(runs.some(r => r.color === 'warning')).toBe(true)
})

test('/context-bar toggles the band', async ($, on) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 212_000, percent: 21, breakdown: BREAKDOWN },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(2026, 9, 14, 19, 39).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(2026, 9, 17, 14, 59).toISOString() },
        { kind: 'spend_limit', percentUsed: 7 },
      ],
      cost: { usd: 1.234 },
    },
  }))
  // Stands in for the engine's own band: an empty Box keyed so the hidden case can be told apart.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await $.ui.mount({ plugin: 'context-bar', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await shown.find({ type: 'Text', text: /212k/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /compacts at 950k/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /messages 186k/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /mcp tools/ })).toBeUndefined()
    expect(await shown.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /^24%$/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /^41%$/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: / ↻ 19:39$/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: / ↻ Sat 14:59$/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /^7%$/ })).toBeUndefined()
    expect(await shown.find({ type: 'Text', text: /738k to compact/ })).toBeDefined()
    expect(await shown.find({ type: 'Text', text: /^opus-5-5$/ })).toBeDefined()
    await shown.unmount()
  }

  const compact = await $.command.run({ ...RUN, args: 'compact' })
  expect(compact.text).toBe('Context bar compact.')
  const short = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await short.find({ type: 'Text', text: /212k/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /to compact/ })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: /messages 186k/ })).toBeUndefined()
  await short.unmount()
  expect((await $.command.run({ ...RUN, args: 'compact' })).text).toBe('Context bar expanded.')

  const off = await $.command.run(RUN)
  expect(off.text).toBe('Context bar hidden.')
  const hidden = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ type: 'Text', text: /212k/ })).toBeUndefined()
  expect(await hidden.find({ key: 'engine-band' })).toBeDefined()
  await hidden.unmount()

  const on2 = await $.command.run(RUN)
  expect(on2.text).toBe('Context bar shown.')
})

test('turn stats: growth, headroom, turns left and cost per turn', () => {
  const stats = turnStats(SNAPSHOT, [
    { tokens: 100_000, costUsd: 0.5 },
    { tokens: 150_000, costUsd: 0.7 },
    { tokens: 200_000, costUsd: 1 },
  ])
  expect(stats.lastGrowth).toBe(50_000)
  expect(stats.headroom).toBe(750_000)
  expect(stats.turnsLeft).toBe(15)
  expect(Math.round((stats.lastCost ?? 0) * 100)).toBe(30)
  expect(turnStats(SNAPSHOT, [{ tokens: 200_000, costUsd: 1 }]).turnsLeft).toBeNull()
})

test('sparkline scales to the compaction point', () => {
  expect(sparkline([{ tokens: 0, costUsd: null }, { tokens: 950_000, costUsd: null }], SNAPSHOT)).toBe('▁█')
})

test('window pace projects usage at reset', () => {
  const now = new Date(2026, 9, 14, 12, 0).getTime()
  const hour = 60 * 60 * 1000
  // 2.5h into a 5h window at 60% used: on course for 120%.
  expect(Math.round(projectedPercent({ percentUsed: 60, resetsAt: now + 2.5 * hour }, 5 * hour, now) ?? 0)).toBe(120)
  // Too early in the window to say anything.
  expect(projectedPercent({ percentUsed: 5, resetsAt: now + 4.9 * hour }, 5 * hour, now)).toBeNull()
  expect(projectedPercent({ percentUsed: 5, resetsAt: null }, 5 * hour, now)).toBeNull()
  expect(windowColor(30, 120)).toBe('error')
  expect(windowColor(30, 60)).toBe('success')
  expect(windowColor(30, null)).toBe('success')
})

test('formats duration and finds a dominant category', () => {
  expect(formatDuration(20_000)).toBe('<1m')
  expect(formatDuration(42 * 60_000)).toBe('42m')
  expect(formatDuration(125 * 60_000)).toBe('2h 05m')
  expect(topCategory(SNAPSHOT)?.name).toBe('messages')
  expect(topCategory({ ...SNAPSHOT, categories: [
    { name: 'A', tokens: 10, color: 'x', kind: 'used' },
    { name: 'B', tokens: 10, color: 'y', kind: 'used' },
  ] })).toBeNull()
})
