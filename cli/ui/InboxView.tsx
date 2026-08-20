import { Box, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { hint } from '../keymap'
import { compactAge, matchesFilter, windowAround, type Tone } from '../format'
import type { InboxSource } from '../types'
import {
  Confirm,
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { CHROME, isWide, listCapacity, listLayout, splitWidths } from './theme'

interface Row {
  key: string
  source: InboxSource
  item?: InboxSource['items'][number]
}

export function InboxView({ isActive }: { isActive: boolean }) {
  const { api, mode, setMode, action, openBrowser, motions, nudge, rowHeight } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns)
  const [filter, setFilter] = useState('')
  const [confirming, setConfirming] = useState<InboxSource | null>(null)

  const poll = usePoll(signal => api.inbox(signal), { every: 60_000, deps: [nudge] })
  const sources = poll.data?.sources ?? []

  const rowsList: Row[] = useMemo(() => {
    const list: Row[] = []
    for (const source of sources) {
      if (source.items.length === 0) {
        list.push({ key: source.key, source })
        continue
      }
      for (const item of source.items) {
        list.push({ key: `${source.key}:${item.id}`, source, item })
      }
    }
    return list.filter(row => matchesFilter(
      `${row.source.label} ${row.item?.title ?? ''} ${row.item?.why ?? ''}`,
      filter,
    ))
  }, [sources, filter])

  const capacity = listCapacity(rows, [wide ? 0 : CHROME.inspector], rowHeight)
  const [index] = useSelection(
    rowsList.length,
    motions,
    isActive && mode === 'nav' && !confirming,
    capacity,
  )
  const selected = rowsList[index]
  const shown = windowAround(rowsList, index, capacity)
  const waiting = sources.reduce((total, source) => total + source.items.length, 0)

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') {
        const source = confirming
        setConfirming(null)
        void look(source)
      }
      if (input === 'n' || key.escape) setConfirming(null)
      return
    }
    if (input === '/') setMode('filter')
    if (input === 'r') poll.refresh()
    // Looking again spends an agent turn on every source it asks, so it is a
    // capital letter and a question, next to the `r` that only re-reads.
    if (input === 'R' && selected) setConfirming(selected.source)
    if (input === 'x' && selected?.item) void dismiss(selected)
    if (key.return && selected?.item) openBrowser(selected.item.url)
    if (input === 'o') openBrowser(selected?.item ? selected.item.url : '/')
  }, { isActive: isActive && mode === 'nav' })

  async function look(source: InboxSource) {
    await action.run(
      `look:${source.key}`,
      'Looking again — this can take a minute…',
      () => api.refreshInbox(source.key),
    )
    poll.refresh()
  }

  async function dismiss(row: Row) {
    if (!row.item) return
    await action.run(`dismiss:${row.item.id}`, null, () => api.dismissInbox(row.source.key, row.item!.id))
    poll.refresh()
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !poll.data ? (
        <EmptyState>{`${poll.error}  ·  r to try again`}</EmptyState>
      ) : rowsList.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'Nothing waiting elsewhere.'}</EmptyState>
      ) : (
        shown.map(row => (
          <InboxRow
            key={row.key}
            row={row}
            selected={row.key === selected?.key}
            width={widths.list}
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
            <InboxInspector
              row={selected}
              width={wide ? widths.inspector : layout.inner}
              at={position(index, rowsList.length, shown.length)}
            />
          ) : (
            <Inspector
              title="Inbox"
              lines={[waiting ? `${waiting} waiting elsewhere` : 'Caught up.']}
              hint={hint(['open', 'inbox.look', 'inbox.dismiss'])}
              width={wide ? widths.inspector : layout.inner}
            />
          )
        }
      />
      {confirming ? (
        <Confirm
          question={`Look at ${confirming.label} again?`}
          detail={[
            'It reads the source with an agent, which takes a minute and costs money.',
            confirming.costUsd != null ? `last look ${`$${confirming.costUsd.toFixed(2)}`}` : '',
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

function InboxRow({
  row,
  selected,
  width,
  spaced,
}: {
  row: Row
  selected: boolean
  width: number
  spaced: boolean
}) {
  const tone: Tone = row.source.error ? 'red' : row.item ? 'cyan' : 'gray'
  const title = row.item?.title ?? (row.source.error ? row.source.error : 'Nothing waiting')
  const detail = row.item?.why || (row.source.error ? row.source.error : 'Quiet')
  const trailing = row.source.checkedAt ? compactAge(row.source.checkedAt) : ''

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} />}
      status={row.source.label}
      statusTone={tone}
      title={title}
      trailing={trailing}
      detail={detail}
      width={width}
      spaced={spaced}
    />
  )
}

function InboxInspector({ row, width, at }: { row: Row; width: number; at?: string }) {
  return (
    <Inspector
      title={row.item?.title ?? row.source.label}
      lines={[
        row.source.label,
        row.item?.why ?? (row.source.error ?? 'Nothing waiting from this source.'),
        row.source.checkedAt ? `checked ${compactAge(row.source.checkedAt)} ago` : 'never checked',
        row.source.costUsd != null ? `last look $${row.source.costUsd.toFixed(2)}` : '',
        at ?? '',
      ]}
      hint={row.item
        ? hint(['open', 'inbox.look', 'inbox.dismiss'])
        : hint(['inbox.look', 'refresh'])}
      width={width}
    />
  )
}
