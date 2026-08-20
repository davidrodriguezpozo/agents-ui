import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCost, formatDuration } from '~/utils/time'
import { buildWorkList, onTab, tabCounts, WORK_ORIGIN, type WorkItem, type WorkTab } from '~/utils/workList'
import { hint } from '../keymap'
import { followRun, type LiveRun } from '../runStream'
import { compactAge, matchesFilter, spinnerFrame, toneForRun, toneForWorkStatus, windowAround, windowOf } from '../format'
import { markdownLines } from '../markdown'
import type { Session, TranscriptSummary } from '../types'
import {
  Chips,
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TextField,
  RichLine,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { usePoll, useScroll, useSelection, useTerminalSize, useTick } from './hooks'
import { ACCENT, CHROME, isWide, listCapacity, listLayout, paneHeight, splitWidths } from './theme'

/**
 * Sessions and runs as one list, the way `/work` is in the browser.
 *
 * There is no Sessions view any more. A session is a row here — in flight
 * while it still wants something from you, in history once it is finished
 * with. `n` starts one, `a` continues a conversation you had in a terminal.
 */
export function WorkView({
  onOpenSession,
  onOpenRun,
  isActive,
}: {
  onOpenSession: (id: string) => void
  onOpenRun: (id: string) => void
  isActive: boolean
}) {
  const {
    api, mode, setMode, action, scope, openBrowser, motions, draft, setDraft, nudge, rowHeight,
  } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns)

  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<WorkTab>('flight')
  const [adopting, setAdopting] = useState<TranscriptSummary[] | null>(null)

  /**
   * History is the server's to search.
   *
   * The client used to hold eighty runs and filter those, so `/` in history
   * silently could not see anything older — and `/api/runs` has taken a `q`
   * all along. Short strings stay local, because one request per keystroke for
   * two characters is a lot of `q=a`.
   */
  const query = tab === 'history' && filter.trim().length >= 2 ? filter.trim() : ''
  const moving = useRef(true)

  const poll = usePoll(
    signal => Promise.all([
      api.sessions(signal),
      api.runs({ q: query || undefined }, signal),
    ]).then(([sessions, runs]) => ({ sessions, runs })),
    { every: 4_000, idle: 20_000, live: moving.current, deps: [scope, nudge, query] },
  )

  const sessions = poll.data?.sessions ?? []
  const runs = poll.data?.runs ?? []

  /**
   * Only this project's sessions.
   *
   * The server works `inCurrentProject` out per request and the browser splits
   * on it; the terminal was showing every project's sessions under a header
   * naming one, which is the sort of thing you only notice after acting on the
   * wrong row.
   */
  const here = useMemo(() => sessions.filter(session => session.inCurrentProject), [sessions])

  const items = useMemo(
    () => buildWorkList({ sessions: here as never, runs: runs as never }),
    [here, runs],
  )

  moving.current = items.some(item => item.status === 'running')

  const counts = useMemo(() => tabCounts(items), [items])
  const onThisTab = useMemo(() => onTab(items, tab), [items, tab])
  const visible = useMemo(
    () => onThisTab.filter(item => matchesFilter(
      `${item.title} ${item.outcome} ${item.detail ?? ''} ${item.origin}`,
      filter,
    )),
    [onThisTab, filter],
  )

  const tick = useTick(visible.some(item => item.status === 'running'))
  const capacity = listCapacity(rows, [CHROME.chips, wide ? 0 : CHROME.inspector], rowHeight)
  const [index] = useSelection(visible.length, motions, isActive && mode === 'nav' && !adopting, capacity)
  const selected = visible[index]
  const shown = windowAround(visible, index, capacity)

  useInput((input, key) => {
    if (adopting) {
      if (key.escape || input === 'a') setAdopting(null)
      return
    }
    if (input === '/') {
      setMode('filter')
      return
    }
    if (input === 'n') {
      setTab('flight')
      setMode('compose')
      return
    }
    if (input === 'a') {
      void offerTranscripts()
      return
    }
    if (key.tab) {
      setTab(current => (current === 'flight' ? 'history' : 'flight'))
      return
    }
    if (key.return && selected) open(selected)
    if (input === 'r') poll.refresh()
    if (input === 'o') openBrowser(selected ? selected.to : '/work')
  }, { isActive: isActive && mode === 'nav' })

  function open(item: WorkItem) {
    if (item.key.startsWith('session:')) onOpenSession(item.key.slice('session:'.length))
    else if (item.runId) onOpenRun(item.runId)
  }

  async function create() {
    const prompt = draft('work:new').trim()
    if (!prompt) return
    if (!scope) {
      await action.run('create', null, async () => {
        throw new Error('Pick a project first — ] to switch, or g p to choose one.')
      })
      return
    }
    const started = await action.run('create', 'Starting…', () => api.startSession({ prompt, repoDir: scope }))
    if (started) {
      setDraft('work:new', '')
      setMode('nav')
      poll.refresh()
    }
  }

  /**
   * The conversation you were just having, moved into a worktree.
   *
   * This is the most terminal-native thing the app can do and the terminal
   * client did not have it: you talk to Claude Code in a shell, decide it
   * deserves a branch and a check run, and `a` gives it one without repeating
   * yourself. The endpoint drops conversations already adopted, so the list is
   * only ever things that could still be taken.
   */
  async function offerTranscripts() {
    await action.run('adopt.list', 'Looking for conversations…', async () => {
      const { transcripts } = await api.transcripts()
      if (transcripts.length === 0) throw new Error('No terminal conversations here to continue.')
      setAdopting(transcripts)
    })
  }

  async function adopt(transcript: TranscriptSummary) {
    let id: string | null = null
    const ok = await action.run('adopt', 'Continuing it here…', async () => {
      const session = await api.adoptTranscript(transcript.sdkSessionId)
      id = session.id
    })
    setAdopting(null)
    if (ok && id) onOpenSession(id)
  }

  const selectedSession = selected?.key.startsWith('session:')
    ? here.find(session => session.id === selected.key.slice('session:'.length))
    : undefined

  if (adopting) {
    return (
      <AdoptList
        transcripts={adopting}
        width={layout.inner}
        rows={rows}
        onPick={transcript => { void adopt(transcript) }}
        isActive={isActive && mode === 'nav'}
      />
    )
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <Chips
        active={tab}
        items={[
          { id: 'flight', label: 'In flight', count: counts.flight },
          { id: 'history', label: 'History', count: counts.history },
        ]}
        position={position(index, visible.length, shown.length)}
      />
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !poll.data ? (
        <EmptyState>{`${poll.error}  ·  r to try again`}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          {filter
            ? 'Nothing matches.'
            : tab === 'flight'
              ? 'Nothing in flight. n starts a session, a continues a terminal one.'
              : 'Nothing in history yet.'}
        </EmptyState>
      ) : (
        shown.map(item => (
          <WorkRow
            key={item.key}
            item={item}
            selected={item.key === selected?.key}
            width={wide ? widths.list : layout.inner}
            frame={spinnerFrame(tick)}
            spaced={rowHeight === 3}
          />
        ))
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Split
        wide={wide}
        listWidth={widths.list}
        list={list}
        inspector={
          selected ? (
            <WorkInspector
              item={selected}
              session={selectedSession}
              width={wide ? widths.inspector : layout.inner}
            />
          ) : (
            <Inspector
              title={tab === 'flight' ? 'Nothing in flight' : 'History'}
              lines={[tab === 'flight'
                ? 'Sessions that still want something from you live here.'
                : 'Finished work, and runs that no session owns.']}
              hint={hint(['work.new', 'work.adopt', 'work.tab'])}
              width={wide ? widths.inspector : layout.inner}
            />
          )
        }
      />
      {mode === 'filter' && isActive ? (
        <FilterBar
          value={filter}
          onChange={setFilter}
          onClose={(clear) => {
            if (clear) setFilter('')
            setMode('nav')
          }}
          isActive
          placeholder={tab === 'history' ? 'search every run' : 'filter'}
        />
      ) : null}
      {mode === 'compose' && isActive ? (
        <Box paddingTop={1} flexDirection="column">
          <TextField
            value={draft('work:new')}
            onChange={value => setDraft('work:new', value)}
            onSubmit={() => { void create() }}
            onCancel={() => setMode('nav')}
            isActive
            prefix="› "
            placeholder="what should this session work on?"
            width={layout.inner}
          />
        </Box>
      ) : null}
    </Box>
  )
}

function WorkRow({
  item,
  selected,
  width,
  frame,
  spaced,
}: {
  item: WorkItem
  selected: boolean
  width: number
  frame: string
  spaced: boolean
}) {
  const tone = toneForWorkStatus(item.status)
  const origin = WORK_ORIGIN.find(entry => entry.value === item.origin)?.label ?? item.origin
  const bits = [
    item.outcome,
    item.detail,
    item.changedFiles ? `${item.changedFiles} file${item.changedFiles === 1 ? '' : 's'}` : null,
    item.turnCount ? `${item.turnCount} turn${item.turnCount === 1 ? '' : 's'}` : null,
    formatCost(item.costUsd),
    formatDuration(item.durationMs),
    origin !== 'yours' ? origin : null,
  ].filter(Boolean)

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} spinning={item.status === 'running'} frame={frame} />}
      title={item.title}
      trailing={compactAge(item.at)}
      detail={bits.join(' · ') || ' '}
      width={width}
      spaced={spaced}
    />
  )
}

function WorkInspector({
  item,
  session,
  width,
}: {
  item: WorkItem
  session?: Session
  width: number
}) {
  const origin = WORK_ORIGIN.find(entry => entry.value === item.origin)?.label ?? item.origin
  const lines: string[] = [item.outcome]

  if (session) {
    const wt = session.worktree
    const files = wt.changedFiles
      ? `${wt.changedFiles} file${wt.changedFiles === 1 ? '' : 's'}${wt.dirty ? ', uncommitted' : ''}`
      : 'no files changed'
    lines.push(`${session.branch} → ${session.baseBranch}`)
    if (wt.ahead || wt.behind) {
      lines.push([
        wt.ahead ? `${wt.ahead} ahead` : null,
        wt.behind ? `${wt.behind} behind` : null,
      ].filter(Boolean).join(' · '))
    }
    lines.push(files)
    if (session.check) lines.push(`checks ${session.check.status}`)
    if (session.pendingPermissions) lines.push(`${session.pendingPermissions} waiting on permission`)
    if (session.summary?.text) lines.push(session.summary.text)
  } else {
    if (item.detail) lines.push(item.detail)
    const extras = [
      origin,
      formatCost(item.costUsd),
      formatDuration(item.durationMs),
      compactAge(item.at),
    ].filter(Boolean)
    if (extras.length) lines.push(extras.join(' · '))
  }

  return (
    <Inspector
      title={item.title}
      lines={lines}
      hint={hint(['open', 'work.new', 'work.tab', 'browser'])}
      width={width}
    />
  )
}

/** The conversations on disk that could still be taken into a worktree. */
function AdoptList({
  transcripts,
  width,
  rows,
  onPick,
  isActive,
}: {
  transcripts: TranscriptSummary[]
  width: number
  rows: number
  onPick: (transcript: TranscriptSummary) => void
  isActive: boolean
}) {
  const [index, setIndex] = useState(0)
  const capacity = listCapacity(rows, [CHROME.chips], 2)
  const shown = windowAround(transcripts, index, capacity)

  useInput((input, key) => {
    if (key.downArrow || input === 'j') setIndex(i => Math.min(transcripts.length - 1, i + 1))
    if (key.upArrow || input === 'k') setIndex(i => Math.max(0, i - 1))
    if (key.return) {
      const picked = transcripts[index]
      if (picked) onPick(picked)
    }
  }, { isActive })

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingBottom={1}>
        <Text color="gray">
          {`Continue one of these here — it resumes where it left off, in a worktree of its own.`}
        </Text>
      </Box>
      {shown.map((transcript) => {
        const at = transcripts.indexOf(transcript)
        return (
          <TwoLineRow
            key={transcript.sdkSessionId}
            selected={at === index}
            glyph={<Glyph tone="gray" />}
            title={transcript.title}
            trailing={compactAge(transcript.updatedAt)}
            detail={`${transcript.turnCount} turn${transcript.turnCount === 1 ? '' : 's'}`}
            width={width}
          />
        )
      })}
      <Box paddingTop={1}>
        <Text color="gray">{'⏎ continue it here   esc back'}</Text>
      </Box>
    </Box>
  )
}

/**
 * A detached run.
 *
 * Streamed and scrollable, like a session: this was the one pane still reading
 * a run through a four-second poll and then throwing away everything past
 * `rows - 10`, which for the runs that matter — the ritual that failed at
 * 08:00 — is exactly the end you needed.
 */
export function RunDetailView({
  id,
  onBack,
  isActive,
}: {
  id: string
  onBack: () => void
  isActive: boolean
}) {
  const { api, openBrowser, motions, nudge } = useStudio()
  const { columns, rows } = useTerminalSize()
  const width = Math.max(20, columns - 4)
  const [live, setLive] = useState<LiveRun | null>(null)
  const [connected, setConnected] = useState(true)

  const poll = usePoll(signal => api.run(id, signal), {
    every: 10_000,
    live: !live || live.status === 'running' || live.status === 'queued',
    deps: [id, nudge],
  })
  const run = poll.data

  useEffect(() => {
    const controller = new AbortController()
    void followRun(api.client, id, {
      signal: controller.signal,
      onRun: setLive,
      onConnected: setConnected,
    })
    return () => controller.abort()
  }, [api, id])

  const status = live?.status ?? run?.status ?? 'queued'
  const tick = useTick(status === 'running' || status === 'queued')

  const output = (live?.output || run?.output || live?.error || run?.error || '').trim()
  // A run's output is Markdown too — often the most of it, since a ritual's
  // whole job is to report.
  const body = useMemo(
    () => markdownLines(output || 'No output yet.', width),
    [output, width],
  )
  const height = paneHeight(rows, [CHROME.header, CHROME.rule + 1])
  const scroll = useScroll(body.length, height, motions, isActive)
  const visible = windowOf(body, scroll.offset, height)

  useInput((input, key) => {
    if (key.escape) onBack()
    if (input === 'o') openBrowser(`/runs/${id}`)
    if (input === 'r') poll.refresh()
  }, { isActive })

  if (poll.loading && !run) return <EmptyState>Loading…</EmptyState>
  if (!run) return <EmptyState>{poll.error || 'That run is gone.'}</EmptyState>

  const meta = [
    status,
    formatCost(live?.stats?.costUsd ?? run.costUsd),
    formatDuration(live?.stats?.durationMs ?? run.durationMs),
    connected ? null : 'reconnecting…',
  ].filter(Boolean).join(' · ')

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color="gray">← </Text>
        <Text color={ACCENT} bold>{run.title}</Text>
      </Text>
      <Box paddingTop={1} paddingBottom={1}>
        <Text wrap="truncate">
          <Glyph
            tone={toneForRun(status)}
            spinning={status === 'running' || status === 'queued'}
            frame={spinnerFrame(tick)}
          />
          <Text color="gray">{`  ${meta}`}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((line, i) => (
          <RichLine key={`${scroll.offset}-${i}`} spans={line.spans} text={line.text} />
        ))}
      </Box>
      {!scroll.atBottom ? (
        <Text color="yellow">{`↓ ${scroll.behind} more below — G for the end`}</Text>
      ) : null}
      <Box paddingTop={1}>
        <Text color="gray">{hint(['run.scroll', 'run.back', 'browser'])}</Text>
      </Box>
    </Box>
  )
}
