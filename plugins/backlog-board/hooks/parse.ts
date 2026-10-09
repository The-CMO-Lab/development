// Pure parsing of a virtual-team backlog, ported from docs/backlog-board.html
// (parseBacklog / makeItem / finishItem) so the pane and the browser board agree.

import type { BoardCol, BoardFeature, BoardItem, BoardSnapshot } from '../types'

const MARKER: Record<string, string> = { x: 'done', '~': 'partial', '>': 'doing', '=': 'implemented', ' ': 'ready' }

const STATUS_COL: Record<string, BoardCol> = {
  done: 'done', complete: 'done', completed: 'done', shipped: 'done', closed: 'done',
  ready: 'todo', planned: 'todo', draft: 'todo', backlog: 'todo', todo: 'todo', open: 'todo', specced: 'todo', tbd: 'todo', new: 'todo',
  partial: 'prog', doing: 'prog', in_progress: 'prog', 'in-progress': 'prog', progress: 'prog', implementing: 'prog', wip: 'prog',
  blocked: 'blocked', error: 'blocked', failed: 'blocked', waiting: 'blocked',
  staging: 'verify', implemented: 'verify', verify: 'verify', verifying: 'verify', review: 'verify', testing: 'verify',
  deferred: 'parked', superseded: 'parked', reverted: 'parked', cancelled: 'parked', canceled: 'parked', wontfix: 'parked', dropped: 'parked',
}

export type ParsedItem = BoardItem & { section: string; kv: Record<string, string> }

export function parseBacklog(md: string): { items: ParsedItem[]; directives: string[] } {
  const items: ParsedItem[] = []
  const directives: string[] = []
  let section = ''
  let inComment = false
  for (const l of md.split(/\r?\n/)) {
    if (inComment) { if (l.includes('-->')) inComment = false; continue }
    if (/^\s*<!--/.test(l)) { if (!l.includes('-->')) inComment = true; continue }
    const h = l.match(/^(#{1,4})\s+(.*)/)
    if (h) { if (h[1]!.length === 2) section = h[2]!.trim(); continue }
    const m = l.match(/^\s*- \[(.)\]\s+(.*)$/)
    if (m) { items.push(makeItem(m[1]!, m[2]!, section)); continue }
    const t = l.trim()
    if (/^\*\*/.test(t) && /priorit/i.test(t)) directives.push(t.replace(/\*\*/g, ''))
  }
  return { items, directives }
}

function makeItem(marker: string, text: string, section: string): ParsedItem {
  const segs = text.split(' | ')
  let first = segs[0] ?? ''
  const kv: Record<string, string> = {}
  let last = 0
  while (last + 1 < segs.length && /^[a-z_]+:/.test(segs[last + 1] ?? '')) last++
  for (let j = 1; j <= last; j++) {
    const seg = segs[j] ?? ''
    const k = seg.indexOf(':')
    const rest = seg.slice(k + 1)
    const d = j === last ? rest.indexOf(' — ') : -1
    kv[seg.slice(0, k)] = (d >= 0 ? rest.slice(0, d) : rest).trim()
  }
  if (segs.length === 1) { const d = first.indexOf(' — '); if (d > 0) first = first.slice(0, d) }
  let id = ''
  let title = first.trim()
  const im = first.match(/^((?:S|FEAT|BUG|CCM|TASK)-\d+)\s*:\s*([\s\S]*)$/)
  if (im) { id = im[1]!; title = im[2]!.trim() }
  const type = !id ? 'Task' : id.startsWith('FEAT') ? 'FEAT' : id.startsWith('BUG') ? 'BUG' : id.startsWith('S-') ? 'S' : 'Task'

  const declared = (kv.status || '').toLowerCase().trim().split(/\s+/)[0] || ''
  let status: string
  if (marker === 'x' || /^done$/i.test(section)) status = 'done'
  else if (declared && declared !== 'ready') status = declared
  else status = MARKER[marker] || declared || 'ready'
  if (marker === '~' && (declared === 'ready' || !declared)) status = 'partial'

  return {
    id, title: stripMd(title), status, col: STATUS_COL[status] || 'todo', type,
    feature: kv.feature || (type === 'FEAT' ? id : undefined), section, kv,
  }
}

export function stripMd(s: string): string {
  return s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
}

/** Frontmatter `title`/`id`, or the first H1, of a feature spec or handoff. */
export function docTitle(text: string): { id?: string; title?: string } {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const field = (k: string) => fm?.[1]?.match(new RegExp(`^${k}:\\s*["']?(.*?)["']?\\s*$`, 'm'))?.[1]
  const h1 = text.match(/^#\s+(.+)$/m)?.[1]
  const title = field('title') || h1
  const id = field('id') || h1?.match(/FEAT-\d+/)?.[0]
  return { id, title: title ? stripMd(title).replace(/^FEAT-\d+\s*[—–:-]\s*/, '') : undefined }
}

const strip = ({ section: _s, kv: _k, ...item }: ParsedItem): BoardItem => item

export function summarize(
  md: string,
  extra: { docsDir: string; loadedAt: number; featureTitles?: Record<string, string>; handoff?: BoardSnapshot['handoff'] },
): BoardSnapshot {
  const { items, directives } = parseBacklog(md)
  const counts: Record<BoardCol, number> = { done: 0, todo: 0, prog: 0, blocked: 0, verify: 0, parked: 0 }
  for (const it of items) counts[it.col]++

  const titles: Record<string, string> = { ...extra.featureTitles }
  for (const it of items) if (it.type === 'FEAT' && it.id) titles[it.id] = it.title

  const byFeat = new Map<string, BoardFeature>()
  for (const it of items) {
    if (it.type === 'FEAT' || !it.feature?.startsWith('FEAT-') || it.col === 'parked') continue
    const f = byFeat.get(it.feature) ?? { id: it.feature, title: titles[it.feature] ?? '', done: 0, active: 0, total: 0 }
    f.total++
    if (it.col === 'done') f.done++
    else if (it.col !== 'todo') f.active++
    byFeat.set(it.feature, f)
  }
  const all = [...byFeat.values()]
  const open = all
    .filter(f => f.done < f.total)
    .sort((a, b) => (b.active > 0 ? 1 : 0) - (a.active > 0 ? 1 : 0) || b.done / b.total - a.done / a.total || a.id.localeCompare(b.id))

  const open_ = (col: BoardCol) => items.filter(i => i.col === col).map(strip)
  return {
    docsDir: extra.docsDir,
    loadedAt: extra.loadedAt,
    counts,
    doing: open_('prog'),
    verify: open_('verify'),
    blocked: open_('blocked'),
    next: items.filter(i => i.col === 'todo' && i.type !== 'FEAT' && /ready|in progress/i.test(i.section)).slice(0, 12).map(strip),
    features: open,
    featuresDone: all.length - open.length,
    directives,
    handoff: extra.handoff,
  }
}
