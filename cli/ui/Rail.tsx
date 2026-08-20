import { Box, Text } from 'ink'
import { useMemo } from 'react'
import { compactAge, spinnerFrame, windowAround } from '../format'
import { URGENCY, type RailItem } from '../rail'
import { EmptyState, Glyph, RailHeader, RailRow, Rule, position } from './components'

/**
 * The one list.
 *
 * Sessions, runs, pull requests, rituals, what is waiting elsewhere and the
 * projects themselves, grouped by how much they want you rather than by which
 * page they used to live on. It never goes away: on a wide terminal it sits
 * beside whatever it is pointing at, so switching between two running agents is
 * a keypress rather than a trip back out to a list.
 */
export function Rail({
  items,
  index,
  focused,
  label,
  unread,
  width,
  capacity,
  rowHeight,
  tick,
  loading,
  problem,
}: {
  items: RailItem[]
  index: number
  focused: boolean
  label: string
  unread: Set<string>
  width: number
  capacity: number
  rowHeight: 2 | 3
  tick: number
  loading: boolean
  problem: string | null
}) {
  const selected = items[index]
  const shown = useMemo(() => windowAround(items, index, capacity), [items, index, capacity])
  const now = Date.now()

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <RailHeader
        label={label}
        count={items.length}
        position={position(index, items.length, shown.length)}
        unread={unread.size}
        width={width}
      />
      {items.length === 0 ? (
        <EmptyState>
          {loading
            ? 'Looking…'
            : problem
              ? `${problem}  ·  r to try again`
              : 'Nothing here. n starts a session, a continues a terminal one.'}
        </EmptyState>
      ) : (
        shown.map((item, i) => {
          const previous = shown[i - 1]
          // A band heading whenever the urgency changes, and on the first row
          // shown — a window into the middle of a list has to say which band it
          // opened in.
          const heading = !previous || previous.urgency !== item.urgency ? item.urgency : null
          const band = heading ? items.filter(other => other.urgency === heading).length : 0

          return (
            <Box key={item.key} flexDirection="column" flexShrink={0}>
              {heading ? (
                <Rule
                  label={`${URGENCY.find(entry => entry.id === heading)?.label ?? heading}  ${band}`}
                  width={width}
                />
              ) : null}
              <RailRow
                selected={item.key === selected?.key}
                focused={focused}
                glyph={<Glyph tone={item.tone} spinning={item.spinning} frame={spinnerFrame(tick)} />}
                title={item.title}
                status={item.status}
                detail={item.detail}
                trailing={item.at ? compactAge(item.at, now) : ''}
                unread={unread.has(item.key)}
                width={width}
                spaced={rowHeight === 3}
              />
            </Box>
          )
        })
      )}
      {items.length > shown.length ? (
        <Text color="gray">{`  ${items.length - shown.length} more`}</Text>
      ) : null}
    </Box>
  )
}
