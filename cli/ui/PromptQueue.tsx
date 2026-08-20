import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { plain, toLines } from '../format'
import { canRemember, promptDetail, promptHeadline, type Waiting } from '../prompts'
import { TextField } from './components'
import { useStudio } from './context'
import { ACCENT } from './theme'

/**
 * Every waiting prompt, one at a time, until there are none left.
 *
 * This is the thing a terminal is genuinely better at than a tab. With several
 * agents running, permission prompts arrive as a stream, and answering one used
 * to mean being in the right view on the right row — so the queue built up while
 * you were reading something else. `git add -p` solved this shape of problem a
 * long time ago: one decision on screen, one key each way, and it advances by
 * itself. Eleven prompts in eleven keystrokes, without choosing where to look.
 *
 * It shows enough to decide: the command it wants to run, or the lines it wants
 * to write. "Allow this?" with no sight of what would be written is the question
 * this exists to stop asking.
 */
export function PromptQueue({
  queue,
  width,
  height,
  onAnswer,
  onLeave,
  onOpen,
}: {
  queue: Waiting[]
  width: number
  height: number
  onAnswer: (
    waiting: Waiting,
    behavior: 'allow' | 'deny',
    opts?: { scope?: 'once' | 'session'; message?: string },
  ) => void
  onLeave: () => void
  onOpen: (sessionId: string) => void
}) {
  const { keys, mode } = useStudio()
  const [at, setAt] = useState(0)
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)

  const waiting = queue[Math.min(at, Math.max(0, queue.length - 1))]

  useInput((input, key) => {
    if (!waiting) {
      if (key.escape || key.return) onLeave()
      return
    }

    if (keys.matches('queue.allow', input, key)) return answer('allow', { scope: 'once' })
    if (keys.matches('queue.session', input, key) && canRemember(waiting.prompt)) {
      return answer('allow', { scope: 'session' })
    }
    if (keys.matches('queue.deny', input, key)) return answer('deny')
    if (keys.matches('queue.reason', input, key)) {
      setReason('')
      setAsking(true)
      return
    }
    // Skipping moves past it without answering: the next one may be the one you
    // know the answer to, and coming back to this is what the rail is for.
    if (keys.matches('queue.skip', input, key)) return setAt(index => index + 1)
    if (keys.matches('queue.open', input, key)) {
      onOpen(waiting.sessionId)
      onLeave()
      return
    }
    if (keys.matches('queue.leave', input, key)) onLeave()
    // Not switching the app's mode while a reason is being typed: the queue is
    // drawn for `mode === 'queue'`, and changing it would unmount the very
    // question being answered.
  }, { isActive: mode === 'queue' && !asking })

  function answer(
    behavior: 'allow' | 'deny',
    opts: { scope?: 'once' | 'session'; message?: string } = {},
  ) {
    if (!waiting) return
    onAnswer(waiting, behavior, opts)
    // Not advancing the index: the answered one leaves the queue, so the next
    // one arrives at the same place. Advancing as well would skip it.
  }

  function deny() {
    const message = reason.trim()
    setAsking(false)
    answer('deny', { message: message || undefined })
  }

  if (!waiting) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingTop={1}>
        <Text color="green">Nothing is waiting.</Text>
        <Box paddingTop={1}>
          <Text color="gray">Every prompt is answered. esc goes back to the rail.</Text>
        </Box>
      </Box>
    )
  }

  const remaining = queue.length
  const detail = promptDetail(waiting.prompt, undefined, Math.max(4, height - 10))

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box justifyContent="space-between">
        <Text color={ACCENT} bold>ANSWERING</Text>
        <Text color="gray">
          {`${remaining} waiting${remaining > 1 ? ' · s skips this one' : ''}`}
        </Text>
      </Box>

      <Box paddingTop={1} flexDirection="column">
        <Text wrap="truncate">
          <Text bold>{plain(waiting.title)}</Text>
          <Text color="gray">{`    ${waiting.repo} · ${waiting.branch}`}</Text>
        </Text>
        <Box paddingTop={1}>
          <Text color={ACCENT} wrap="truncate">{promptHeadline(waiting.prompt)}</Text>
        </Box>
      </Box>

      <Box
        flexDirection="column"
        flexGrow={1}
        overflow="hidden"
        paddingTop={1}
        paddingX={1}
        borderStyle="round"
        borderColor="gray"
      >
        {detail.flatMap((line, i) => toLines(line.text, width - 4).map((wrapped, j) => (
          <Text key={`${i}-${j}`} color={line.tone === 'cyan' ? ACCENT : line.tone} wrap="truncate">
            {wrapped || ' '}
          </Text>
        )))}
      </Box>

      {asking ? (
        <Box paddingTop={1}>
          <TextField
            value={reason}
            onChange={setReason}
            onSubmit={deny}
            onCancel={() => setAsking(false)}
            isActive
            prefix="no, because "
            placeholder="use bun instead"
            width={width - 4}
          />
        </Box>
      ) : (
        <Box paddingTop={1}>
          <Text color="gray" wrap="truncate">
            {keys.hint(canRemember(waiting.prompt)
              ? ['queue.allow', 'queue.session', 'queue.deny', 'queue.reason', 'queue.skip', 'queue.open', 'queue.leave']
              : ['queue.allow', 'queue.deny', 'queue.reason', 'queue.skip', 'queue.open', 'queue.leave'])}
          </Text>
        </Box>
      )}
    </Box>
  )
}
