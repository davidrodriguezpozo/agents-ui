import { createContext, useContext } from 'react'
import type { Api } from '../api'
import type { ProjectState } from '../types'
import type { ActionState } from './hooks'

export type ViewId = 'work' | 'land' | 'daily' | 'fleet' | 'inbox' | 'projects'

export const VIEWS: { id: ViewId; key: string; label: string; path: string }[] = [
  { id: 'work', key: '1', label: 'Work', path: '/work' },
  { id: 'land', key: '2', label: 'Land', path: '/land' },
  { id: 'daily', key: '3', label: 'Daily', path: '/schedules' },
  { id: 'fleet', key: '4', label: 'Fleet', path: '/wall' },
  { id: 'inbox', key: '5', label: 'Inbox', path: '/' },
  { id: 'projects', key: '6', label: 'Projects', path: '/' },
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
  setActiveProject: (path: string | null) => Promise<void>
  mode: InputMode
  setMode: (mode: InputMode) => void
  action: ActionState
  openBrowser: (path?: string) => void
  suspend: (task: () => Promise<void>) => Promise<void>
}

export const StudioContext = createContext<StudioContextValue | null>(null)

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext)
  if (!value) throw new Error('useStudio used outside the app')
  return value
}
