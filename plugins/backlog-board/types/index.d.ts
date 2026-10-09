export type BoardCol = 'done' | 'todo' | 'prog' | 'blocked' | 'verify' | 'parked'

export type BoardItem = {
  id: string
  title: string
  status: string
  col: BoardCol
  type: 'FEAT' | 'BUG' | 'S' | 'Task'
  feature?: string
}

export type BoardFeature = {
  id: string
  title: string
  done: number
  active: number
  total: number
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
}

export type BoardView = 'overview' | 'features'

declare module 'claude-code' {
  interface PluginState {
    'backlog-board': {
      snapshot: BoardSnapshot | null
      error: string | null
      view: BoardView
    }
  }
}
