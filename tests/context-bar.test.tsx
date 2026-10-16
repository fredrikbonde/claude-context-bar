import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'

import { formatCost, formatReset, formatTokens, layoutBar } from '../hooks/register'

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
    await shown.unmount()
  }

  const off = await $.command.run(RUN)
  expect(off.text).toBe('Context bar hidden.')
  const hidden = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ type: 'Text', text: /212k/ })).toBeUndefined()
  expect(await hidden.find({ key: 'engine-band' })).toBeDefined()
  await hidden.unmount()

  const on2 = await $.command.run(RUN)
  expect(on2.text).toBe('Context bar shown.')
})

test('shows ? for usage windows the session does not report', async ($, on) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 212_000, percent: 21, breakdown: BREAKDOWN },
      rateLimits: [],
      cost: { usd: 1.234 },
    },
  }))
  on('command.register', () => ({ value: { command: 'context-bar' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  const shown = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await shown.find({ type: 'Text', text: /^ · 5h $/ })).toBeDefined()
  expect(await shown.find({ type: 'Text', text: /^ · week $/ })).toBeDefined()
  expect(await shown.findAll({ type: 'Text', text: /^\?$/ })).toHaveLength(2)
  expect(await shown.find({ type: 'Text', text: /↻/ })).toBeUndefined()
  await shown.unmount()
})
