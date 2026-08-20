import { Box, Text } from 'ink'
import { useInput } from 'ink'
import { useState } from 'react'
import { compactAge, plain, toLines } from '../../format'
import type { Pull } from '../../types'
import { Confirm, EmptyState, Glyph } from '../components'
import { useStudio } from '../context'
import { usePoll } from '../hooks'
import { ACCENT } from '../theme'

/**
 * A pull request, in the pane.
 *
 * What the verdict is, what is in the way, and the two things you might do about
 * it: work on it here, or merge it. The reading itself is the server's, so this
 * says exactly what `/land` says.
 */
export function PullPane({
  number,
  focused,
  width,
  onBack,
  onWork,
}: {
  number: number
  focused: boolean
  width: number
  onBack: () => void
  onWork: (sessionId: string) => void
}) {
  const { api, keys, jobs, mode, openBrowser, nudge, scope } = useStudio()
  const [confirming, setConfirming] = useState(false)

  const poll = usePoll(signal => api.pulls(signal), { every: 120_000, deps: [scope, nudge] })
  const pull = [...(poll.data?.reviewing ?? []), ...(poll.data?.mine ?? [])]
    .find(item => item.number === number)

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') {
        setConfirming(false)
        void merge()
      }
      if (input === 'n' || key.escape) setConfirming(false)
      return
    }
    if (key.escape) {
      onBack()
      return
    }
    if (keys.matches('pull.work', input, key)) void work()
    if (keys.matches('pull.merge', input, key)) setConfirming(true)
    if (keys.matches('browser', input, key) && pull) openBrowser(pull.url)
  }, { isActive: focused && mode === 'nav' })

  async function work() {
    if (!pull) return
    let id: string | null = null
    const ok = await jobs.run(`work:${pull.number}`, `Starting a session on #${pull.number}`, async () => {
      const started = await api.workOnPull(pull.number)
      id = started.id
    })
    if (ok && id) onWork(id)
  }

  async function merge() {
    if (!pull) return
    await jobs.run(`merge:${pull.number}`, `Merging #${pull.number}`, () => api.mergePull(pull.number))
    poll.refresh()
  }

  if (!pull) return <EmptyState>{poll.loading ? 'Loading…' : 'That pull request is gone.'}</EmptyState>

  const lines = [
    pull.verdict.detail,
    '',
    `${pull.headBranch} → ${pull.baseBranch}`,
    pull.changedFiles ? `${pull.changedFiles} files  +${pull.additions}/−${pull.deletions}` : 'no files',
    `checks ${pull.checks}`,
    pull.mine ? 'opened by you' : `opened by ${pull.author}`,
    `updated ${compactAge(pull.updatedAt)}`,
    pull.intent ? '' : '',
    pull.intent ? `if you work on it, it will: ${pull.intent}` : '',
  ].filter(line => line !== undefined)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color={ACCENT} bold>{plain(`#${pull.number}  ${pull.title}`)}</Text>
      </Text>
      <Box paddingTop={1} paddingBottom={1} flexShrink={0}>
        <Text wrap="truncate">
          <Glyph tone={pull.verdict.onYou ? 'yellow' : pull.checks === 'failing' ? 'red' : 'green'} />
          <Text color="gray">{`  ${pull.verdict.label}`}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {lines.flatMap((line, i) => toLines(line, width).map((wrapped, j) => (
          <Text key={`${i}-${j}`} color="gray">{wrapped || ' '}</Text>
        )))}
      </Box>
      {confirming ? (
        <Confirm
          question={`Merge #${pull.number} on GitHub?`}
          detail={[pull.title, `${pull.headBranch} → ${pull.baseBranch}`, `checks ${pull.checks}`]}
        />
      ) : null}
      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">{keys.hint(['pull.work', 'pull.merge', 'browser'])}</Text>
      </Box>
    </Box>
  )
}
