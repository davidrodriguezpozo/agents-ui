import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isCurrent, moneyLabel, orderTiles } from '~/utils/wall'
import type { Api } from '../api'
import { scopeFor } from '../cwd'
import type { DiffTool } from '../diffTool'
import { shortenHome } from '../format'
import type { Keymap, Surface } from '../keymap'
import { alertFor, watchNotifications } from '../notify'
import { parseCommand, completions, COMMANDS } from '../commandLine'
import { waitingPrompts, type Waiting } from '../prompts'
import { buildRail, onFilter, railCounts, unreadOf, FILTERS, type RailFilter, type RailItem } from '../rail'
import { openUrl, withMainScreen } from '../shell'
import type { StudioNotification } from '../types'
import {
  CommandLine,
  EmptyState,
  FilterBar,
  Footer,
  HelpOverlay,
  helpLines,
  JobsRegion,
  MessageBar,
  StatusLine,
  TextField,
} from './components'
import { StudioContext, type Focus, type Mode } from './context'
import { FleetView } from './FleetView'
import { PromptQueue } from './PromptQueue'
import { Rail } from './Rail'
import { InboxPane } from './panes/InboxPane'
import { ProjectPane } from './panes/ProjectPane'
import { PullPane } from './panes/PullPane'
import { RitualPane } from './panes/RitualPane'
import { RunPane } from './panes/RunPane'
import { SessionPane } from './panes/SessionPane'
import {
  CHROME,
  LAYOUT,
  contentHeight,
  isSplit,
  railRowsIn,
  railWidth,
  rowHeight,
  runBody,
  sessionBody,
} from './theme'
import {
  createMotionBus,
  useJobs,
  useScroll,
  useJumps,
  useMotions,
  usePendingKeys,
  usePoll,
  useSeen,
  useTerminalSize,
  useTick,
  type MotionBus,
} from './hooks'

/** How long a notification stays on the message line before it is old news. */
const BANNER_MS = 10_000

export function App({
  api,
  baseUrl,
  keys,
  diffTool = null,
  bell = true,
  project = null,
  here = null,
  initialFilter = 'all',
  initialSession = null,
}: {
  api: Api
  baseUrl: string
  keys: Keymap
  diffTool?: DiffTool | null
  /** `--no-bell` for people who share an office. */
  bell?: boolean
  /** `--project`, which settles the question before it is asked. */
  project?: string | null
  /** The repository this was run from, if it was run from one. */
  here?: string | null
  initialFilter?: RailFilter
  initialSession?: string | null
}) {
  const { exit } = useApp()
  const { stdin, setRawMode } = useStdin()
  const { stdout } = useStdout()
  const { columns, rows } = useTerminalSize()
  const jobs = useJobs()
  const pending = usePendingKeys()
  const motions = useMemo(createMotionBus, [])
  const { seen, mark } = useSeen()
  const jumps = useJumps()

  const [mode, setMode] = useState<Mode>('nav')
  const [focus, setFocus] = useState<Focus>(initialSession ? 'pane' : 'rail')
  const [filter, setFilter] = useState<RailFilter>(initialFilter)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(
    initialSession ? `session:${initialSession}` : null,
  )
  const [fleet, setFleet] = useState(false)
  const [command, setCommand] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<StudioNotification | null>(null)
  const [nudge, setNudge] = useState(0)
  const [answered, setAnswered] = useState<string[]>([])
  const [scope, setScope] = useState<string | null | undefined>(project ?? undefined)

  const refreshAll = useCallback(() => setNudge(n => n + 1), [])

  /* ── What everything reads ─────────────────────────────────────────────── */

  const projectsPoll = usePoll(signal => api.projects(signal), { every: 20_000, deps: [nudge] })
  const projects = projectsPoll.data
  const effectiveScope = scope === undefined ? (projects?.activePath ?? null) : scope

  /*
   * Written during render rather than in an effect: child effects run before
   * the parent's, so a pane whose poll restarts because the project changed
   * fires its first request *before* the effect that told the client which
   * project — which is how a list ends up showing another repository's work.
   */
  api.client.projectDirValue = effectiveScope

  const attentionPoll = usePoll(signal => api.attention(signal), { every: 8_000, deps: [nudge] })
  const attention = attentionPoll.data

  /**
   * Whether a source is worth asking for.
   *
   * Pull requests cost a `gh` call and the inbox costs an agent, so neither is
   * polled while the rail is filtered somewhere else — unless the pane is
   * showing one, which is why this reads the explicit choice rather than the
   * cursor: the cursor is derived from these answers, and asking it here would
   * be a circle.
   */
  const wants = useCallback(
    (kind: RailFilter) => (
      filter === 'all' || filter === 'needs-you' || filter === kind || Boolean(chosen?.startsWith(kind))
    ),
    [filter, chosen],
  )

  const work = usePoll(
    signal => Promise.all([api.sessions(signal), api.runs({}, signal)])
      .then(([sessions, runs]) => ({ sessions, runs })),
    { every: 4_000, idle: 20_000, live: Boolean(attention?.working), deps: [effectiveScope, nudge] },
  )

  const wall = usePoll(signal => api.wall(signal), {
    every: 3_000,
    idle: 15_000,
    live: Boolean(attention?.working || attention?.needsYou),
    deps: [nudge],
  })

  const pulls = usePoll(signal => api.pulls(signal), {
    every: 120_000,
    enabled: wants('pull'),
    deps: [effectiveScope, nudge],
  })

  const rituals = usePoll(
    signal => Promise.all([api.schedules(signal), api.scheduleHistory(signal)])
      .then(([schedules, histories]) => ({ schedules, histories })),
    { every: 30_000, enabled: wants('ritual'), deps: [nudge] },
  )

  const inbox = usePoll(signal => api.inbox(signal), {
    every: 60_000,
    enabled: wants('inbox'),
    deps: [nudge],
  })

  /* ── The rail ──────────────────────────────────────────────────────────── */

  const items = useMemo(() => buildRail({
    sessions: work.data?.sessions ?? [],
    runs: work.data?.runs ?? [],
    pulls: pulls.data && pulls.data.ok ? pulls.data : null,
    schedules: rituals.data?.schedules ?? [],
    histories: rituals.data?.histories ?? {},
    inbox: inbox.data?.sources ?? [],
    projects: projects?.projects ?? [],
    activeProject: projects?.activePath ?? null,
    scope: effectiveScope,
    home: projects?.home ?? '',
  }), [work.data, pulls.data, rituals.data, inbox.data, projects, effectiveScope])

  const counts = useMemo(() => railCounts(items), [items])
  const filtered = useMemo(() => {
    const onThis = onFilter(items, filter)
    const needle = query.trim().toLowerCase()
    if (!needle) return onThis
    return onThis.filter(item => `${item.title} ${item.detail} ${item.status}`.toLowerCase().includes(needle))
  }, [items, filter, query])

  const unread = useMemo(
    () => new Set(unreadOf(filtered, seen).map(item => item.key)),
    [filtered, seen],
  )

  /*
   * Until you move the cursor, it sits on whatever wants you most.
   *
   * Latching onto the first row that happened to arrive was worse than it
   * sounds: the projects answer in milliseconds and the session list takes a
   * couple of `git` invocations, so the app opened pointing at a project and
   * stayed there. Following the top of the rail until the first keypress is
   * both simpler and what you would want.
   */
  const selected = chosen && filtered.some(item => item.key === chosen)
    ? chosen
    : filtered[0]?.key ?? null
  const index = Math.max(0, filtered.findIndex(item => item.key === selected))
  const current: RailItem | undefined = filtered[index]

  const setSelected = useCallback((key: string) => setChosen(key), [])

  // Looking at it counts as having seen it.
  useEffect(() => {
    if (current) mark(current.key, current.stamp)
  }, [current?.key, current?.stamp, mark])

  /*
   * When the thing you were looking at stops existing, the keys come back.
   *
   * Dismiss an inbox item or close a session from inside its own pane and the
   * row leaves the rail. The selection then falls through to the top of the
   * list — so the pane silently repointed itself at something unrelated while
   * still holding the keys, and `tab` was the only way out of it.
   *
   * The test is the *unfiltered* rail rather than the visible one, which is
   * what separates "it is gone" from "a filter is hiding it": `g d` should
   * leave the pane exactly where it was.
   */
  const shown = useRef<{ key: string; at: number } | null>(null)
  useEffect(() => {
    const was = shown.current
    shown.current = selected ? { key: selected, at: index } : null
    if (!was || was.key === selected) return
    // Still on the rail somewhere, so the cursor moved rather than the row.
    if (items.some(item => item.key === was.key)) return

    // The row that slid up into its place, not the first one in the list.
    const next = filtered[Math.min(was.at, filtered.length - 1)]
    setChosen(next?.key ?? null)
    if (focus === 'pane') setFocus('rail')
  }, [selected, index, items, filtered, focus])

  /*
   * Nothing is new when you have only just opened the app.
   *
   * "Since you looked" starts now, so the first full rail is marked seen — the
   * alternative is eleven dots on launch, which trains you to ignore them.
   */
  const primed = useRef(false)
  useEffect(() => {
    if (primed.current || items.length === 0) return
    primed.current = true
    for (const item of items) mark(item.key, item.stamp)
  }, [items, mark])

  /* ── Prompts waiting on a person ───────────────────────────────────────── */

  const tiles = useMemo(() => {
    const snapshot = wall.data
    if (!snapshot) return []
    return orderTiles(snapshot.tiles.filter(tile => isCurrent(tile, snapshot.at)))
  }, [wall.data])

  const queue = useMemo(() => waitingPrompts(tiles, answered), [tiles, answered])

  const answerFromQueue = useCallback(async (
    waiting: Waiting,
    behavior: 'allow' | 'deny',
    opts: { scope?: 'once' | 'session'; message?: string; answers?: Record<string, string[]> } = {},
  ) => {
    setAnswered(current => [...current, waiting.prompt.id])
    const ok = await jobs.run(
      `permission:${waiting.prompt.id}`,
      null,
      () => api.answerPermission(waiting.prompt.id, behavior, opts),
    )
    if (!ok) setAnswered(current => current.filter(id => id !== waiting.prompt.id))
    wall.refresh()
  }, [api, jobs, wall])

  /* ── Where we are ──────────────────────────────────────────────────────── */

  const scopeIsLocal = Boolean(projects && effectiveScope !== projects.activePath)

  useEffect(() => {
    if (scope !== undefined || !projects) return
    // Opened in a repository, it looks at that repository — once the projects
    // are known, because a checkout the app has never heard of has nothing to
    // show and pointing at it would produce a confident "nothing here".
    setScope(scopeFor({
      here,
      known: projects.projects.map(item => item.path),
      fallback: projects.activePath,
    }))
  }, [projects, scope, here])

  const makeDefault = useCallback(async (path: string | null) => {
    const ok = await jobs.run('project.default', 'Making it the default', () => api.setActiveProject(path))
    if (ok) {
      setScope(path)
      projectsPoll.refresh()
    }
  }, [api, jobs, projectsPoll])

  const openBrowser = useCallback((path = '/') => {
    openUrl(path.startsWith('http') ? path : new URL(path, baseUrl).toString())
  }, [baseUrl])

  /**
   * Get out of the way for a shell or an editor, then come back.
   *
   * The tree stays mounted — hidden, not unmounted — so returning keeps your
   * place, your draft and the stream. The app steps out of its own screen for
   * the child and back into it afterwards; see `withMainScreen`.
   */
  const suspend = useCallback(async (task: () => Promise<void>) => {
    setSuspended(true)
    setRawMode?.(false)
    stdin.pause()
    try {
      await withMainScreen(stdout, task)
    } catch (error) {
      void jobs.run('suspend', null, async () => { throw error })
    } finally {
      stdin.resume()
      setRawMode?.(true)
      setSuspended(false)
    }
  }, [setRawMode, stdin, stdout, jobs])

  /* ── Being told, rather than looking ───────────────────────────────────── */

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

  /* ── Layout ────────────────────────────────────────────────────────────── */

  const jobRows = jobs.active.length ? Math.min(3, jobs.active.length) : 0
  const content = contentHeight(rows, jobRows)
  const split = isSplit(columns)
  const railW = split ? railWidth(columns) : Math.max(30, columns - LAYOUT.padding * 2)
  const paneW = split
    ? Math.max(30, columns - railW - LAYOUT.padding * 2 - 3)
    : Math.max(30, columns - LAYOUT.padding * 2)
  const railRows = railRowsIn(content - CHROME.railHeader, rowHeight(rows))

  /* ── Selection, and the keys that move it ──────────────────────────────── */

  const select = useCallback((key: string) => setSelected(key), [])

  const step = useCallback((delta: number) => {
    if (filtered.length === 0) return
    const at = Math.min(Math.max(0, index + delta), filtered.length - 1)
    setSelected(filtered[at]!.key)
  }, [filtered, index])

  useMotions(motions, focus === 'rail' && mode === 'nav' && !fleet, (motion) => {
    switch (motion.kind) {
      case 'move':
        step(motion.delta)
        break
      case 'first':
        if (filtered[0]) setSelected(filtered[0].key)
        break
      case 'last': {
        const at = motion.nth ? Math.min(motion.nth, filtered.length) - 1 : filtered.length - 1
        if (filtered[at]) setSelected(filtered[at]!.key)
        break
      }
      case 'half':
        step(Math.max(1, Math.floor(railRows / 2)) * motion.direction)
        break
    }
  })

  const openPane = useCallback(() => {
    if (!current) return
    jumps.push(current.key)
    setFocus('pane')
  }, [current, jumps])

  const nextUnread = useCallback(() => {
    const list = unreadOf(filtered, seen)
    const after = list.find(item => filtered.indexOf(item) > index) ?? list[0]
    if (after) setSelected(after.key)
  }, [filtered, seen, index])

  /* ── The keyboard ──────────────────────────────────────────────────────── */

  const runCommand = useCallback((line: string) => {
    const { command: parsed, error } = parseCommand(line)
    setCommand('')
    setMode('nav')
    if (error) {
      void jobs.run('command', null, async () => { throw new Error(error) })
      return
    }
    if (!parsed) return

    switch (parsed.kind) {
      case 'new':
        void jobs.run('create', 'Starting a session', async () => {
          if (!effectiveScope) throw new Error('Pick a project first — :project, or ] to cycle.')
          const started = await api.startSession({ prompt: parsed.prompt, repoDir: effectiveScope })
          setSelected(`session:${started.id}`)
          setFocus('pane')
          work.refresh()
        })
        return
      case 'filter':
        setFilter(parsed.filter)
        return
      case 'search':
        setQuery(parsed.query)
        return
      case 'project':
        setScope(parsed.path)
        return
      case 'fleet':
        setFleet(true)
        return
      case 'queue':
        setMode('queue')
        return
      case 'refresh':
        refreshAll()
        return
      case 'help':
        setMode('help')
        return
      case 'quit':
        exit()
        return
      default:
        // Everything else is about the session in the pane, and it is the pane
        // that knows how to do it. Rather than reach in, the command line says
        // which key would have done it — one place to keep in step.
        void jobs.run('command', null, async () => {
          throw new Error(`Press ${keyFor(parsed.kind)} with a session in the pane.`)
        })
    }
  }, [api, jobs, effectiveScope, work, refreshAll, exit])

  useInput((input, key) => {
    if (mode === 'help') {
      if (keys.matches('help', input, key) || key.escape || input === 'q') setMode('nav')
      return
    }
    if (mode === 'queue') return
    if (keys.matches('help', input, key)) {
      setMode('help')
      return
    }

    // A count in front of a motion. A leading zero is a zero, not a count.
    if (/^[0-9]$/.test(input) && !key.ctrl && !key.meta && !(input === '0' && !pending.pending)) {
      pending.push(input)
      return
    }

    // Halfway through `g…`: `gg` is the first row, `g` and a letter is a filter.
    if (pending.pending.endsWith('g')) {
      pending.takeCount()
      if (input === 'g') {
        motions.publish({ kind: 'first' })
        return
      }
      if (input === 'm') {
        setFleet(true)
        return
      }
      const target = FILTERS.find(item => item.chord === input)
      if (target) {
        setFilter(target.id)
        setFleet(false)
      }
      return
    }
    if (input === 'g' && !key.ctrl) {
      pending.push('g')
      return
    }

    if (input === 'G') {
      const nth = pending.takeCount(0)
      motions.publish({ kind: 'last', nth: nth || undefined })
      return
    }
    if (key.ctrl && (input === 'd' || input === 'u')) {
      motions.publish({ kind: 'half', direction: input === 'd' ? 1 : -1 })
      return
    }
    if (key.downArrow || (input === 'j' && !key.ctrl)) {
      motions.publish({ kind: 'move', delta: pending.takeCount() })
      return
    }
    if (key.upArrow || (input === 'k' && !key.ctrl)) {
      motions.publish({ kind: 'move', delta: -pending.takeCount() })
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

    if (fleet) {
      if (keys.matches('fleet.leave', input, key)) setFleet(false)
      return
    }

    if (keys.matches('command', input, key)) {
      setCommand('')
      setMode('command')
      return
    }
    if (keys.matches('filter', input, key)) {
      setMode('filter')
      return
    }
    if (keys.matches('queue', input, key)) {
      setMode('queue')
      return
    }
    if (keys.matches('fleet', input, key)) {
      setFleet(true)
      return
    }
    if (keys.matches('focus', input, key)) {
      setFocus(current => (current === 'rail' ? 'pane' : 'rail'))
      return
    }
    if (keys.matches('unread', input, key)) {
      nextUnread()
      return
    }
    if (key.ctrl && input === 'o') {
      const back = jumps.back()
      if (back) setSelected(back)
      return
    }
    if (key.ctrl && input === 'i') {
      const forward = jumps.forward()
      if (forward) setSelected(forward)
      return
    }

    if (focus === 'rail') {
      if (keys.matches('rail.open', input, key)) {
        openPane()
        return
      }
      if (keys.matches('quit', input, key)) {
        exit()
        return
      }
      if (keys.matches('project.cycle', input, key)) {
        cycleProject(input === ']' ? 1 : -1)
        return
      }
      if (keys.matches('refresh', input, key)) {
        refreshAll()
        return
      }
      if (keys.matches('rail.new', input, key)) {
        setMode('insert')
        return
      }
      if (keys.matches('browser', input, key)) {
        openBrowser(current?.browserPath ?? '/')
        return
      }
      // Everything else on a row is the pane's business, and the pane knows
      // which kind of thing it is. Focusing it and re-delivering the key would
      // be a guess; pointing at it is not.
      return
    }

    // The pane has the keys. `esc` gives them back; `q` does too, because a
    // pane you are reading is not the app you want to quit.
    if (keys.matches('quit', input, key)) {
      setFocus('rail')
      return
    }
    if (keys.matches('project.cycle', input, key)) cycleProject(input === ']' ? 1 : -1)
  }, { isActive: mode === 'nav' || mode === 'help' })

  function cycleProject(delta: 1 | -1) {
    const list = (projects?.projects ?? []).filter(item => item.exists)
    if (list.length === 0) return
    const at = list.findIndex(item => item.path === effectiveScope)
    const next = list[(at + delta + list.length) % list.length]
    if (next) setScope(next.path)
  }

  /* ── What the screen says ──────────────────────────────────────────────── */

  const looking = projects?.projects.find(item => item.path === effectiveScope)
  const projectLabel = effectiveScope
    ? `${shortenHome(effectiveScope, projects?.home ?? '')}${looking?.branch ? ` · ${looking.branch}` : ''}`
    : 'no project'

  const offline = attentionPoll.stale || projectsPoll.stale
    ? 'server not answering — retrying'
    : null

  const tick = useTick(jobs.active.length > 0 || Boolean(attention?.working))
  const now = Date.now()

  const filterLabel = FILTERS.find(item => item.id === filter)?.label ?? filter
  const modeLabel = mode === 'nav'
    ? (fleet ? 'fleet' : focus === 'rail' ? 'rail' : 'pane')
    : mode

  const footer = mode === 'help'
    ? keys.hint(['help', 'quit'])
    : fleet
      ? keys.hint(['fleet.stop', 'fleet.leave', 'browser'])
      : focus === 'rail'
        ? keys.hint(['move', 'rail.open', 'queue', 'command', 'filter', 'filters', 'quit'])
        : keys.hint(['focus', 'session.back', 'queue', 'command', 'help'])

  return (
    <StudioContext.Provider value={{
      api,
      baseUrl,
      keys,
      projects: projects ?? null,
      scope: effectiveScope,
      setScope,
      makeDefault,
      scopeIsLocal,
      mode,
      setMode,
      jobs,
      openBrowser,
      suspend,
      motions,
      draft: (key: string) => drafts[key] ?? '',
      setDraft: (key: string, value: string) => setDrafts(current => ({ ...current, [key]: value })),
      nudge,
      rowHeight: rowHeight(rows),
      diffTool,
      refreshAll,
      select,
      filter,
      setFilter,
      items,
    }}
    >
      <Box
        flexDirection="column"
        display={suspended ? 'none' : 'flex'}
        height={Math.max(1, rows - 1)}
        paddingX={LAYOUT.padding}
        paddingY={1}
      >
        <StatusLine
          mode={modeLabel}
          filter={query ? `${filterLabel} · /${query}` : filterLabel}
          counts={{
            needsYou: attention?.needsYou ?? 0,
            working: attention?.working ?? 0,
            unread: unread.size,
          }}
          project={projectLabel}
          local={scopeIsLocal}
          spend={wall.data ? moneyLabel(wall.data.spend.todayUsd) : undefined}
          problem={offline}
          pending={pending.pending}
          width={Math.max(20, columns - LAYOUT.padding * 2)}
        />

        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          {mode === 'help' ? (
            <Help
              width={Math.max(40, columns - LAYOUT.padding * 2)}
              height={content}
              surfaces={['global', 'rail', focus === 'pane' ? paneSurface(current) : 'session']}
              keys={keys}
              motions={motions}
            />
          ) : mode === 'queue' ? (
            <PromptQueue
              queue={queue}
              width={Math.max(30, columns - LAYOUT.padding * 2)}
              height={content}
              onAnswer={(waiting, behavior, opts) => { void answerFromQueue(waiting, behavior, opts) }}
              onLeave={() => setMode('nav')}
              onOpen={(sessionId) => {
                setSelected(`session:${sessionId}`)
                setFocus('pane')
              }}
            />
          ) : fleet ? (
            <FleetView
              onOpenSession={(sessionId) => {
                setSelected(`session:${sessionId}`)
                setFleet(false)
                setFocus('pane')
              }}
              isActive={mode === 'nav'}
            />
          ) : (
            <Box flexGrow={1} overflow="hidden">
              {split || focus === 'rail' ? (
                <Box
                  flexDirection="column"
                  width={split ? railW : undefined}
                  flexGrow={split ? 0 : 1}
                  flexShrink={0}
                  overflow="hidden"
                >
                  <Rail
                    items={filtered}
                    index={index}
                    focused={focus === 'rail'}
                    label={filterLabel}
                    unread={unread}
                    width={railW - 1}
                    capacity={railRows}
                    rowHeight={rowHeight(rows)}
                    tick={tick}
                    loading={work.loading && !work.data}
                    problem={work.error}
                  />
                </Box>
              ) : null}
              {split || focus === 'pane' ? (
                <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingLeft={split ? 3 : 0}>
                  <Pane
                    item={current}
                    focused={focus === 'pane'}
                    width={paneW}
                    height={content}
                    sources={{
                      schedules: rituals.data?.schedules ?? [],
                      histories: rituals.data?.histories ?? {},
                      inbox: inbox.data?.sources ?? [],
                      projects: projects?.projects ?? [],
                    }}
                    onBack={() => setFocus('rail')}
                    onSelect={(key) => {
                      setSelected(key)
                      setFocus('pane')
                    }}
                    onChanged={refreshAll}
                  />
                </Box>
              ) : null}
            </Box>
          )}
        </Box>

        <JobsRegion jobs={jobs.active} now={now} width={Math.max(20, columns - LAYOUT.padding * 2)} />

        {mode === 'filter' ? (
          <FilterBar
            value={query}
            onChange={setQuery}
            onClose={(clear) => {
              if (clear) setQuery('')
              setMode('nav')
            }}
            isActive
            placeholder="filter the rail"
          />
        ) : mode === 'command' ? (
          <CommandLine
            value={command}
            onChange={setCommand}
            onSubmit={() => runCommand(command)}
            onCancel={() => {
              setCommand('')
              setMode('nav')
            }}
            completions={completions(command)}
            width={Math.max(30, columns - LAYOUT.padding * 2)}
          />
        ) : mode === 'insert' && focus === 'rail' ? (
          <Box>
            <TextField
              value={drafts['rail:new'] ?? ''}
              onChange={value => setDrafts(current => ({ ...current, 'rail:new': value }))}
              onSubmit={() => {
                const prompt = (drafts['rail:new'] ?? '').trim()
                if (!prompt) return
                setDrafts(current => ({ ...current, 'rail:new': '' }))
                setMode('nav')
                runCommand(`new ${prompt}`)
              }}
              onCancel={() => setMode('nav')}
              isActive
              prefix="› "
              placeholder="what should this session work on?"
              width={Math.max(30, columns - LAYOUT.padding * 2)}
            />
          </Box>
        ) : (
          <MessageBar
            text={jobs.message ?? (banner ? `${banner.title}${banner.body ? ` — ${banner.body}` : ''}` : null)}
            tone={jobs.message ? jobs.tone : 'info'}
            spinning={jobs.active.length > 0}
            tick={tick}
          />
        )}

        <Footer keys={footer} />
      </Box>
    </StudioContext.Provider>
  )
}

/**
 * The keys for where you are, scrolled.
 *
 * Contextual and still longer than a terminal: three surfaces is forty rows, and
 * a help page that silently loses its last third is a help page that lies. It
 * obeys the same motions as everything else, which is the one thing you already
 * know how to do by the time you have pressed `?`.
 */
function Help({
  width,
  height,
  surfaces,
  keys,
  motions,
}: {
  width: number
  height: number
  surfaces: Surface[]
  keys: Keymap
  motions: MotionBus
}) {
  const lines = useMemo(() => helpLines(surfaces, keys), [surfaces, keys])
  // One row is the scroll hint's. Drawing into the whole height and then adding
  // it below pushes the first line out of the box, which is a subtle way to lose
  // a heading.
  const room = Math.max(3, height - 1)
  const scroll = useScroll(lines.length, room, motions, true, 'top')
  const top = Math.max(0, lines.length - scroll.offset - room)
  const hidden = Math.max(0, lines.length - top - room)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <HelpOverlay width={width} lines={lines.slice(top, top + room)} />
      {scroll.max > 0 ? (
        <Text color="gray">
          {hidden > 0 ? `↓ ${hidden} more · j k to scroll` : 'esc closes this'}
        </Text>
      ) : null}
    </Box>
  )
}

/** Which surface's keys the help page should show for what is in the pane. */
function paneSurface(item: RailItem | undefined) {
  switch (item?.kind) {
    case 'pull':
      return 'pull' as const
    case 'ritual':
      return 'ritual' as const
    case 'inbox':
      return 'inbox' as const
    case 'project':
      return 'project' as const
    case 'run':
      return 'run' as const
    default:
      return 'session' as const
  }
}

/** The key that would do what a `:` command asked for. */
function keyFor(kind: string): string {
  const found = COMMANDS.find(item => item.name === kind)
  return found ? `the key for ${found.name}` : kind
}

/**
 * Whatever the rail is pointing at.
 *
 * One place that knows which pane belongs to which kind of row, so the rail can
 * stay a list of things rather than a list of things-and-their-screens.
 */
function Pane({
  item,
  focused,
  width,
  height,
  sources,
  onBack,
  onSelect,
  onChanged,
}: {
  item: RailItem | undefined
  focused: boolean
  width: number
  height: number
  sources: {
    schedules: import('../types').Schedule[]
    histories: Record<string, import('../types').RitualHistory>
    inbox: import('../types').InboxSource[]
    projects: import('../types').Project[]
  }
  onBack: () => void
  onSelect: (key: string) => void
  onChanged: () => void
}) {
  if (!item) {
    return (
      <EmptyState>
        Nothing selected. n starts a session, Y answers what is waiting, : runs a command.
      </EmptyState>
    )
  }

  switch (item.kind) {
    case 'session':
      return (
        <SessionPane
          id={item.id}
          focused={focused}
          width={width}
          height={sessionBody(height)}
          onBack={onBack}
        />
      )
    case 'run':
      return (
        <RunPane
          id={item.id}
          focused={focused}
          width={width}
          height={runBody(height)}
          onBack={onBack}
        />
      )
    case 'pull':
      return (
        <PullPane
          number={Number(item.id)}
          focused={focused}
          width={width}
          onBack={onBack}
          onWork={sessionId => onSelect(`session:${sessionId}`)}
        />
      )
    case 'ritual':
      return (
        <RitualPane
          schedule={sources.schedules.find(schedule => schedule.id === item.id)}
          history={sources.histories[item.id]}
          focused={focused}
          width={width}
          onBack={onBack}
          onChanged={onChanged}
        />
      )
    case 'inbox': {
      const [sourceKey = ''] = item.key.slice('inbox:'.length).split(':')
      return (
        <InboxPane
          source={sources.inbox.find(source => source.key === sourceKey)}
          itemId={item.id}
          focused={focused}
          width={width}
          onBack={onBack}
          onChanged={onChanged}
        />
      )
    }
    case 'project':
      return (
        <ProjectPane
          project={sources.projects.find(project => project.path === item.id)}
          focused={focused}
          width={width}
          onBack={onBack}
        />
      )
  }
}
