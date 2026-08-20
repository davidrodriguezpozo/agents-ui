import { Box, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { hint } from '../keymap'
import { matchesFilter, windowAround, type Tone } from '../format'
import type { Pull } from '../types'
import {
  Confirm,
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Meters,
  Rule,
  Split,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { CHROME, isWide, listCapacity, listLayout, splitWidths } from './theme'

export function LandView({
  onOpenSession,
  isActive,
}: {
  onOpenSession: (id: string) => void
  isActive: boolean
}) {
  const { api, mode, setMode, action, scope, openBrowser, motions, nudge, rowHeight } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns)
  const [filter, setFilter] = useState('')
  const [confirming, setConfirming] = useState<Pull | null>(null)

  /**
   * Keyed on the project, because `/api/github/pulls` is scoped to it.
   *
   * Without that, `]` left this list showing another repository's pull requests
   * for up to two minutes — and every key here acts on the selected row.
   */
  const poll = usePoll(signal => api.pulls(signal), {
    every: 120_000,
    deps: [scope, nudge],
  })
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

  const capacity = listCapacity(
    rows,
    [CHROME.meters, CHROME.rule, wide ? 0 : CHROME.inspector],
    rowHeight,
  )
  const [index] = useSelection(pulls.length, motions, isActive && mode === 'nav' && !confirming, capacity)
  const selected = pulls[index]
  const shown = windowAround(pulls, index, capacity)
  const summary = reading?.summary

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') {
        const pull = confirming
        setConfirming(null)
        void merge(pull)
      }
      if (input === 'n' || key.escape) setConfirming(null)
      return
    }
    if (input === '/') setMode('filter')
    if (key.return && selected) void work(selected)
    // Merging somebody's pull request is not a keystroke. It used to be.
    if (input === 'm' && selected) setConfirming(selected)
    if (input === 'r') poll.refresh()
    if (input === 'o') openBrowser(selected ? selected.url : '/land')
  }, { isActive: isActive && mode === 'nav' })

  async function work(pull: Pull) {
    let id: string | null = null
    const ok = await action.run(`work:${pull.number}`, 'Starting a session…', async () => {
      const started = await api.workOnPull(pull.number)
      id = started.id
    })
    if (ok && id) onOpenSession(id)
  }

  async function merge(pull: Pull) {
    await action.run(`merge:${pull.number}`, `Merging #${pull.number}…`, () => api.mergePull(pull.number))
    poll.refresh()
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {summary ? (
        <Meters items={[
          { value: String(summary.onYou), label: 'on you', tone: summary.onYou ? 'cyan' : 'gray' },
          { value: String(summary.toMerge), label: 'to merge', tone: summary.toMerge ? 'green' : 'gray' },
          { value: String(summary.waiting), label: 'waiting', tone: 'gray' },
        ]}
        />
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
                  width={widths.list}
                />
              ) : null}
              <PullRow
                pull={pull}
                selected={pull.number === selected?.number}
                width={widths.list}
                spaced={rowHeight === 3}
              />
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
        listWidth={widths.list}
        list={list}
        inspector={
          selected ? (
            <LandInspector
              pull={selected}
              width={wide ? widths.inspector : layout.inner}
              at={position(index, pulls.length, shown.length)}
            />
          ) : (
            <Inspector
              title="Land"
              lines={['Pull requests with your name on them.']}
              hint={hint(['land.work', 'land.merge', 'browser'])}
              width={wide ? widths.inspector : layout.inner}
            />
          )
        }
      />
      {confirming ? (
        <Confirm
          question={`Merge #${confirming.number} on GitHub?`}
          detail={[
            confirming.title,
            `${confirming.headBranch} → ${confirming.baseBranch}`,
            `checks ${confirming.checks}${confirming.mine ? '' : ` · opened by ${confirming.author}`}`,
          ]}
        />
      ) : null}
      {mode === 'filter' && isActive ? (
        <FilterBar
          value={filter}
          onChange={setFilter}
          onClose={(clear) => {
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

function PullRow({
  pull,
  selected,
  width,
  spaced,
}: {
  pull: Pull
  selected: boolean
  width: number
  spaced: boolean
}) {
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
      spaced={spaced}
    />
  )
}

function LandInspector({ pull, width, at }: { pull: Pull; width: number; at?: string }) {
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
        `${pull.mine ? 'opened by you' : `opened by ${pull.author}`}${at ? `   ${at}` : ''}`,
      ]}
      hint={hint(['land.work', 'land.merge', 'browser'])}
      width={width}
    />
  )
}
