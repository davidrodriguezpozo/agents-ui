import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useState } from 'react'
import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import { sessionBadge } from '~/utils/sessionBadge'
import { applyRunEvent, emptyRun, type LiveRun } from '../runStream'
import { compactAge, maxOffset, spinnerFrame, toLines, toneForBadge, toneForDiffLine, windowOf } from '../format'
import { defaultShell, runInTty } from '../shell'
import { displayTurns, transcriptLines } from '../transcript'
import { EmptyState, Glyph, PermissionFrame, TextField } from './components'
import { useStudio } from './context'
import { useAction, usePoll, useTerminalSize, useTick } from './hooks'
import { ACCENT, LAYOUT } from './theme'

export function SessionDetailView({
  id,
  onBack,
  isActive,
}: {
  id: string
  onBack: () => void
  isActive: boolean
}) {
  const { api, mode, setMode, suspend, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const action = useAction()
  const width = Math.max(20, columns - LAYOUT.padding * 2)
  const [draft, setDraft] = useState('')
  const [pendingInput, setPendingInput] = useState('')
  const [live, setLive] = useState<LiveRun | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [pane, setPane] = useState<'talk' | 'diff'>('talk')
  const [scroll, setScroll] = useState(0)
  const [closing, setClosing] = useState(false)

  const poll = usePoll(signal => api.session(id, signal), 4000, [id])
  const session = poll.data
  const diff = usePoll(signal => api.diff(id, signal), 8000, [id])
  const tick = useTick(session?.activity === 'working' || live?.status === 'running' || live?.status === 'queued')

  useEffect(() => {
    const last = session?.lastRunId
    if (last && session?.status === 'running' && !runId) setRunId(last)
  }, [session?.lastRunId, session?.status, runId])

  useEffect(() => {
    if (!runId) {
      setLive(null)
      return
    }
    const controller = new AbortController()
    setLive(emptyRun(runId))
    void (async () => {
      try {
        for await (const event of api.client.events(
          `/api/runs/${encodeURIComponent(runId)}/stream`,
          { signal: controller.signal },
        )) {
          setLive(current => applyRunEvent(current ?? emptyRun(runId), event))
        }
      } catch {
        // abort is the usual end
      } finally {
        if (!controller.signal.aborted) {
          poll.refresh()
          diff.refresh()
        }
      }
    })()
    return () => controller.abort()
  }, [runId, id])

  const turns = useMemo(
    () => (session ? displayTurns(session, live, pendingInput) : []),
    [session, live, pendingInput],
  )
  const lines = useMemo(
    () => transcriptLines(turns, width, session?.worktreePath),
    [turns, width, session?.worktreePath],
  )
  const diffLines = useMemo(
    () => toLines(diff.data?.patch || 'No changes.', width),
    [diff.data?.patch, width],
  )

  const body = pane === 'diff'
    ? diffLines.map(text => ({ kind: 'text' as const, text, tone: toneForDiffLine(text) }))
    : lines
  const height = Math.max(1, rows - 12)
  const max = maxOffset(body.length, height)
  const offset = Math.min(scroll, max)
  const visible = windowOf(body, offset, height)

  const prompt = live?.prompts[0]
  const busy = session?.activity === 'working' || live?.status === 'running' || live?.status === 'queued'

  useInput((input, key) => {
    if (closing) {
      if (input === 'y') void confirmClose()
      if (input === 'n' || key.escape) setClosing(false)
      return
    }
    if (key.escape) {
      if (pane === 'diff') setPane('talk')
      else onBack()
      return
    }
    if (key.pageUp) setScroll(s => Math.min(max, s + height))
    if (key.pageDown) setScroll(s => Math.max(0, s - height))
    if (input === 'g' && !key.shift) setScroll(max)
    if (input === 'G' || (input === 'g' && key.shift)) setScroll(0)

    if (prompt) {
      if (input === 'y') void answer('allow', 'once')
      if (input === 'a') void answer('allow', 'session')
      if (input === 'n') void answer('deny')
      if (input === 'y' || input === 'a' || input === 'n') return
    }

    if (input === 'i') {
      setMode('compose')
      return
    }
    if (input === 'd') setPane(p => (p === 'diff' ? 'talk' : 'diff'))
    if (input === 'c') void checks()
    if (input === 'x' && runId) void stop()
    if (input === 's') void shell()
    if (input === 'o') openBrowser(`/sessions/${id}`)
    if (input === 'p') void pullRequest()
    if (input === 'm') void merge()
    if (input === 'D') setClosing(true)
    if (input === 'r') {
      poll.refresh()
      diff.refresh()
    }
  }, { isActive: isActive && mode === 'nav' })

  async function send() {
    const text = draft.trim()
    if (!text) return
    setPendingInput(text)
    const ok = await action.run(null, async () => {
      const result = await api.send(id, text)
      setRunId(result.runId)
    })
    if (ok) {
      setDraft('')
      setMode('nav')
      setScroll(0)
    }
  }

  async function answer(behavior: 'allow' | 'deny', scope?: 'once' | 'session') {
    if (!prompt) return
    await action.run(null, () => api.answerPermission(prompt.id, behavior, scope))
  }

  async function checks() {
    await action.run('Running checks…', () => api.runChecks(id))
    poll.refresh()
  }

  async function stop() {
    if (!runId) return
    await action.run('Stopping…', () => api.cancelRun(runId))
    poll.refresh()
  }

  async function shell() {
    const cwd = session?.worktreePath
    if (!cwd) return
    await suspend(async () => {
      await runInTty(defaultShell(), [], cwd)
    })
  }

  async function pullRequest() {
    await action.run('Opening pull request…', async () => {
      const preview = await api.previewPr(id)
      if (preview.existingUrl) {
        openBrowser(preview.existingUrl)
        return
      }
      if (!preview.canOpen) throw new Error(preview.blockedReason || 'Cannot open a pull request.')
      const result = await api.openPr(id, {
        title: preview.suggestedTitle,
        body: preview.suggestedBody,
        commitFirst: true,
      })
      if (result.url) openBrowser(result.url)
    })
    poll.refresh()
  }

  async function merge() {
    await action.run('Merging…', () => api.mergeSession(id, { commitFirst: true }))
    poll.refresh()
  }

  async function confirmClose() {
    const ok = await action.run('Closing…', () => api.closeSession(id))
    setClosing(false)
    if (ok) onBack()
  }

  if (poll.loading && !session) return <EmptyState>Loading…</EmptyState>
  if (!session) return <EmptyState>{poll.error || 'That session is gone.'}</EmptyState>

  const badge = sessionBadge({
    activity: session.activity,
    changedFiles: session.worktree.changedFiles,
    check: session.check,
    checkStale: session.checkStale,
    behind: session.worktree.behind,
    landed: session.landed,
  })
  const tone = session.activity === 'working' ? 'cyan' as const : toneForBadge(badge)
  const files = session.worktree.changedFiles
  const summary = [
    badge.label,
    files ? `${files} file${files === 1 ? '' : 's'}` : null,
    session.worktree.ahead ? `${session.worktree.ahead} ahead` : null,
    session.check
      ? `checks ${session.check.status}${session.checkStale ? ', stale' : ''} ${compactAge(session.check.at)}`
      : null,
  ].filter(Boolean).join(' · ')

  const described = prompt
    ? describeToolCall({ toolName: prompt.toolName, input: prompt.input }, session.worktreePath)
    : null

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text>
        <Text color="gray">← </Text>
        <Text color={ACCENT} bold>{session.title}</Text>
        <Text color="gray">{`    ${session.branch} → ${session.baseBranch}`}</Text>
      </Text>
      <Box paddingTop={1} paddingBottom={1}>
        <Text>
          <Glyph tone={tone} spinning={Boolean(busy)} frame={spinnerFrame(tick)} />
          <Text> </Text>
          <Text color="gray">{summary}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {visible.length === 0 ? (
          <EmptyState>Nothing said yet. Press i to write an instruction.</EmptyState>
        ) : (
          visible.map((line, i) => (
            <Text key={`${pane}-${offset}-${i}`} color={line.tone === 'cyan' ? ACCENT : line.tone}>
              {line.text || ' '}
            </Text>
          ))
        )}
      </Box>

      {prompt && described ? (
        <PermissionFrame verb={presentVerb(prompt.toolName)} target={described.target} />
      ) : null}

      {closing ? (
        <Box paddingTop={1}>
          <Text color="red">Close this session and remove the worktree? y / n</Text>
        </Box>
      ) : mode === 'compose' && isActive ? (
        <Box paddingTop={1}>
          <TextField
            value={draft}
            onChange={setDraft}
            onSubmit={() => { void send() }}
            onCancel={() => setMode('nav')}
            isActive
            placeholder="instruction"
          />
        </Box>
      ) : (
        <Box paddingTop={1}>
          <Text color="gray">›  i to write</Text>
        </Box>
      )}

      <Box paddingTop={1}>
        <Text color={action.tone === 'error' ? 'red' : 'gray'}>
          {action.message
            || (pane === 'diff'
              ? 'esc back to the conversation'
              : 'esc back   d diff   c checks   x stop   s shell   o browser')}
        </Text>
      </Box>
    </Box>
  )
}
