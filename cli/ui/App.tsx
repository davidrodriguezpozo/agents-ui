import { Box, useApp, useInput, useStdin, useStdout } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../api'
import { openUrl, releaseTty, withAlternateScreen } from '../shell'
import { shortenHome } from '../format'
import { Footer, Header, HelpOverlay, MessageBar, NavTabs } from './components'
import { StudioContext, VIEWS, type InputMode, type ViewId } from './context'
import { useAction, usePoll, useTerminalSize } from './hooks'
import { FleetView } from './FleetView'
import { InboxView } from './InboxView'
import { LandView } from './LandView'
import { LAYOUT } from './theme'
import { ProjectsView } from './ProjectsView'
import { RitualsView } from './RitualsView'
import { SessionDetailView } from './SessionDetailView'
import { RunDetailView, WorkView } from './WorkView'

export function App({ api, baseUrl }: { api: Api; baseUrl: string }) {
  const { exit } = useApp()
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const { rows } = useTerminalSize()
  const action = useAction()
  const [view, setView] = useState<ViewId>('work')
  const [mode, setMode] = useState<InputMode>('nav')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [suspended, setSuspended] = useState(false)

  const projectsPoll = usePoll(signal => api.projects(signal), 8000)
  const projects = projectsPoll.data
  const attentionPoll = usePoll(signal => api.attention(signal), 5000)
  const attention = attentionPoll.data

  useEffect(() => {
    if (projects?.activePath !== undefined) api.client.projectDirValue = projects.activePath
  }, [api, projects?.activePath])

  const setActiveProject = useCallback(async (path: string | null) => {
    api.client.projectDirValue = path
    await action.run(null, () => api.setActiveProject(path))
    projectsPoll.refresh()
  }, [api, action, projectsPoll])

  const openBrowser = useCallback((path = '/') => {
    const url = path.startsWith('http') ? path : new URL(path, baseUrl).toString()
    openUrl(url)
  }, [baseUrl])

  const suspend = useCallback(async (task: () => Promise<void>) => {
    setSuspended(true)
    // Let the empty frame land before the screen changes hands. Ink throttles
    // its renders, and a frame written after the switch is a frame written
    // over whatever the child is drawing.
    await new Promise(resolve => setTimeout(resolve, 40))
    // Not Ink's `setRawMode`: it is reference counted, and this app always has
    // at least one `useInput` mounted, so asking it to stop only ever brings
    // the count down to one. The terminal has to be handed over for real.
    const takeBack = releaseTty(stdin)
    try {
      await withAlternateScreen(stdout, task)
    } catch (error) {
      action.run(null, async () => { throw error })
    } finally {
      takeBack()
      setSuspended(false)
    }
  }, [stdin, stdout, action])

  useInput((input, key) => {
    if (input === 'q' && !key.ctrl) {
      exit()
      return
    }
    if (input === '?' || (mode === 'help' && key.escape)) {
      setMode(m => (m === 'help' ? 'nav' : 'help'))
      return
    }
    if (mode === 'help') return

    if (mode === 'nav' && (input === ']' || input === '[')) {
      const list = (projects?.projects ?? []).filter(p => p.exists)
      if (list.length === 0) return
      const current = list.findIndex(p => p.path === projects?.activePath)
      const delta = input === ']' ? 1 : -1
      const next = list[(current + delta + list.length) % list.length]
      if (next) void setActiveProject(next.path)
      return
    }

    // Neovim left/right: previous / next view. Numbers still jump.
    if (mode === 'nav' && (input === 'h' || input === 'l' || input === 'H' || input === 'L')) {
      const i = VIEWS.findIndex(v => v.id === view)
      const delta = input === 'l' || input === 'L' ? 1 : -1
      const next = VIEWS[(i + delta + VIEWS.length) % VIEWS.length]
      if (next) {
        setView(next.id)
        setSessionId(null)
        setRunId(null)
      }
      return
    }

    const switched = VIEWS.find(v => v.key === input)
    if (switched && mode === 'nav') {
      setView(switched.id)
      setSessionId(null)
      setRunId(null)
    }
  }, { isActive: !suspended && (mode === 'nav' || mode === 'help') })

  if (suspended) return null

  const inDetail = Boolean(sessionId || runId)
  const project = projects?.projects.find(p => p.path === projects.activePath)
  const projectLabel = projects?.activePath
    ? `${shortenHome(projects.activePath, projects.home)}${project?.branch ? ` · ${project.branch}` : ''}`
    : 'no project'

  const needsYou = attention?.needsYou ?? 0
  const working = attention?.working ?? 0
  const headerRight = [
    needsYou ? `${needsYou} need you` : null,
    working && !needsYou ? `${working} working` : null,
    projectLabel,
  ].filter(Boolean).join(' · ')

  const keys = mode === 'help'
    ? 'esc close   q quit'
    : inDetail
      ? undefined
      : `↑↓ select   ⏎ open   / filter   h l views   [ ] project   ? keys   q quit`

  const tabCounts: Partial<Record<ViewId, number>> = {
    work: needsYou || working || undefined,
    fleet: (needsYou + working) || undefined,
    daily: attention?.failingRituals || undefined,
  }

  return (
    <StudioContext.Provider value={{
      api,
      baseUrl,
      projects: projects ?? null,
      reloadProjects: projectsPoll.refresh,
      setActiveProject,
      mode,
      setMode,
      action,
      openBrowser,
      suspend,
    }}
    >
      <Box flexDirection="column" height={Math.max(1, rows - 1)} paddingX={LAYOUT.padding} paddingY={1}>
        <Header left="agents-studio" right={headerRight} />
        {!inDetail && mode !== 'help' ? <NavTabs view={view} counts={tabCounts} /> : null}
        {mode === 'help' ? (
          <Box flexGrow={1}><HelpOverlay /></Box>
        ) : sessionId ? (
          <SessionDetailView
            id={sessionId}
            onBack={() => setSessionId(null)}
            isActive
          />
        ) : runId ? (
          <RunDetailView id={runId} onBack={() => setRunId(null)} isActive />
        ) : (
          <Box flexGrow={1} flexDirection="column">
            {view === 'work' ? (
              <WorkView onOpenSession={setSessionId} onOpenRun={setRunId} isActive />
            ) : null}
            {view === 'land' ? <LandView onOpenSession={setSessionId} isActive /> : null}
            {view === 'daily' ? <RitualsView isActive /> : null}
            {view === 'fleet' ? <FleetView onOpenSession={setSessionId} isActive /> : null}
            {view === 'inbox' ? <InboxView isActive /> : null}
            {view === 'projects' ? <ProjectsView isActive /> : null}
          </Box>
        )}
        <MessageBar text={action.message} tone={action.tone} />
        {keys ? <Footer keys={keys} /> : null}
      </Box>
    </StudioContext.Provider>
  )
}
