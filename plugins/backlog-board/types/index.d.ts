export type BoardCol = 'done' | 'todo' | 'prog' | 'blocked' | 'verify' | 'parked'

export type BoardItem = {
  /** Unique within a snapshot: the id, or `line-N` for an item with none. */
  key: string
  id: string
  title: string
  status: string
  col: BoardCol
  type: 'FEAT' | 'BUG' | 'S' | 'Task'
  feature?: string
}

/** What the detail view shows for one item. */
export type BoardDetail = BoardItem & {
  line: number
  /** The `key:value` segments other than status and feature, in file order. */
  fields: [string, string][]
  /** The description after ` — ` plus continuation lines, as markdown. */
  body: string
  /** `PR #N` references found in the title and body. */
  prs: string[]
}

export type BoardFeature = {
  id: string
  title: string
  done: number
  active: number
  total: number
  /** Every story of the feature in file order, parked ones included. */
  stories: BoardItem[]
}

export type BoardSnapshot = {
  docsDir: string
  loadedAt: number
  counts: Record<BoardCol, number>
  doing: BoardItem[]
  verify: BoardItem[]
  blocked: BoardItem[]
  next: BoardItem[]
  features: BoardFeature[]
  featuresDone: number
  directives: string[]
  handoff?: { date: string; title: string }
  /** Details by key, for every item the pane lists. */
  details: Record<string, BoardDetail>
}

export type BoardView = 'overview' | 'features'

declare module 'claude-code' {
  interface PluginState {
    'backlog-board': {
      snapshot: BoardSnapshot | null
      error: string | null
      view: BoardView
      /** Key of the item open in the detail view, or null for the list. */
      selected: string | null
      /** Feature ids expanded on the Features tab. */
      expanded: string[]
    }
  }
}
