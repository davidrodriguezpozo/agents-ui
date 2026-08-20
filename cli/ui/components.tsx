import { Box, Text, useInput } from 'ink'
import type { ReactNode } from 'react'
import type { Tone } from '../format'
import { pad, truncate } from '../format'
import { VIEWS, type ViewId } from './context'
import { ACCENT, GLYPH, LAYOUT, WORKING_GLYPH, inkColor } from './theme'

export function Header({ left, right }: { left: string; right: string }) {
  return (
    <Box justifyContent="space-between">
      <Text color={ACCENT} bold>{left}</Text>
      <Text color="gray">{right}</Text>
    </Box>
  )
}

/**
 * The views, as a tab strip rather than a title you have to remember the
 * numbers for.
 *
 * A count next to a tab is only drawn when it is news — zero is not a badge.
 */
export function NavTabs({
  view,
  counts,
}: {
  view: ViewId
  counts?: Partial<Record<ViewId, number>>
}) {
  return (
    <Box paddingTop={1} paddingBottom={1}>
      {VIEWS.map(item => {
        const selected = item.id === view
        const count = counts?.[item.id]
        return (
          <Box key={item.id} marginRight={3}>
            <Text color={selected ? ACCENT : 'gray'} dimColor={!selected}>
              {item.key}
              {' '}
            </Text>
            <Text color={selected ? ACCENT : 'gray'} bold={selected} underline={selected}>
              {item.label}
            </Text>
            {count ? (
              <Text color={selected ? ACCENT : 'gray'}>{` ${count}`}</Text>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

export function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <Box justifyContent="space-between" paddingBottom={1}>
      <Text color="gray" bold>{title.toUpperCase()}</Text>
      {meta ? <Text color="gray">{meta}</Text> : null}
    </Box>
  )
}

/**
 * In-flight / history, or any other pair of filters that live *inside* a view.
 */
export function Chips({
  items,
  active,
}: {
  items: { id: string; label: string; count?: number }[]
  active: string
}) {
  return (
    <Box paddingBottom={1}>
      {items.map(item => {
        const selected = item.id === active
        return (
          <Box key={item.id} marginRight={3}>
            <Text color={selected ? ACCENT : 'gray'} bold={selected} underline={selected}>
              {item.label}
            </Text>
            {item.count != null ? <Text color="gray">{` ${item.count}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

export function Footer({ keys }: { keys: string }) {
  return (
    <Box paddingTop={1}>
      <Text color="gray">{keys}</Text>
    </Box>
  )
}

export function EmptyState({ children }: { children: string }) {
  return (
    <Box paddingTop={1}>
      <Text color="gray">{children}</Text>
    </Box>
  )
}

export function MessageBar({ text, tone }: { text: string | null; tone?: 'error' | 'info' | null }) {
  if (!text) return null
  return (
    <Box paddingTop={1}>
      <Text color={tone === 'error' ? 'red' : ACCENT}>{text}</Text>
    </Box>
  )
}

export function Glyph({ tone, spinning, frame }: { tone: Tone; spinning?: boolean; frame?: string }) {
  const mark = spinning ? (frame || WORKING_GLYPH) : GLYPH[tone]
  return <Text color={inkColor(tone)}>{mark}</Text>
}

/**
 * One line of a list, with the columns already padded.
 *
 * Kept for the few surfaces that are still a single line (help, history). The
 * lists you read every day use `TwoLineRow`.
 */
export function Columns(props: {
  selected?: boolean
  glyph: ReactNode
  status: string
  statusTone: Tone
  title: string
  titleWidth: number
  trailing?: string
}) {
  return (
    <Text wrap="truncate">
      {props.glyph}
      <Text> </Text>
      <Text color={inkColor(props.statusTone)}>{pad(props.status, LAYOUT.status)}</Text>
      <Text>{'  '}</Text>
      <Text color={props.selected ? ACCENT : 'white'} bold={props.selected}>
        {pad(props.title, props.titleWidth)}
      </Text>
      {props.trailing ? <Text color="gray">{props.trailing}</Text> : null}
    </Text>
  )
}

/**
 * A list row that can actually say something.
 *
 * The first line is what it is (status, title, a timestamp). The second is
 * why you would pick it (a branch, a verdict, a tool call). A one-line list
 * was a command palette with extra steps.
 */
export function TwoLineRow({
  selected,
  glyph,
  status,
  statusTone,
  title,
  trailing,
  detail,
  width,
}: {
  selected?: boolean
  glyph: ReactNode
  status?: string
  statusTone?: Tone
  title: string
  trailing?: string
  detail?: string
  width: number
}) {
  const statusW = status ? LAYOUT.status : 0
  const trailW = trailing ? Math.min(Math.max(trailing.length, 4), 24) : 0
  const titleW = Math.max(8, width - LAYOUT.gutter - (statusW ? statusW + 2 : 0) - (trailW ? trailW + 2 : 0))

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        {glyph}
        <Text> </Text>
        {status && statusTone ? (
          <Text color={inkColor(statusTone)}>{pad(status, statusW)}  </Text>
        ) : null}
        <Text color={selected ? ACCENT : 'white'} bold={selected}>
          {pad(title, titleW)}
        </Text>
        {trailing ? <Text color="gray">{pad(trailing, trailW, 'right')}</Text> : null}
      </Text>
      <Text color="gray" wrap="truncate">
        {`  ${truncate(detail || ' ', Math.max(8, width - 2))}`}
      </Text>
    </Box>
  )
}

/**
 * A list, and what the selected row is.
 *
 * Side by side when the terminal is wide enough that neither pane would be a
 * sliver; stacked otherwise. The inspector is the same component either way —
 * only where it sits changes.
 */
export function Split({
  wide,
  listWidth,
  list,
  inspector,
}: {
  wide: boolean
  listWidth: number
  list: ReactNode
  inspector: ReactNode
}) {
  if (!wide) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>{list}</Box>
        {inspector}
      </Box>
    )
  }

  return (
    <Box flexGrow={1}>
      <Box flexDirection="column" width={listWidth} flexShrink={0}>{list}</Box>
      <Box flexDirection="column" flexGrow={1} paddingLeft={3}>{inspector}</Box>
    </Box>
  )
}

/**
 * The selected row, expanded.
 *
 * Lives at the bottom of a narrow pane, or down the right of a wide one. Either
 * way it is the place a view stops being a list of names.
 */
export function Inspector({
  title,
  lines,
  hint,
  width,
}: {
  title: string
  lines: string[]
  hint?: string
  width: number
}) {
  const inner = Math.max(8, width)
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text color="gray">{'─'.repeat(inner)}</Text>
      <Text bold wrap="truncate">{truncate(title, inner)}</Text>
      {lines.filter(Boolean).map((line, i) => (
        <Text key={i} color="gray" wrap="truncate">{truncate(line, inner)}</Text>
      ))}
      {hint ? <Text color="gray" wrap="truncate">{truncate(hint, inner)}</Text> : null}
    </Box>
  )
}

/**
 * The selected row, expanded.
 *
 * Lives at the bottom of a narrow pane, or down the right of a wide one. Either
 * way it is the place a view stops being a list of names.
 */

export function Meters({
  items,
}: {
  items: { value: string; label: string; tone?: Tone }[]
}) {
  return (
    <Box paddingBottom={1}>
      {items.map(item => (
        <Box key={item.label} marginRight={4}>
          <Text color={item.tone ? inkColor(item.tone) : 'white'} bold>
            {item.value}
          </Text>
          <Text color="gray">{` ${item.label}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function MeterBar({
  fraction,
  width,
  tone,
  label,
}: {
  fraction: number
  width: number
  tone: Tone
  label: string
}) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return (
    <Text>
      <Text color={inkColor(tone)}>{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(Math.max(0, width - filled))}</Text>
      <Text color="gray">{`  ${label}`}</Text>
    </Text>
  )
}

export function FilterBar({
  value,
  onChange,
  onClose,
  isActive,
}: {
  value: string
  onChange: (next: string) => void
  onClose: (clear: boolean) => void
  isActive: boolean
}) {
  return (
    <Box paddingTop={1}>
      <TextField
        value={value}
        onChange={onChange}
        onSubmit={() => onClose(false)}
        onCancel={() => onClose(true)}
        isActive={isActive}
        prefix="/ "
        placeholder="filter"
      />
    </Box>
  )
}

export function TextField({
  value,
  onChange,
  onSubmit,
  onCancel,
  isActive,
  prefix = '› ',
  placeholder = '',
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  isActive: boolean
  prefix?: string
  placeholder?: string
}) {
  useInput((input, key) => {
    if (key.escape) onCancel()
    else if (key.return) onSubmit()
    else if (key.backspace || key.delete) onChange(value.slice(0, -1))
    else if (key.ctrl && input === 'j') onChange(`${value}\n`)
    else if (input && !key.ctrl && !key.meta) onChange(value + input)
  }, { isActive })

  return (
    <Text>
      <Text color={isActive ? ACCENT : 'gray'}>{prefix}</Text>
      <Text color={value ? 'white' : 'gray'}>{value || placeholder}</Text>
      {isActive ? <Text color={ACCENT}>█</Text> : null}
    </Text>
  )
}

/**
 * The one framed thing in the whole app.
 *
 * A box around everything is how a TUI starts looking busy. A box around a
 * permission prompt is how you notice you have to answer it.
 */
export function PermissionFrame({ verb, target }: { verb: string; target: string }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={ACCENT}
      paddingX={1}
      marginTop={1}
    >
      <Text>
        <Text color="gray">Allow this?  wants to </Text>
        <Text color={ACCENT}>{verb}</Text>
        {target ? <Text>  {target}</Text> : null}
      </Text>
      <Text color="gray">y once     a for this run     n deny</Text>
    </Box>
  )
}

export function HelpOverlay() {
  return (
    <Box flexDirection="column">
      <SectionTitle title="Keys" />
      <HelpRow keys="h l" text="Previous / next view" />
      <HelpRow keys="1–6" text="Work · Land · Daily · Fleet · Inbox · Projects" />
      <HelpRow keys="[ ]" text="Previous / next project" />
      <HelpRow keys="tab" text="In-flight / history (on Work)" />
      <HelpRow keys="↑↓  j k" text="Move" />
      <HelpRow keys="⏎" text="Open" />
      <HelpRow keys="/ n" text="Filter · new session" />
      <HelpRow keys="i" text="Write an instruction" />
      <HelpRow keys="d c x" text="Diff · checks · stop the run" />
      <HelpRow keys="y a n" text="Allow once · allow for the run · deny" />
      <HelpRow keys="s o" text="Shell in the worktree · open in the browser" />
      <HelpRow keys="r e" text="Refresh, or run a ritual / toggle it" />
      <HelpRow keys="m" text="Merge the selected pull request" />
      <HelpRow keys="? q" text="This page · quit" />
      <Box paddingTop={1}>
        <Text color="gray">esc closes this, or goes back.</Text>
      </Box>
    </Box>
  )
}

function HelpRow({ keys, text }: { keys: string; text: string }) {
  return (
    <Text>
      <Text color={ACCENT}>{pad(keys, 10)}</Text>
      <Text color="gray">{text}</Text>
    </Text>
  )
}

export function Rule({ label, width }: { label: string; width: number }) {
  const body = `─ ${label} `
  return <Text color="gray">{body + '─'.repeat(Math.max(0, width - body.length))}</Text>
}

export { LAYOUT }
