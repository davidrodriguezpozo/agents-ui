import { Box, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { matchesFilter, windowAround, type Tone } from '../format'
import type { Pull } from '../types'
import {
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Meters,
  Rule,
  Split,
  TwoLineRow,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { isWide, listCapacity, listLayout } from './theme'

export function LandView({
  onOpenSession,
  isActive,
}: {
  onOpenSession: (id: string) => void
  isActive: boolean
}) {
  const { api, mode, setMode, action, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const [filter, setFilter] = useState('')
  const poll = usePoll(signal => api.pulls(signal), 120_000)
  const reading = poll.data

  const reviewing = useMemo(
    () => (reading?.reviewing ?? []).filter(p => matchesFilter(haystack(p), filter)),
    [reading, filter],
  )
  const mine = useMemo(
    () => (reading?.mine ?? []).filter(p => matchesFilter(haystack(p), filter)),
    [reading, filter],
  )
  const pulls = useMemo(() => [...reviewing, ...mine], [reviewing, mine])
  const [index] = useSelection(pulls.length, isActive && mode === 'nav')
  const selected = pulls[index]
  const chrome = wide ? 11 : 14
  const shown = windowAround(pulls, index, listCapacity(rows, chrome, 2))
  const summary = reading?.summary
  const listWidth = wide ? Math.floor(columns * 0.52) : layout.inner
  const inspectorWidth = wide ? Math.max(24, columns - listWidth - 8) : layout.inner

  useInput((input, key) => {
    if (input === '/') setMode('filter')
    if (key.return && selected) void work(selected)
    if (input === 'm' && selected) void merge(selected)
    if (input === 'r') poll.refresh()
    if (input === 'o') {
      if (selected) openBrowser(selected.url)
      else openBrowser('/land')
    }
  }, { isActive: isActive && mode === 'nav' })

  async function work(pull: Pull) {
    let id: string | null = null
    const ok = await action.run('Starting a session…', async () => {
      const started = await api.workOnPull(pull.number)
      id = started.id
    })
    if (ok && id) onOpenSession(id)
  }

  async function merge(pull: Pull) {
    await action.run(`Merging #${pull.number}…`, () => api.mergePull(pull.number))
    poll.refresh()
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {summary ? (
        <Box paddingBottom={1}>
          <Meters items={[
            { value: String(summary.onYou), label: 'on you', tone: summary.onYou ? 'cyan' : 'gray' },
            { value: String(summary.toMerge), label: 'to merge', tone: summary.toMerge ? 'green' : 'gray' },
            { value: String(summary.waiting), label: 'waiting', tone: 'gray' },
          ]}
          />
        </Box>
      ) : null}
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : reading && !reading.ok ? (
        <EmptyState>{reading.reason || 'Could not read pull requests.'}</EmptyState>
      ) : pulls.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'No pull requests with your name on them.'}</EmptyState>
      ) : (
        shown.map((pull, i) => {
          const prev = shown[i - 1]
          const group = pull.mine ? 'Yours' : 'Asked of you'
          const prevGroup = prev ? (prev.mine ? 'Yours' : 'Asked of you') : null
          return (
            <Box key={pull.number} flexDirection="column">
              {group !== prevGroup ? (
                <Rule
                  label={`${group}  ${pull.mine ? mine.length : reviewing.length}`}
                  width={listWidth}
                />
              ) : null}
              <PullRow pull={pull} selected={pull.number === selected?.number} width={listWidth} />
            </Box>
          )
        })
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Split
        wide={wide}
        listWidth={listWidth}
        list={list}
        inspector={
          selected ? (
            <LandInspector pull={selected} width={inspectorWidth} />
          ) : (
            <Inspector
              title="Land"
              lines={['Pull requests with your name on them.']}
              hint="⏎ start a session   m merge   o github"
              width={inspectorWidth}
            />
          )
        }
      />
      {mode === 'filter' && isActive ? (
        <FilterBar
          value={filter}
          onChange={setFilter}
          onClose={clear => {
            if (clear) setFilter('')
            setMode('nav')
          }}
          isActive
        />
      ) : null}
    </Box>
  )
}

function haystack(pull: Pull): string {
  return `#${pull.number} ${pull.title} ${pull.author} ${pull.verdict.label} ${pull.headBranch}`
}

function pullTone(pull: Pull): Tone {
  if (pull.verdict.onYou) return 'cyan'
  if (pull.checks === 'failing') return 'yellow'
  if (pull.verdict.state === 'ready') return 'green'
  return 'gray'
}

function PullRow({ pull, selected, width }: { pull: Pull; selected: boolean; width: number }) {
  const tone = pullTone(pull)
  const files = pull.changedFiles
    ? `${pull.changedFiles} file${pull.changedFiles === 1 ? '' : 's'}  +${pull.additions}/−${pull.deletions}`
    : ''
  const detail = [
    pull.mine ? 'yours' : pull.author,
    files,
    pull.checks === 'none' ? null : `checks ${pull.checks}`,
    pull.draft ? 'draft' : null,
  ].filter(Boolean).join(' · ')

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} />}
      status={`#${pull.number}`}
      statusTone={tone}
      title={pull.title}
      trailing={pull.verdict.label}
      detail={detail}
      width={width}
    />
  )
}

function LandInspector({ pull, width }: { pull: Pull; width: number }) {
  return (
    <Inspector
      title={`#${pull.number}  ${pull.title}`}
      lines={[
        pull.verdict.label,
        pull.verdict.detail,
        `${pull.headBranch} → ${pull.baseBranch}`,
        pull.changedFiles
          ? `${pull.changedFiles} files  +${pull.additions}/−${pull.deletions}`
          : '',
        pull.intent ? `when you work on it: ${pull.intent}` : '',
        pull.mine ? 'opened by you' : `opened by ${pull.author}`,
      ]}
      hint="⏎ start a session   m merge   o github"
      width={width}
    />
  )
}
