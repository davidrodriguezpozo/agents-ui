import { Box, Text, useInput } from 'ink'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { Tone } from '../format'
import { pad, spinnerFrame, truncate } from '../format'
import type { Span } from '../markdown'
import { BINDINGS, bindingsFor, type Surface } from '../keymap'
import { VIEWS, type ViewId } from './context'
import { ACCENT, CURSOR, GLYPH, LAYOUT, WORKING_GLYPH, inkColor } from './theme'

export function Header({
  left,
  right,
  problem,
  pending,
}: {
  left: string
  right: string
  /** Said plainly rather than left to a stale list: the server can go away. */
  problem?: string | null
  /** A half-typed count or chord, so a dropped key looks different from a slow one. */
  pending?: string
}) {
  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={ACCENT} bold>{left}</Text>
        {pending ? <Text color="yellow">{`  ${pending}`}</Text> : null}
      </Box>
      <Text color={problem ? 'yellow' : 'gray'}>{problem || right}</Text>
    </Box>
  )
}

/**
 * The views, as a tab strip rather than a title you have to remember the
 * numbers for.
 *
 * A count next to a tab is only drawn when it is news — zero is not a badge —
 * and it is coloured by what it means rather than by whether the tab happens to
 * be selected. The old rule tied it to selection, so "3 need you" sitting on
 * another tab was the same grey as the chrome around it, which is precisely the
 * case a badge exists for.
 */
export function NavTabs({
  view,
  counts,
}: {
  view: ViewId
  counts?: Partial<Record<ViewId, { value: number; tone: Tone }>>
}) {
  return (
    <Box paddingTop={1} paddingBottom={1}>
      {VIEWS.map((item) => {
        const selected = item.id === view
        const count = counts?.[item.id]
        return (
          <Box key={item.id} marginRight={3}>
            <Text color={selected ? ACCENT : 'gray'} dimColor={!selected}>
              {item.chord}
              {' '}
            </Text>
            <Text color={selected ? ACCENT : 'gray'} bold={selected} underline={selected}>
              {item.label}
            </Text>
            {count?.value ? (
              <Text color={inkColor(count.tone)} bold>{` ${count.value}`}</Text>
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
 *
 * Carries the position in the list on its right, because a window onto eleven
 * rows that shows eight of them and says so is a list, and one that does not is
 * a mystery.
 */
export function Chips({
  items,
  active,
  position,
}: {
  items: { id: string; label: string; count?: number }[]
  active: string
  position?: string
}) {
  return (
    <Box paddingBottom={1} justifyContent="space-between">
      <Box>
        {items.map((item) => {
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
      {position ? <Text color="gray">{position}</Text> : null}
    </Box>
  )
}

/** `3/11`, or nothing at all when everything fits. */
export function position(index: number, total: number, shown: number): string | undefined {
  if (total <= shown) return undefined
  return `${Math.min(index + 1, total)}/${total}`
}

export function Footer({ keys }: { keys: string }) {
  return (
    <Box paddingTop={1}>
      <Text color="gray" wrap="truncate">{keys}</Text>
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

/**
 * The one line that says what just happened.
 *
 * Always two rows tall, whether or not it has anything to say: a bar that
 * appears and disappears takes a row off the list underneath it, and a list
 * that jumps by one row whenever an action reports is worse than a blank line.
 *
 * A spinner while something is in the air, because "Running checks…" as static
 * text for four minutes is indistinguishable from a wedged app.
 */
export function MessageBar({
  text,
  tone,
  spinning,
  tick,
}: {
  text: string | null
  tone?: 'error' | 'info' | null
  spinning?: boolean
  tick?: number
}) {
  return (
    <Box paddingTop={1} height={2}>
      <Text color={tone === 'error' ? 'red' : ACCENT} wrap="truncate">
        {text ? `${spinning ? `${spinnerFrame(tick ?? 0)} ` : ''}${text}` : ' '}
      </Text>
    </Box>
  )
}

/**
 * One line of a transcript, styled or plain.
 *
 * Ink nests `<Text>`, so a line of spans is a line of spans — which is what
 * makes bold headings and coloured code possible without a second renderer.
 */
export function RichLine({
  spans,
  text,
  tone,
}: {
  spans?: Span[]
  text: string
  tone?: Tone
}) {
  if (!spans?.length) {
    return (
      <Text color={tone ? inkColor(tone) : undefined} wrap="truncate">
        {text || ' '}
      </Text>
    )
  }

  return (
    <Text wrap="truncate">
      {spans.map((span, i) => (
        <Text
          key={i}
          color={span.tone ? inkColor(span.tone) : undefined}
          bold={span.bold}
          underline={span.underline}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  )
}

export function Glyph({ tone, spinning, frame }: { tone: Tone; spinning?: boolean; frame?: string }) {
  const mark = spinning ? (frame || WORKING_GLYPH) : GLYPH[tone]
  return <Text color={inkColor(tone)}>{mark}</Text>
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
  spaced,
}: {
  selected?: boolean
  glyph: ReactNode
  status?: string
  statusTone?: Tone
  title: string
  trailing?: string
  detail?: string
  width: number
  /** A blank line after the row, when the terminal is tall enough to give one. */
  spaced?: boolean
}) {
  const statusW = status ? LAYOUT.status : 0
  const trailW = trailing ? Math.min(Math.max(trailing.length, 4), 24) : 0
  const titleW = Math.max(
    8,
    width - LAYOUT.cursor - LAYOUT.gutter - (statusW ? statusW + 2 : 0) - (trailW ? trailW + 2 : 0),
  )

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={ACCENT}>{selected ? `${CURSOR} ` : '  '}</Text>
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
        {`    ${truncate(detail || ' ', Math.max(8, width - 4))}`}
      </Text>
      {spaced ? <Text> </Text> : null}
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
      {hint ? (
        <Box paddingTop={1}>
          <Text color="gray" wrap="truncate">{truncate(hint, inner)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

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
  placeholder = 'filter',
}: {
  value: string
  onChange: (next: string) => void
  onClose: (clear: boolean) => void
  isActive: boolean
  placeholder?: string
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
        placeholder={placeholder}
      />
    </Box>
  )
}

/**
 * A box you can type in, with the editing keys a terminal person expects.
 *
 * Backspace alone is not a text field. The instruction you are writing here is
 * the same instruction you would write in the browser's composer, and getting a
 * word wrong in it meant deleting the rest of the line — so ⌃w, ⌃u, ⌃k, ⌃a, ⌃e
 * and the arrows, which between them are what every readline on this machine
 * already does.
 */
export function TextField({
  value,
  onChange,
  onSubmit,
  onCancel,
  isActive,
  prefix = '› ',
  placeholder = '',
  width,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  isActive: boolean
  prefix?: string
  placeholder?: string
  width?: number
}) {
  const [cursor, setCursor] = useState(value.length)
  const at = Math.min(cursor, value.length)

  function edit(next: string, position: number) {
    onChange(next)
    setCursor(Math.max(0, Math.min(next.length, position)))
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    // ⌃j is a newline, because a terminal cannot tell ⇧⏎ from ⏎ and Enter has
    // to mean send — it is the key you press a hundred times a day.
    if (key.return) {
      if (key.shift) edit(`${value.slice(0, at)}\n${value.slice(at)}`, at + 1)
      else onSubmit()
      return
    }
    if (key.ctrl) {
      switch (input) {
        case 'j':
          edit(`${value.slice(0, at)}\n${value.slice(at)}`, at + 1)
          return
        case 'a':
          setCursor(0)
          return
        case 'e':
          setCursor(value.length)
          return
        case 'u':
          edit(value.slice(at), 0)
          return
        case 'k':
          edit(value.slice(0, at), at)
          return
        case 'w': {
          const head = value.slice(0, at).replace(/\s*\S*$/, '')
          edit(head + value.slice(at), head.length)
          return
        }
        default:
          return
      }
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, at - 1))
      return
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, at + 1))
      return
    }
    if (key.backspace || key.delete) {
      if (at === 0) return
      edit(value.slice(0, at - 1) + value.slice(at), at - 1)
      return
    }
    // A paste arrives as one chunk rather than a key at a time, and it is
    // inserted whole for the same reason: it is one edit.
    if (input && !key.meta) edit(value.slice(0, at) + input + value.slice(at), at + input.length)
  }, { isActive })

  const shown = value || (isActive ? '' : placeholder)
  const room = width ? Math.max(8, width - prefix.length - 1) : undefined
  // The tail, when what has been typed is longer than the box: you want to see
  // where the cursor is, not the beginning of a paragraph.
  const visible = room && shown.length > room ? shown.slice(shown.length - room) : shown
  const trimmed = visible.length < shown.length
  const cut = shown.length - visible.length

  return (
    <Text wrap="truncate">
      <Text color={isActive ? ACCENT : 'gray'}>{prefix}</Text>
      {value ? (
        <>
          <Text color="white">{visible.slice(0, Math.max(0, at - cut))}</Text>
          {isActive ? (
            <Text color={ACCENT} inverse>
              {value[at] ?? ' '}
            </Text>
          ) : null}
          <Text color="white">
            {visible.slice(Math.max(0, at - cut) + (isActive && value[at] ? 1 : 0))}
          </Text>
        </>
      ) : (
        <>
          {isActive ? <Text color={ACCENT} inverse> </Text> : null}
          <Text color="gray">{trimmed ? '' : placeholder}</Text>
        </>
      )}
    </Text>
  )
}

/**
 * The one framed thing in the whole app.
 *
 * A box around everything is how a TUI starts looking busy. A box around a
 * permission prompt is how you notice you have to answer it.
 */
export function PermissionFrame({
  verb,
  target,
  reason,
}: {
  verb: string
  target: string
  /** What denying it would say back, while it is being typed. */
  reason?: ReactNode
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={ACCENT}
      paddingX={1}
      marginTop={1}
    >
      <Text wrap="truncate">
        <Text color="gray">Allow this?  wants to </Text>
        <Text color={ACCENT}>{verb}</Text>
        {target ? <Text>{`  ${target}`}</Text> : null}
      </Text>
      {reason ?? <Text color="gray">y once     a for this run     n deny     N deny and say why</Text>}
    </Box>
  )
}

/**
 * Asking first.
 *
 * For the keys that spend money, write to somebody else's repository, or throw
 * work away. Closing a session asked already; merging a pull request and filing
 * one did not, which was nothing but the order they were written in.
 */
export function Confirm({ question, detail }: { question: string; detail?: string[] }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" wrap="truncate">{question}</Text>
      {(detail ?? []).filter(Boolean).map((line, i) => (
        <Text key={i} color="gray" wrap="truncate">{line}</Text>
      ))}
      <Text color="gray">y yes     n no</Text>
    </Box>
  )
}

/**
 * The keys that apply where you are, read off the one table the handlers read.
 *
 * Contextual rather than complete, and that is the point: the whole table is
 * fifty rows, which does not fit a terminal and had to be split into columns
 * that then collided with each other. What you want when you press `?` is the
 * keys for the thing in front of you.
 */
export function HelpOverlay({ width, surfaces }: { width: number; surfaces: Surface[] }) {
  const titles: Record<Surface, string> = {
    global: 'Everywhere',
    list: 'In a list',
    work: 'Work',
    land: 'Land',
    daily: 'Daily',
    fleet: 'Fleet',
    inbox: 'Inbox',
    projects: 'Projects',
    session: 'In a session',
    diff: 'The diff',
    run: 'A run',
  }

  return (
    <Box flexDirection="column">
      {surfaces.map(surface => (
        <Box key={surface} flexDirection="column" paddingBottom={1}>
          <Text color="gray" bold>{titles[surface].toUpperCase()}</Text>
          {bindingsFor(surface).map(item => (
            <Text key={item.id} wrap="truncate">
              <Text color={ACCENT}>{pad(item.keys, 10)}</Text>
              <Text color="gray">{truncate(item.label, Math.max(10, width - 12))}</Text>
              {item.confirm ? <Text color="yellow"> · asks first</Text> : null}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** A count of the keys that ask before they act, for the help page's footer. */
export const CONFIRMED_KEYS = BINDINGS.filter(item => item.confirm).length

export function Rule({ label, width }: { label: string; width: number }) {
  const body = `─ ${label} `
  return <Text color="gray">{body + '─'.repeat(Math.max(0, width - body.length))}</Text>
}

export { LAYOUT }
