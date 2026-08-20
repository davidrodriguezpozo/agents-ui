import { Box, useApp, useInput, useStdin, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Api } from '../api'
import { hint } from '../keymap'
import { scopeFor } from '../cwd'
import { alertFor, watchNotifications } from '../notify'
import { openUrl, withAlternateScreen } from '../shell'
import { shortenHome } from '../format'
import type { StudioNotification } from '../types'
import { Footer, Header, HelpOverlay, MessageBar, NavTabs } from './components'
import { StudioContext, VIEWS, type InputMode, type ViewId } from './context'
import { createMotionBus, useAction, usePendingKeys, usePoll, useTerminalSize, useTick } from './hooks'
import { FleetView } from './FleetView'
import { InboxView } from './InboxView'
import { LandView } from './LandView'
import { LAYOUT, rowHeight } from './theme'
import { ProjectsView } from './ProjectsView'
import { RitualsView } from './RitualsView'
import { SessionDetailView } from './SessionDetailView'
import { RunDetailView, WorkView } from './WorkView'

/** How long a notification stays on the message line before it is old news. */
const BANNER_MS = 10_000

export function App({
  api,
  baseUrl,
  bell = true,
  initialView = 'work',
  initialSession = null,
  project = null,
  here = null,
}: {
  api: Api
  baseUrl: string
  /** `--no-bell` for people who share an office. */
  bell?: boolean
  initialView?: ViewId
  initialSession?: string | null
  /** `--project`, which settles the question before it is asked. */
  project?: string | null
  /** The repository this was run from, if it was run from one. */
  here?: string | null
}) {
  const { exit } = useApp()
  const { stdin, setRawMode } = useStdin()
  const { stdout } = useStdout()
  const { columns, rows } = useTerminalSize()
  const action = useAction()
  const keys = usePendingKeys()
  const motions = useMemo(createMotionBus, [])

  const [view, setView] = useState<ViewId>(initialView)
  const [mode, setMode] = useState<InputMode>('nav')
  const [sessionId, setSessionId] = useState<string | null>(initialSession)
  const [runId, setRunId] = useState<string | null>(null)
  const [suspended, setSuspended] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<StudioNotification | null>(null)
  const [nudge, setNudge] = useState(0)

  /**
   * The project this client is looking at, which starts as the app's default
   * and then belongs to this window.
   */
  const [scope, setScope] = useState<string | null | undefined>(project ?? undefined)

  const projectsPoll = usePoll(signal => api.projects(signal), { every: 20_000, deps: [nudge] })
  const projects = projectsPoll.data
  const attentionPoll = usePoll(signal => api.attention(signal), { every: 8_000, deps: [nudge] })
  const attention = attentionPoll.data

  const effectiveScope = scope === undefined ? (projects?.activePath ?? null) : scope

  /**
   * Opened in a repository, it looks at that repository.
   *
   * Decided once the projects are known, because a checkout the app has never
   * heard of has nothing to show and pointing at it would only produce a
   * confident "nothing here".
   */
  useEffect(() => {
    if (scope !== undefined || !projects) return
    setScope(scopeFor({
      here,
      known: projects.projects.map(item => item.path),
      fallback: projects.activePath,
    }))
  }, [projects, scope, here])

  /*
   * Written during render rather than in an effect, and that is not a
   * shortcut: child effects run before the parent's, so a view whose poll
   * restarts because the project changed fired its first request *before* the
   * effect that told the client which project — which is how the list ended up
   * showing another repository's sessions under this one's name. Every scoped
   * endpoint reads this per request, so setting it early is exactly right.
   */
  api.client.projectDirValue = effectiveScope

  const makeDefault = useCallback(async (path: string | null) => {
    const ok = await action.run('project.default', 'Making it the default…', () => api.setActiveProject(path))
    if (ok) {
      setScope(path)
      projectsPoll.refresh()
    }
  }, [api, action, projectsPoll])

  const openBrowser = useCallback((path = '/') => {
    const url = path.startsWith('http') ? path : new URL(path, baseUrl).toString()
    openUrl(url)
  }, [baseUrl])

  /**
   * Get out of the way for a shell or an editor, then come back.
   *
   * The tree stays mounted — hidden, not unmounted. Returning from a shell used
   * to drop you at the top of a transcript with the stream re-subscribed and
   * whatever you had typed gone, because the whole subtree had been thrown away
   * and rebuilt. Ink writes nothing while there is nothing to draw, so hiding is
   * enough to hand the terminal over.
   */
  const suspend = useCallback(async (task: () => Promise<void>) => {
    setSuspended(true)
    setRawMode?.(false)
    stdin.pause()
    try {
      await withAlternateScreen(stdout, task)
    } catch (error) {
      void action.run('suspend', null, async () => { throw error })
    } finally {
      stdin.resume()
      setRawMode?.(true)
      setSuspended(false)
    }
  }, [setRawMode, stdin, stdout, action])

  /**
   * Being told, rather than looking.
   *
   * The same stream the browser tab listens to. Two things come of it: the
   * panes refresh on the news instead of on a timer, and the terminal makes a
   * noise when something is actually blocked on a person.
   */
  useEffect(() => {
    const controller = new AbortController()
    void watchNotifications(api.client, {
      signal: controller.signal,
      onNotification: (notification) => {
        setNudge(n => n + 1)
        setBanner(notification)
        if (bell) {
          const alert = alertFor(notification)
          if (alert) stdout.write(alert)
        }
      },
    })
    return () => controller.abort()
  }, [api, bell, stdout])

  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), BANNER_MS)
    return () => clearTimeout(timer)
  }, [banner])

  const inDetail = Boolean(sessionId || runId)

  const closeDetail = useCallback(() => {
    setSessionId(null)
    setRunId(null)
  }, [])

  const go = useCallback((next: ViewId) => {
    setView(next)
    closeDetail()
  }, [closeDetail])

  const cycleProject = useCallback((delta: 1 | -1) => {
    const list = (projects?.projects ?? []).filter(project => project.exists)
    if (list.length === 0) return
    const current = list.findIndex(project => project.path === effectiveScope)
    const next = list[(current + delta + list.length) % list.length]
    if (next) setScope(next.path)
  }, [projects, effectiveScope])

  /**
   * The keyboard, in one place.
   *
   * Motions are worked out here and published, so `5j`, `gg`, `G` and `⌃d` mean
   * the same thing to a list of sessions and to a transcript — the browser has
   * one listener for the whole app for exactly this reason. Everything that is
   * about the thing on screen stays with the view that owns the state.
   */
  useInput((input, key) => {
    if (mode === 'help') {
      if (input === '?' || input === 'q' || key.escape) setMode('nav')
      return
    }
    if (input === '?') {
      setMode('help')
      return
    }

    // A count in front of a motion. A leading zero is a zero, not a count.
    if (/^[0-9]$/.test(input) && !key.ctrl && !key.meta && !(input === '0' && !keys.pending)) {
      keys.push(input)
      return
    }

    // Halfway through `g…`: `gg` is the first row, `g` and a letter is a view.
    if (keys.pending.endsWith('g')) {
      keys.takeCount()
      if (input === 'g') {
        motions.publish({ kind: 'first' })
        return
      }
      const target = VIEWS.find(item => item.chord === input)
      if (target) go(target.id)
      return
    }
    if (input === 'g' && !key.ctrl) {
      keys.push('g')
      return
    }

    if (input === 'G') {
      const nth = keys.takeCount(0)
      motions.publish({ kind: 'last', nth: nth || undefined })
      return
    }
    if (key.ctrl && (input === 'd' || input === 'u')) {
      motions.publish({ kind: 'half', direction: input === 'd' ? 1 : -1 })
      return
    }
    if (key.downArrow || (input === 'j' && !key.ctrl)) {
      motions.publish({ kind: 'move', delta: keys.takeCount() })
      return
    }
    if (key.upArrow || (input === 'k' && !key.ctrl)) {
      motions.publish({ kind: 'move', delta: -keys.takeCount() })
      return
    }
    if (key.pageDown) {
      motions.publish({ kind: 'half', direction: 1 })
      return
    }
    if (key.pageUp) {
      motions.publish({ kind: 'half', direction: -1 })
      return
    }

    /**
     * `q` quits from a list and backs out of a detail view, the way it does in
     * `less`. It used to quit from anywhere, so a stray `q` while reading a
     * transcript closed the app with a run in flight.
     */
    if (input === 'q' && !key.ctrl) {
      if (inDetail) closeDetail()
      else exit()
      return
    }

    // Everything below moves you somewhere else, which is not what `h`, `l` or
    // `]` should do while you are reading one session.
    if (inDetail) return

    if (input === ']' || input === '[') {
      cycleProject(input === ']' ? 1 : -1)
      return
    }

    if (input === 'h' || input === 'l') {
      const at = VIEWS.findIndex(item => item.id === view)
      const next = VIEWS[(at + (input === 'l' ? 1 : -1) + VIEWS.length) % VIEWS.length]
      if (next) go(next.id)
    }
  }, { isActive: mode === 'nav' || mode === 'help' })

  const looking = projects?.projects.find(item => item.path === effectiveScope)
  const scopeIsLocal = Boolean(projects && effectiveScope !== projects.activePath)
  const projectLabel = effectiveScope
    ? `${shortenHome(effectiveScope, projects?.home ?? '')}${looking?.branch ? ` · ${looking.branch}` : ''}`
    : 'no project'

  const needsYou = attention?.needsYou ?? 0
  const working = attention?.working ?? 0
  const headerRight = [
    needsYou ? `${needsYou} need you` : null,
    working ? `${working} working` : null,
    `${projectLabel}${scopeIsLocal ? ' · here only' : ''}`,
  ].filter(Boolean).join(' · ')

  const offline = attentionPoll.stale || projectsPoll.stale
    ? 'server not answering — retrying'
    : null

  const tick = useTick(Boolean(action.pending))
  const footer = mode === 'help'
    ? hint(['help', 'quit'])
    : inDetail
      ? undefined
      : `${hint(['move', 'open', 'filter', 'views', 'project.cycle', 'help', 'quit'])}`

  return (
    <StudioContext.Provider value={{
      api,
      baseUrl,
      projects: projects ?? null,
      reloadProjects: projectsPoll.refresh,
      scope: effectiveScope,
      setScope,
      makeDefault,
      scopeIsLocal,
      mode,
      setMode,
      action,
      openBrowser,
      suspend,
      motions,
      draft: (key: string) => drafts[key] ?? '',
      setDraft: (key: string, value: string) => setDrafts(current => ({ ...current, [key]: value })),
      nudge,
      rowHeight: rowHeight(rows),
    }}
    >
      <Box
        flexDirection="column"
        display={suspended ? 'none' : 'flex'}
        height={Math.max(1, rows - 1)}
        paddingX={LAYOUT.padding}
        paddingY={1}
      >
        <Header
          left="agents-studio"
          right={headerRight}
          problem={offline}
          pending={keys.pending}
        />
        {!inDetail && mode !== 'help' ? (
          <NavTabs
            view={view}
            counts={{
              work: { value: needsYou || working, tone: needsYou ? 'yellow' : 'cyan' },
              fleet: { value: needsYou + working, tone: needsYou ? 'yellow' : 'cyan' },
              daily: { value: attention?.failingRituals ?? 0, tone: 'yellow' },
            }}
          />
        ) : null}
        {mode === 'help' ? (
          <Box flexGrow={1}>
            <HelpOverlay
              width={Math.max(40, columns - LAYOUT.padding * 2)}
              surfaces={inDetail
                ? ['global', 'session', 'diff']
                : ['global', 'list', view]}
            />
          </Box>
        ) : sessionId ? (
          <SessionDetailView id={sessionId} onBack={closeDetail} isActive />
        ) : runId ? (
          <RunDetailView id={runId} onBack={closeDetail} isActive />
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
        <MessageBar
          text={action.message ?? (banner ? `${banner.title}${banner.body ? ` — ${banner.body}` : ''}` : null)}
          tone={action.message ? action.tone : 'info'}
          spinning={Boolean(action.pending)}
          tick={tick}
        />
        {footer ? <Footer keys={footer} /> : null}
      </Box>
    </StudioContext.Provider>
  )
}
