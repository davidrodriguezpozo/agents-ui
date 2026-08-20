import { Box, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { compactAge, matchesFilter, windowAround, type Tone } from '../format'
import type { InboxSource } from '../types'
import {
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { isWide, listCapacity, listLayout } from './theme'

interface Row {
  key: string
  source: InboxSource
  item?: InboxSource['items'][number]
}

export function InboxView({ isActive }: { isActive: boolean }) {
  const { api, mode, setMode, action, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const [filter, setFilter] = useState('')
  const poll = usePoll(signal => api.inbox(signal), 30_000)
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

  const [index] = useSelection(rowsList.length, isActive && mode === 'nav')
  const selected = rowsList[index]
  const chrome = wide ? 10 : 13
  const shown = windowAround(rowsList, index, listCapacity(rows, chrome, 2))
  const waiting = sources.reduce((n, s) => n + s.items.length, 0)
  const listWidth = wide ? Math.floor(columns * 0.52) : layout.inner
  const inspectorWidth = wide ? Math.max(24, columns - listWidth - 8) : layout.inner

  useInput((input, key) => {
    if (input === '/') setMode('filter')
    if (input === 'r' && selected) void refresh(selected.source.key)
    if (input === 'x' && selected?.item) void dismiss(selected)
    if (key.return && selected?.item) openBrowser(selected.item.url)
    if (input === 'o') {
      if (selected?.item) openBrowser(selected.item.url)
      else openBrowser('/')
    }
  }, { isActive: isActive && mode === 'nav' })

  async function refresh(source: string) {
    await action.run('Looking again — this can take a minute…', () => api.refreshInbox(source))
    poll.refresh()
  }

  async function dismiss(row: Row) {
    if (!row.item) return
    await action.run(null, () => api.dismissInbox(row.source.key, row.item!.id))
    poll.refresh()
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : rowsList.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'Nothing waiting elsewhere.'}</EmptyState>
      ) : (
        shown.map(row => (
          <InboxRow
            key={row.key}
            row={row}
            selected={row.key === selected?.key}
            width={listWidth}
          />
        ))
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
            <InboxInspector row={selected} width={inspectorWidth} />
          ) : (
            <Inspector
              title="Inbox"
              lines={[waiting ? `${waiting} waiting elsewhere` : 'Caught up.']}
              hint="⏎ open   r look again   x dismiss"
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

function InboxRow({
  row,
  selected,
  width,
}: {
  row: Row
  selected: boolean
  width: number
}) {
  const tone: Tone = row.source.error ? 'red' : row.item ? 'cyan' : 'gray'
  const title = row.item?.title ?? (row.source.error ? row.source.error : 'Nothing waiting')
  const detail = row.item?.why
    || (row.source.error ? row.source.error : 'Quiet')
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
    />
  )
}

function InboxInspector({ row, width }: { row: Row; width: number }) {
  return (
    <Inspector
      title={row.item?.title ?? row.source.label}
      lines={[
        row.source.label,
        row.item?.why ?? (row.source.error ?? 'Nothing waiting from this source.'),
        row.source.checkedAt ? `checked ${compactAge(row.source.checkedAt)} ago` : 'never checked',
        row.source.costUsd != null ? `last look $${row.source.costUsd.toFixed(2)}` : '',
      ]}
      hint={row.item ? '⏎ open   r look again   x dismiss' : 'r look again'}
      width={width}
    />
  )
}
