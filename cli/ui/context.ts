import { createContext, useContext } from 'react'
import type { Api } from '../api'
import type { DiffTool } from '../diffTool'
import type { Keymap } from '../keymap'
import type { RailFilter, RailItem } from '../rail'
import type { ProjectState } from '../types'
import type { ActionState, MotionBus } from './hooks'

/**
 * What is capturing the keyboard.
 *
 * Ink delivers every key to every `useInput`. Without an exclusive owner, `/`
 * would both start a filter and type a slash into it, and `q` would quit while
 * you were naming a session. One mode at a time is the whole fix — and the
 * status line says which, because a modal app that keeps that to itself is
 * unusable.
 */
export type Mode = 'nav' | 'insert' | 'filter' | 'command' | 'help' | 'queue'

/** Which half of the screen the keys go to. */
export type Focus = 'rail' | 'pane'

export interface StudioContextValue {
  api: Api
  baseUrl: string
  /** Every key, with this person's overrides folded in. */
  keys: Keymap
  projects: ProjectState | null
  /**
   * The project this client is looking at.
   *
   * Its own, not the server's. Every scoped endpoint reads the `x-project-dir`
   * header, so a second client can look somewhere else without moving the
   * browser's floor out from under it.
   */
  scope: string | null
  setScope: (path: string | null) => void
  /** Make this client's project the app's default too, deliberately. */
  makeDefault: (path: string | null) => Promise<void>
  scopeIsLocal: boolean
  mode: Mode
  setMode: (mode: Mode) => void
  /** Long things, while they are happening. */
  jobs: ActionState
  openBrowser: (path?: string) => void
  suspend: (task: () => Promise<void>) => Promise<void>
  /** `5j`, `gg`, `⌃d` — decided once in `App`, obeyed by whatever has the keys. */
  motions: MotionBus
  /** Instructions survive backing out of a session, per session. */
  draft: (key: string) => string
  setDraft: (key: string, value: string) => void
  /**
   * Bumped whenever the server says something happened, so a pane can refresh
   * on the news rather than on a timer.
   */
  nudge: number
  /** Two-line rows, or two lines and some air. */
  rowHeight: 2 | 3
  /** `delta`, if this machine has one. */
  diffTool: DiffTool | null
  /** Ask everything for fresh data. */
  refreshAll: () => void
  /** Point the rail at something, from a pane that has a reason to. */
  select: (key: string) => void
  /** What the rail is showing. */
  filter: RailFilter
  setFilter: (filter: RailFilter) => void
  /** Everything in the rail, so a pane can find its neighbours. */
  items: RailItem[]
}

export const StudioContext = createContext<StudioContextValue | null>(null)

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext)
  if (!value) throw new Error('useStudio used outside the app')
  return value
}
