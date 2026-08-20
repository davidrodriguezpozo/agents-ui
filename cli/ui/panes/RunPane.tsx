import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState } from 'react'
import { formatCost, formatDuration } from '~/utils/time'
import { spinnerFrame, toneForRun, windowOf } from '../../format'
import { markdownLines } from '../../markdown'
import { followRun, type LiveRun } from '../../runStream'
import { EmptyState, Glyph, RichLine } from '../components'
import { useStudio } from '../context'
import { usePoll, useScroll, useTick } from '../hooks'
import { ACCENT } from '../theme'

/**
 * A detached run — a ritual firing at 08:00, a command somebody sent.
 *
 * Streamed and scrollable, like a session: this was the last pane reading a run
 * through a four-second poll and throwing away everything past the bottom of the
 * screen, which for the runs that matter is exactly the end you needed.
 */
export function RunPane({
  id,
  focused,
  width,
  height,
  onBack,
}: {
  id: string
  focused: boolean
  width: number
  height: number
  onBack: () => void
}) {
  const { api, keys, openBrowser, motions, nudge } = useStudio()
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
  // A run's output is Markdown too — often most of it, since a ritual's whole
  // job is to report.
  const body = useMemo(() => markdownLines(output || 'No output yet.', width), [output, width])
  const scroll = useScroll(body.length, height, motions, focused)
  const visible = windowOf(body, scroll.offset, height)

  useInput((input, key) => {
    if (keys.matches('run.back', input, key)) onBack()
    if (keys.matches('browser', input, key)) openBrowser(`/runs/${id}`)
    if (keys.matches('refresh', input, key)) poll.refresh()
  }, { isActive: focused })

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
      <Text wrap="truncate"><Text color={ACCENT} bold>{run.title}</Text></Text>
      <Box paddingTop={1} paddingBottom={1} flexShrink={0}>
        <Text wrap="truncate">
          <Glyph
            tone={toneForRun(status)}
            spinning={status === 'running' || status === 'queued'}
            frame={spinnerFrame(tick)}
          />
          <Text color="gray">{`  ${meta}`}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((line, i) => (
          <RichLine key={`${scroll.offset}-${i}`} spans={line.spans} text={line.text} />
        ))}
      </Box>
      {!scroll.atBottom ? (
        <Text color="yellow">{`↓ ${scroll.behind} more below — G for the end`}</Text>
      ) : null}
      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">{keys.hint(['run.scroll', 'run.back', 'browser'])}</Text>
      </Box>
    </Box>
  )
}
