import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { untilLabel } from '~/utils/wall'
import { compactAge, pad, plain } from '../../format'
import type { RitualHistory, Schedule } from '../../types'
import { Confirm, EmptyState } from '../components'
import { useStudio } from '../context'
import { ACCENT } from '../theme'

/**
 * A ritual, in the pane: when it fires, how it has been going, and what it says.
 *
 * Running one now is a capital `R` and a question, because it starts an agent —
 * it used to be `r`, next to nothing, while the footer called `r` "refresh".
 */
export function RitualPane({
  schedule,
  history,
  focused,
  width,
  onBack,
  onChanged,
}: {
  schedule: Schedule | undefined
  history: RitualHistory | undefined
  focused: boolean
  width: number
  onBack: () => void
  onChanged: () => void
}) {
  const { api, keys, jobs, mode, openBrowser } = useStudio()
  const [confirming, setConfirming] = useState(false)

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') {
        setConfirming(false)
        void runNow()
      }
      if (input === 'n' || key.escape) setConfirming(false)
      return
    }
    if (key.escape) {
      onBack()
      return
    }
    if (!schedule) return
    if (keys.matches('ritual.toggle', input, key)) void toggle()
    if (keys.matches('ritual.run', input, key)) setConfirming(true)
    if (keys.matches('browser', input, key)) openBrowser('/schedules')
  }, { isActive: focused && mode === 'nav' })

  async function toggle() {
    if (!schedule) return
    await jobs.run(`toggle:${schedule.id}`, `${schedule.enabled ? 'Disabling' : 'Enabling'} ${schedule.title}`, () =>
      api.saveSchedule({ ...schedule, enabled: !schedule.enabled }))
    onChanged()
  }

  async function runNow() {
    if (!schedule) return
    await jobs.run(`run:${schedule.id}`, `Running ${schedule.title}`, () => api.startRun({
      input: schedule.input,
      title: schedule.title,
      invocation: schedule.invocation,
      agentSlug: schedule.agentSlug,
      projectDir: schedule.projectDir,
      kind: 'command',
    }))
    onChanged()
  }

  if (!schedule) return <EmptyState>That ritual is gone.</EmptyState>

  const runs = history?.runs.slice(0, 10) ?? []

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate"><Text color={ACCENT} bold>{schedule.title}</Text></Text>
      <Box paddingTop={1} flexDirection="column" flexShrink={0}>
        <Text color="gray" wrap="truncate">
          {[
            schedule.description,
            schedule.pausedReason
              ? `paused: ${schedule.pausedReason}`
              : schedule.enabled ? 'enabled' : 'disabled',
            schedule.nextRunAt ? `next ${untilLabel(schedule.nextRunAt, Date.now())}` : 'not scheduled',
          ].filter(Boolean).join(' · ')}
        </Text>
        <Box paddingTop={1}><Text wrap="truncate">{plain(schedule.input)}</Text></Box>
      </Box>

      <Box paddingTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
        <Text color="gray" bold>HISTORY</Text>
        {runs.length === 0 ? (
          <Text color="gray">No runs recorded yet.</Text>
        ) : runs.map(run => (
          <Text key={run.id} color="gray" wrap="truncate">
            {`${pad(run.outcome, 10)}${pad(compactAge(run.at), 6)}${run.costUsd != null ? `$${run.costUsd.toFixed(2)}` : ''}${run.error ? `  ${run.error}` : ''}`}
          </Text>
        ))}
      </Box>

      {confirming ? (
        <Confirm
          question={`Run "${schedule.title}" now?`}
          detail={[
            'It starts an agent, which costs money and may write to the repository.',
            schedule.projectDir ? `in ${schedule.projectDir}` : '',
          ]}
        />
      ) : null}
      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">{keys.hint(['ritual.toggle', 'ritual.run', 'browser'])}</Text>
      </Box>
    </Box>
  )
}
