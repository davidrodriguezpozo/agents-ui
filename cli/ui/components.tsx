import { Box, Text, useInput } from 'ink'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { Tone } from '../format'
import { pad, plain, spinnerFrame, truncate } from '../format'
import type { Span } from '../markdown'
import type { Job } from './hooks'
import type { Keymap, Surface } from '../keymap'
import { ACCENT, CURSOR, GLYPH, LAYOUT, WORKING_GLYPH, inkColor } from './theme'

/**
 * One line that says where you are, what is happening, and whether the server
 * is still there.
 *
 * A vim statusline rather than a title: the mode first, because a modal app that
 * does not say which mode it is in is the cruellest thing a text interface can
 * do, then what the rail is showing, then the counts, then the project. The tab
 * strip this replaces advertised six destinations that no longer exist — the
 * rail is one surface, and what it shows is a filter rather than a place.
 */
export function StatusLine({
  mode,
  filter,
  counts,
  project,
  local,
  spend,
  problem,
  pending,
  width,
}: {
  mode: string
  filter: string
  counts: { needsYou: number; working: number; unread: number }
  project: string
  local: boolean
  spend?: string
  problem?: string | null
  pending?: string
  width: number
}) {
  const right = [
    counts.needsYou ? `${counts.needsYou} need you` : null,
    counts.working ? `${counts.working} working` : null,
    counts.unread ? `${counts.unread} new` : null,
    spend,
    `${project}${local ? ' · here only' : ''}`,
  ].filter(Boolean).join(' · ')

  return (
    <Box justifyContent="space-between" width={width}>
      <Box>
        <Text color={ACCENT} bold>{mode.toUpperCase()}</Text>
        <Text color="gray">{`  ${filter}`}</Text>
        {pending ? <Text color="yellow">{`  ${pending}`}</Text> : null}
      </Box>
      <Text color={problem ? 'yellow' : 'gray'} wrap="truncate">{problem || right}</Text>
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
        {text ? `${spinning ? `${spinnerFrame(tick ?? 0)} ` : ''}${plain(text)}` : ' '}
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
    <Box flexDirection="column" flexShrink={0}>
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
 * The keys that apply where you are, as lines.
 *
 * Flattened first so the page can be sliced rather than laid out and clipped:
 * scrolling by pushing a box up with a negative margin left the rows bleeding
 * into each other, and every other pane here scrolls by choosing which lines to
 * draw. One mechanism.
 */
export interface HelpLine {
  kind: 'heading' | 'key' | 'blank'
  keys?: string
  label?: string
  confirm?: boolean
}

const HELP_TITLES: Record<Surface, string> = {
  global: 'Everywhere',
  rail: 'The rail',
  session: 'A session',
  diff: 'The diff',
  run: 'A run',
  pull: 'A pull request',
  ritual: 'A ritual',
  inbox: 'Something elsewhere',
  project: 'A project',
  queue: 'Answering prompts',
  fleet: 'The fleet',
}

export function helpLines(surfaces: Surface[], keys: Keymap): HelpLine[] {
  const lines: HelpLine[] = []

  for (const surface of surfaces) {
    if (lines.length) lines.push({ kind: 'blank' })
    lines.push({ kind: 'heading', label: HELP_TITLES[surface] })
    for (const item of keys.bindingsFor(surface)) {
      lines.push({ kind: 'key', keys: item.keys, label: item.label, confirm: item.confirm })
    }
  }

  return lines
}

export function HelpOverlay({
  width,
  lines,
}: {
  width: number
  lines: HelpLine[]
}) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (line.kind === 'blank') return <Text key={i}> </Text>
        if (line.kind === 'heading') {
          return <Text key={i} color="gray" bold>{(line.label ?? '').toUpperCase()}</Text>
        }
        return (
          <Text key={i} wrap="truncate">
            <Text color={ACCENT}>{pad(line.keys ?? '', 10)}</Text>
            <Text color="gray">{truncate(line.label ?? '', Math.max(10, width - 24))}</Text>
            {line.confirm ? <Text color="yellow"> · asks first</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}

export function Rule({ label, width }: { label: string; width: number }) {
  const body = `─ ${label} `
  return (
    <Text color="gray" wrap="truncate">
      {body + '─'.repeat(Math.max(0, width - body.length))}
    </Text>
  )
}

export { LAYOUT }

/**
 * What is slow, while it is slow.
 *
 * The checks, a merge and a look at the inbox all take minutes, and a single
 * status line can only describe one of them — whichever finished last. Two lines
 * of "this is running, and for how long" is the smallest honest answer.
 */
export function JobsRegion({ jobs, now, width }: { jobs: Job[]; now: number; width: number }) {
  if (jobs.length === 0) return null
  const shown = jobs.slice(0, 2)

  return (
    <Box flexDirection="column">
      {shown.map(job => (
        <Text key={job.key} color="gray" wrap="truncate">
          {truncate(`  ${job.label}   ${elapsed(job.startedAt, now)}`, width)}
        </Text>
      ))}
      {jobs.length > shown.length ? (
        <Text color="gray">{`  and ${jobs.length - shown.length} more`}</Text>
      ) : null}
    </Box>
  )
}

function elapsed(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The `:` line.
 *
 * At the bottom, where a command line belongs, with what it would complete to
 * beside it — discoverability without a modal, which is the argument for having
 * one of these rather than a fuzzy palette.
 */
export function CommandLine({
  value,
  onChange,
  onSubmit,
  onCancel,
  completions,
  width,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  completions: string[]
  width: number
}) {
  const room = Math.max(20, Math.floor(width * 0.6))
  return (
    <Box>
      <Box width={room}>
        <TextField
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          isActive
          prefix=":"
          placeholder="help"
          width={room}
        />
      </Box>
      {completions.length ? (
        <Text color="gray" wrap="truncate">
          {truncate(completions.join(' '), Math.max(8, width - room))}
        </Text>
      ) : null}
    </Box>
  )
}

/**
 * A row in the rail.
 *
 * Narrower than the rows the six views used, because a rail is a rail: what it
 * wants, a dot if it has said something since you looked, the title, and one
 * quiet line under it. Everything else belongs in the pane.
 *
 * The cursor is a bar when the rail has the keyboard and a thin line when it
 * does not — a solid cursor in an unfocused list is a lie about where the next
 * key will land.
 */
/**
 * Why every row here says `flexShrink={0}`.
 *
 * Yoga's default is to shrink a flex child that does not fit, and Ink honours
 * that by giving the box fewer lines than its content — then draws the content
 * anyway, one line on top of another. A two-line row squeezed to one renders its
 * detail *over* its title, which reads as "the titles are missing" and is
 * impossible to diagnose from a screenshot. Clipping the last row off the bottom
 * is the honest failure; overlapping text is not.
 */
export function RailRow({
  selected,
  focused,
  glyph,
  title,
  status,
  detail,
  trailing,
  unread,
  width,
  spaced,
}: {
  selected: boolean
  focused: boolean
  glyph: ReactNode
  title: string
  status?: string
  detail?: string
  trailing?: string
  unread?: boolean
  width: number
  spaced?: boolean
}) {
  /*
   * One column carries both marks, because they cannot both be true of a row
   * you are looking at — reading it is what makes it read. A dot wedged against
   * the status glyph looked like part of the glyph.
   */
  const mark = selected ? (focused ? CURSOR : '│') : unread ? '·' : ' '
  const trailW = trailing ? Math.min(Math.max(trailing.length, 3), 12) : 0
  // Two, not one: a title truncated to the character before the age reads as one
  // word — `…Jan 1`.
  const titleW = Math.max(8, width - 6 - (trailW ? trailW + 2 : 0))

  /*
   * The selected row is reversed out, not merely tinted.
   *
   * A cursor you have to hunt for is not a cursor. Colour and weight were doing
   * that job alone, which is too subtle at the bottom of a long rail — and
   * invisible the moment anything else has gone wrong on screen. Inverse video
   * is the one thing every terminal draws the same way, and it is what `fzf` and
   * `lazygit` use for exactly this.
   */
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text wrap="truncate">
        <Text color={selected || unread ? ACCENT : 'gray'}>{`${mark} `}</Text>
        {glyph}
        <Text
          color={selected ? ACCENT : 'white'}
          inverse={selected}
          bold={selected && focused}
        >
          {`  ${pad(title, titleW)}`}
        </Text>
        <Text color={selected ? ACCENT : 'gray'} inverse={selected}>
          {trailing ? ` ${pad(trailing, trailW, 'right')}` : ''}
        </Text>
      </Text>
      {detail || status ? (
        <Text color="gray" wrap="truncate">
          {`    ${truncate([status, detail].filter(Boolean).join(' · '), Math.max(8, width - 4))}`}
        </Text>
      ) : null}
      {spaced ? <Text> </Text> : null}
    </Box>
  )
}

/** The rail's own heading: what it is showing, and where you are in it. */
export function RailHeader({
  label,
  count,
  position: at,
  unread,
  width,
}: {
  label: string
  count: number
  position?: string
  unread: number
  width: number
}) {
  const right = [at, unread ? `${unread} new` : null].filter(Boolean).join('  ')
  return (
    <Box justifyContent="space-between" width={width} paddingBottom={1}>
      <Text color="gray" bold wrap="truncate">{`${label.toUpperCase()}  ${count}`}</Text>
      <Text color="gray">{right}</Text>
    </Box>
  )
}
