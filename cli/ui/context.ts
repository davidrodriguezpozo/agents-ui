import { createContext, useContext } from 'react'
import type { Api } from '../api'
import type { ProjectState } from '../types'
import type { ActionState, MotionBus } from './hooks'

export type ViewId = 'work' | 'land' | 'daily' | 'fleet' | 'inbox' | 'projects'

/**
 * The views, their numbers, and the letter that gets there after `g`.
 *
 * The chords are the browser's, from `app/utils/shortcuts.ts`: `g w` for Work,
 * `g l` for Land, `g d` for Daily, `g m` for Fleet. Two clients that disagree
 * about where `g l` goes would be worse than one of them not having chords.
 */
export const VIEWS: { id: ViewId; key: string; chord: string; label: string; path: string }[] = [
  { id: 'work', key: '1', chord: 'w', label: 'Work', path: '/work' },
  { id: 'land', key: '2', chord: 'l', label: 'Land', path: '/land' },
  { id: 'daily', key: '3', chord: 'd', label: 'Daily', path: '/schedules' },
  { id: 'fleet', key: '4', chord: 'm', label: 'Fleet', path: '/wall' },
  { id: 'inbox', key: '5', chord: 'i', label: 'Inbox', path: '/' },
  { id: 'projects', key: '6', chord: 'p', label: 'Projects', path: '/' },
]

/**
 * What is capturing the keyboard.
 *
 * Ink delivers every key to every `useInput`. Without an exclusive owner, `/`
 * would both start a filter and type a slash into it, and `q` would quit while
 * you were naming a session. One mode at a time is the whole fix.
 */
export type InputMode = 'nav' | 'compose' | 'filter' | 'help'

export interface StudioContextValue {
  api: Api
  baseUrl: string
  projects: ProjectState | null
  reloadProjects: () => void
  /**
   * The project this client is looking at.
   *
   * Its own, not the server's. Every scoped endpoint reads the `x-project-dir`
   * header, so a second client can look somewhere else without moving the
   * browser's floor out from under it — pressing `]` here used to write the
   * app's persisted active project, which is a surprising amount of blast
   * radius for a key you press while browsing.
   */
  scope: string | null
  setScope: (path: string | null) => void
  /** Make this client's project the app's default too, deliberately. */
  makeDefault: (path: string | null) => Promise<void>
  /** Whether this client is looking somewhere other than the app's default. */
  scopeIsLocal: boolean
  mode: InputMode
  setMode: (mode: InputMode) => void
  action: ActionState
  openBrowser: (path?: string) => void
  suspend: (task: () => Promise<void>) => Promise<void>
  /** `5j`, `gg`, `⌃d` — decided once in `App`, obeyed by whatever has the screen. */
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
}

export const StudioContext = createContext<StudioContextValue | null>(null)

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext)
  if (!value) throw new Error('useStudio used outside the app')
  return value
}
