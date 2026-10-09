import { describe, expect, mock, test } from 'claude-code/testing'

import { docTitle, summarize } from '../hooks/parse'

const BACKLOG = `# Backlog

**Priority: ship FEAT-002 first**

## Ready

- [x] S-001: Done story | feature:FEAT-001 | status:done — shipped
- [ ] S-002: Next story | feature:FEAT-001 | group:1 | status:ready
- [>] S-003: Doing story | feature:FEAT-002 | status:ready
- [=] BUG-004: Needs verifying | status:implemented — waiting on staging
- [ ] S-005: Stuck | feature:FEAT-002 | status:blocked
- [ ] S-006: Parked | feature:FEAT-002 | status:deferred
<!--
- [ ] S-999: inside a comment
-->

## In Progress

(none)

## Done
- [ ] S-007: Listed in Done | feature:FEAT-002
`

const FEATURE = `---
id: FEAT-002
title: FEAT-002 — Second feature
---
# whatever`

describe('parse', () => {
  test('counts and buckets items as the browser board does', async () => {
    const s = summarize(BACKLOG, { docsDir: 'docs', loadedAt: 0, featureTitles: { 'FEAT-002': 'Second feature' } })
    expect(s.counts).toEqual({ done: 2, todo: 1, prog: 1, blocked: 1, verify: 1, parked: 1 })
    expect(s.doing.map(i => i.id)).toEqual(['S-003'])
    expect(s.verify.map(i => i.id)).toEqual(['BUG-004'])
    expect(s.blocked.map(i => i.id)).toEqual(['S-005'])
    expect(s.next.map(i => i.id)).toEqual(['S-002'])
    expect(s.directives).toEqual(['Priority: ship FEAT-002 first'])
    const f2 = s.features.find(f => f.id === 'FEAT-002')
    expect(f2).toEqual({ id: 'FEAT-002', title: 'Second feature', done: 1, active: 2, total: 3 })
  })

  test('reads a feature title from frontmatter', async () => {
    expect(docTitle(FEATURE)).toEqual({ id: 'FEAT-002', title: 'Second feature' })
  })
})

const FILES: Record<string, string> = {
  'docs/backlog.md': BACKLOG,
  'docs/features/2026-01-01-second.md': FEATURE,
  'docs/handoffs/2026-10-02-100348-release-prep.md': '# Release prep',
}

// The engine hands fs hooks absolute paths; the fixture is keyed from docs/.
const rel = (path: string) => (path.includes('/docs/') || path.endsWith('/docs') ? path.slice(path.lastIndexOf('/docs') + 1) : path)

test('the pane draws progress on every surface', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 0 })
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', ($, e) => ({ value: rel(e.path) in FILES }))
  on('fs.read', ($, e) => {
    const text = FILES[rel(e.path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.list', ($, e) => ({
    value: Object.keys(FILES)
      .filter(p => p.startsWith(`${rel(e.path ?? '')}/`))
      .map(p => ({ name: p.slice(rel(e.path ?? '').length + 1), kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
  }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  const ran = await $.command.run({
    command: 'board',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toContain('docs/backlog.md')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'backlog-board',
      surface,
      component: 'Pane',
      requestId: 'backlog-board',
      props: { title: 'Backlog', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /33% done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Doing story/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Release prep/ })).toBeDefined()
    await ui.press({ key: 'tab-features' })
    expect(await ui.find({ type: 'Text', text: /Second feature/ })).toBeDefined()
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})
