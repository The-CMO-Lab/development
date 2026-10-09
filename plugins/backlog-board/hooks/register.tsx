import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardDetail, BoardItem, BoardSnapshot, BoardView } from '../types'
import { docTitle, summarize } from './parse'

const PANE = 'backlog-board'
const TITLE = 'Backlog'
const WATCH_DIRS = ['features', 'decisions', 'handoffs']

const snapshot = atom({ plugin: 'backlog-board', key: 'snapshot' } as const, null)
const error = atom({ plugin: 'backlog-board', key: 'error' } as const, null)
const view = atom({ plugin: 'backlog-board', key: 'view' } as const, 'overview')
const selected = atom({ plugin: 'backlog-board', key: 'selected' } as const, null)
const expanded = atom({ plugin: 'backlog-board', key: 'expanded' } as const, [])

const TYPE_COLOR: Record<BoardItem['type'], string> = { FEAT: 'claude', BUG: 'error', S: 'suggestion', Task: 'subtle' }

const COL_LABEL: Record<BoardItem['col'], string> = {
  done: 'Done', todo: 'Ready', prog: 'In progress', blocked: 'Blocked', verify: 'Waiting for verification', parked: 'Parked',
}
const COL_COLOR: Record<BoardItem['col'], string> = {
  done: 'success', todo: 'text', prog: 'warning', blocked: 'error', verify: 'suggestion', parked: 'subtle',
}

/** Cuts a title to one row: Button labels don't truncate on their own. */
const clip = (text: string, room: number) => (text.length <= Math.max(8, room) ? text : `${text.slice(0, Math.max(8, room) - 1)}…`)
const join = (dir: string, name: string) => (dir === '.' || dir === '' ? name : `${dir.replace(/\/$/, '')}/${name}`)
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const bar = (part: number, whole: number, width: number) => {
  const w = Math.max(4, width)
  const n = whole > 0 ? Math.round((part / whole) * w) : 0
  return '█'.repeat(n) + '░'.repeat(w - n)
}

// Module variables reset on hot reload; that only costs one extra re-read.
let configured = ''
let lastSig = ''
let busy = false

async function storeKey($: EngineInterface) { return `docsDir:${await $.session.cwd()}` }

/** The folder holding backlog.md: /board override, then the option, then ./docs, then the working directory. */
async function docsDir($: EngineInterface): Promise<string | undefined> {
  const override = (await $.store.get(await storeKey($))) as string | undefined
  for (const dir of [override, configured, 'docs', '.']) {
    if (dir && (await $.fs.exists(join(dir, 'backlog.md')))) return dir
  }
  return undefined
}

async function signature($: EngineInterface, dir: string): Promise<string> {
  const parts = [String((await $.fs.stat(join(dir, 'backlog.md'))).mtimeMs)]
  for (const sub of WATCH_DIRS) {
    const entries = await $.fs.list(join(dir, sub)).catch(() => [])
    parts.push(`${entries.length}:${Math.max(0, ...entries.map(x => x.mtimeMs))}`)
  }
  return parts.join('|')
}

async function featureTitles($: EngineInterface, dir: string): Promise<Record<string, string>> {
  const titles: Record<string, string> = {}
  const entries = await $.fs.list(join(dir, 'features')).catch(() => [])
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.md')) continue
    const t = docTitle(await $.fs.read(join(dir, `features/${f.name}`)).catch(() => ''))
    if (t.id && t.title) titles[t.id] = t.title
  }
  return titles
}

async function latestHandoff($: EngineInterface, dir: string): Promise<BoardSnapshot['handoff']> {
  const entries = await $.fs.list(join(dir, 'handoffs')).catch(() => [])
  const name = entries.filter(f => f.kind === 'file' && f.name.endsWith('.md')).map(f => f.name).sort().pop()
  if (!name) return undefined
  const title = docTitle(await $.fs.read(join(dir, `handoffs/${name}`)).catch(() => '')).title
  return { date: name.slice(0, 10), title: title ?? name.replace(/\.md$/, '') }
}

async function refresh($: EngineInterface, force = false): Promise<boolean> {
  if (busy) return false
  busy = true
  try {
    const dir = await docsDir($)
    if (!dir) {
      lastSig = ''
      await update($, snapshot, () => null)
      await update($, error, () => 'No backlog.md found. Run /board <docs folder> to point at one.')
      return false
    }
    const sig = `${dir}#${await signature($, dir)}`
    if (!force && sig === lastSig) return true
    const isFirst = lastSig === ''
    const md = await $.fs.read(join(dir, 'backlog.md'))
    const next = summarize(md, {
      docsDir: dir,
      loadedAt: await $.clock.now(),
      featureTitles: await featureTitles($, dir),
      handoff: await latestHandoff($, dir),
    })
    lastSig = sig
    await update($, snapshot, () => next)
    await update($, error, () => null)
    if (!isFirst && !force) $.ui.toast('Backlog changed — board updated')
    return true
  } catch (err) {
    await update($, error, () => `Could not read the backlog: ${err instanceof Error ? err.message : String(err)}`)
    return false
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  configured = String(options.docsDir ?? '').trim()
  const pollMs = Math.max(2, Number(options.pollSeconds) || 10) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'board',
      description: 'Show virtual-team backlog progress in a sidebar',
      argumentHint: '[close | reset | <docs folder>]',
    })
    const found = await refresh($, true)
    $.clock.every(pollMs, () => void refresh($))
    if (found) void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  // Agents edit the backlog during turns: pick changes up as soon as a turn ends.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => false)
    return result
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Backlog pane closed.' }
    }
    if (arg === 'reset') {
      await $.store.delete(await storeKey($))
    } else if (arg) {
      const dir = arg.replace(/\/backlog\.md$/, '')
      if (!(await $.fs.exists(join(dir, 'backlog.md')))) return { text: `No backlog.md in ${dir}.` }
      await $.store.set(await storeKey($), dir)
    }
    const found = await refresh($, true)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const s = await read($, snapshot)
    if (!found || !s) return { text: (await read($, error)) ?? 'No backlog found.' }
    const where = opened.isPlaced ? 'Backlog pane opened' : 'Backlog pane is waiting for a wider terminal'
    return { text: `${where} (${s.docsDir}/backlog.md).` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const err = await read($, error)
    const tab = await read($, view)
    const open = await read($, selected)
    const shown = new Set(await read($, expanded))
    const cols = Math.max(20, e.props.bodyColumns)

    const top = () => $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
    const setView = (v: BoardView) => async () => {
      await update($, selected, () => null)
      await update($, view, () => v)
      await top()
    }
    const openItem = (key: string) => async () => {
      await update($, selected, () => key)
      await top()
    }
    const back = async () => {
      const was = open
      await update($, selected, () => null)
      if (was) await $.ui.scroll({ to: { key: `i-${was}` }, block: 'center' }).catch(() => undefined)
    }
    const toggleFeature = (id: string) => () =>
      update($, expanded, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
    const showFeature = (id: string) => async () => {
      await update($, expanded, list => (list.includes(id) ? list : [...list, id]))
      await update($, selected, () => null)
      await update($, view, () => 'features')
      await $.ui.scroll({ to: { key: `f-${id}` }, block: 'start' }).catch(() => undefined)
    }

    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button key="tab-overview" hotkey="o" variant={tab === 'overview' && !open ? 'primary' : 'secondary'} label="Overview" onPress={setView('overview')} />
        <Button key="tab-features" hotkey="f" variant={tab === 'features' && !open ? 'primary' : 'secondary'} label="Features" onPress={setView('features')} />
        <Button key="refresh" hotkey="r" label="Refresh" onPress={() => void refresh($, true)} />
      </Box>
    )

    if (!s) {
      return (
        <Box flexDirection="column">
          {tabs}
          <Text dimColor>{err ?? 'Loading the backlog…'}</Text>
        </Box>
      )
    }

    const footer = (
      <Box marginTop={1}>
        <Text dimColor wrap="truncate-middle">
          {s.docsDir}/backlog.md · {err ? 'read failed' : `updated ${hhmm(s.loadedAt)}`}
        </Text>
      </Box>
    )

    // One row per item: the whole row is a button that opens its details.
    const row = (it: BoardItem, indent = '') => (
      <Button key={`i-${it.key}`} plain onPress={openItem(it.key)}>
        {indent}
        <Text color={TYPE_COLOR[it.type]} dimColor={it.col === 'done' || it.col === 'parked'}>{it.id || '•'}</Text>{' '}
        <Text dimColor={it.col === 'done' || it.col === 'parked'} strikethrough={it.col === 'parked'}>
          {clip(it.title, cols - indent.length - it.id.length - 2)}
        </Text>
      </Button>
    )

    const d: BoardDetail | undefined = open ? s.details[open] : undefined
    if (open) {
      if (!d) {
        return (
          <Box flexDirection="column">
            {tabs}
            <Button key="back" hotkey="b" label="← Back" onPress={back} />
            <Text dimColor>That item is no longer in the backlog.</Text>
            {footer}
          </Box>
        )
      }
      const feature = d.feature?.startsWith('FEAT-') && d.feature !== d.id ? s.features.find(f => f.id === d.feature) : undefined
      return (
        <Box flexDirection="column">
          {tabs}
          <Box marginTop={1}>
            <Button key="back" hotkey="b" label="← Back" onPress={back} />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text wrap="wrap">
              <Text bold color={TYPE_COLOR[d.type]}>{d.id || 'Item'}</Text> <Text bold>{d.title}</Text>
            </Text>
            <Text wrap="wrap">
              <Text color={COL_COLOR[d.col]}>{COL_LABEL[d.col]}</Text>
              <Text dimColor> · status:{d.status} · line {d.line}</Text>
            </Text>
            {d.prs.length ? <Text color="warning">{d.prs.join(', ')}</Text> : null}
            {feature ? (
              <Button key="feature" plain onPress={showFeature(feature.id)}>
                <Text dimColor>feature </Text>
                <Text color="claude">{feature.id}</Text> {clip(feature.title, cols - 20)}
              </Button>
            ) : d.feature && d.feature !== d.id ? (
              <Text dimColor>feature {d.feature}</Text>
            ) : null}
            {d.fields.map(([k, v]) => (
              <Text wrap="wrap">
                <Text dimColor>{k} </Text>
                {v}
              </Text>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            {d.body ? <Markdown text={d.body} /> : <Text dimColor>No description.</Text>}
          </Box>
          {footer}
        </Box>
      )
    }

    if (tab === 'features') {
      return (
        <Box flexDirection="column">
          {tabs}
          <Text dimColor>
            {s.features.length} open features · {s.featuresDone} complete · select one to see its stories
          </Text>
          {s.features.map(f => {
            const isOpen = shown.has(f.id)
            return (
              <Box flexDirection="column" marginTop={1}>
                <Button key={`f-${f.id}`} plain onPress={toggleFeature(f.id)}>
                  {isOpen ? '▾ ' : '▸ '}
                  <Text color="claude">{f.id}</Text> {clip(f.title, cols - f.id.length - 4)}
                </Button>
                <Text>
                  {'  '}
                  <Text color="success">{bar(f.done, f.total, Math.min(20, cols - 20))}</Text> {f.done}/{f.total}
                  {f.active ? <Text color="warning"> · {f.active} active</Text> : null}
                </Text>
                {isOpen ? f.stories.map(st => row(st, '    ')) : null}
              </Box>
            )
          })}
          {footer}
        </Box>
      )
    }

    const section = (label: string, color: string, list: BoardItem[]) =>
      list.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={color}>
            {label} <Text dimColor>{list.length}</Text>
          </Text>
          {list.map(it => row(it))}
        </Box>
      )

    const c = s.counts
    const total = c.done + c.todo + c.prog + c.blocked + c.verify
    const pct = total ? Math.round((c.done / total) * 100) : 0
    return (
      <Box flexDirection="column">
        {tabs}
        <Box marginTop={1}>
          <Text>
            <Text bold>{pct}% done </Text>
            <Text color="success">{bar(c.done, total, Math.min(30, cols - 22))}</Text>
            <Text dimColor> {c.done}/{total}</Text>
          </Text>
        </Box>
        <Text wrap="wrap">
          <Text color="warning">● {c.prog} doing</Text>  <Text color="suggestion">◐ {c.verify} verify</Text>
          {'  '}<Text color="error">✕ {c.blocked} blocked</Text>  <Text>○ {c.todo} ready</Text>
          <Text dimColor>  · {c.parked} parked</Text>
        </Text>
        {s.directives.map(dir => (
          <Text dimColor italic wrap="wrap">
            {dir}
          </Text>
        ))}
        {section('In progress', 'warning', s.doing)}
        {section('Verify', 'suggestion', s.verify)}
        {section('Blocked', 'error', s.blocked)}
        {section('Next up', 'text', s.next.slice(0, 8))}
        {s.handoff ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Last handoff</Text>
            <Text wrap="truncate-end">
              <Text dimColor>{s.handoff.date}</Text> {s.handoff.title}
            </Text>
          </Box>
        ) : null}
        <Text dimColor>Select an item to see its details.</Text>
        {footer}
      </Box>
    )
  })
}
