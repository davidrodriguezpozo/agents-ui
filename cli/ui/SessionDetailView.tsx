import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import { sessionBadge } from '~/utils/sessionBadge'
import { fileAt, patchFiles, patchSummary, stepFile } from '../diff'
import { hint } from '../keymap'
import { followRun, type LiveRun } from '../runStream'
import { compactAge, spinnerFrame, toneForBadge, toneForDiffLine, windowOf } from '../format'
import { defaultEditor, defaultShell, runInTty } from '../shell'
import { displayTurns, transcriptLines } from '../transcript'
import type { PermissionRequest, TrustLevel } from '../types'
import { Confirm, EmptyState, Glyph, PermissionFrame, RichLine, TextField } from './components'
import { useStudio } from './context'
import { useAction, usePoll, useScroll, useTerminalSize, useTick } from './hooks'
import { ACCENT, CHROME, LAYOUT, paneHeight } from './theme'

/** What `t` cycles through, and what each level means in one word. */
const TRUST: { level: TrustLevel; label: string }[] = [
  { level: 'readonly', label: 'read only — it asks before it writes' },
  { level: 'edits', label: 'edits — it writes here without asking' },
  { level: 'full', label: 'full — it does not ask at all' },
]

type Overlay =
  | { kind: 'confirm'; question: string; detail?: string[]; onYes: () => void }
  | { kind: 'deny'; prompt: PermissionRequest }

export function SessionDetailView({
  id,
  onBack,
  isActive,
}: {
  id: string
  onBack: () => void
  isActive: boolean
}) {
  const { api, mode, setMode, suspend, openBrowser, motions, draft, setDraft, nudge } = useStudio()
  const { columns, rows } = useTerminalSize()
  const action = useAction()
  const width = Math.max(20, columns - LAYOUT.padding * 2)

  const [pendingInput, setPendingInput] = useState('')
  const [live, setLive] = useState<LiveRun | null>(null)
  const [connected, setConnected] = useState(true)
  const [runId, setRunId] = useState<string | null>(null)
  const [pane, setPane] = useState<'talk' | 'diff'>('talk')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [answered, setAnswered] = useState<string[]>([])
  const [reason, setReason] = useState('')

  const composing = mode === 'compose'
  const text = draft(`session:${id}`)

  /**
   * Whether anything is moving, as of the last frame.
   *
   * Read from a ref because the answer depends on the very data this poll
   * fetches. A frame behind is the right amount of behind: the notification
   * stream nudges the deps below the moment the server has news, so nothing
   * waits on the timer to find out that something started.
   */
  const moving = useRef(true)

  const poll = usePoll(signal => api.session(id, signal), {
    every: 4_000,
    idle: 20_000,
    live: moving.current,
    deps: [id, nudge],
  })
  const session = poll.data

  /**
   * The diff is a `git diff` per poll, so it runs while you are reading it and
   * not otherwise. It used to run every eight seconds for the whole time a
   * session was open, including with the pane closed.
   */
  const diff = usePoll(signal => api.diff(id, signal), {
    every: 8_000,
    enabled: pane === 'diff',
    deps: [id],
  })

  const busy = session?.activity === 'working' || live?.status === 'running' || live?.status === 'queued'
  moving.current = Boolean(busy) || session?.status === 'running'
  const tick = useTick(Boolean(busy) || Boolean(action.pending))

  /**
   * Follow whichever run is current.
   *
   * The old rule latched onto the first run and never let go — `!runId` meant a
   * second turn, a ritual, or anything started from the browser never streamed,
   * and since prompts arrive on the stream, a session working on somebody
   * else's instruction could not be unblocked from here at all.
   */
  useEffect(() => {
    const last = session?.lastRunId
    if (last && last !== runId && session?.status === 'running') setRunId(last)
  }, [session?.lastRunId, session?.status, runId])

  useEffect(() => {
    if (!runId) {
      setLive(null)
      return
    }

    const controller = new AbortController()
    setLive(null)
    setAnswered([])

    void followRun(api.client, runId, {
      signal: controller.signal,
      onRun: setLive,
      onConnected: setConnected,
    }).finally(() => {
      if (!controller.signal.aborted) {
        poll.refresh()
        if (pane === 'diff') diff.refresh()
      }
    })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, id])

  const turns = useMemo(
    () => (session ? displayTurns(session, live, pendingInput) : []),
    [session, live, pendingInput],
  )
  const lines = useMemo(
    () => transcriptLines(turns, width, session?.worktreePath),
    [turns, width, session?.worktreePath],
  )

  const patch = diff.data?.patch || ''
  const files = useMemo(() => patchFiles(patch), [patch])
  const diffLines = useMemo(
    () => (patch ? patch.split('\n') : ['No changes.']),
    [patch],
  )

  const prompt = live?.prompts.find(item => !answered.includes(item.id))
  const promptRows = prompt ? 4 : 0
  const overlayRows = overlay ? (overlay.kind === 'deny' ? 4 : 5) : 0
  const height = paneHeight(rows, [
    CHROME.header, // the session's own title line
    CHROME.rule + 1, // the status line and its air
    CHROME.compose,
    promptRows,
    overlayRows,
  ])

  const body = pane === 'diff'
    ? diffLines.map(line => ({ kind: 'text' as const, text: line, tone: toneForDiffLine(line), spans: undefined }))
    : lines
  const scroll = useScroll(body.length, height, motions, isActive && mode === 'nav')
  const visible = windowOf(body, scroll.offset, height)

  // Which line the top of the window is on, so the diff can say what file that
  // is and `tab` can jump from where you are rather than from the start.
  const topLine = Math.max(0, body.length - scroll.offset - height)
  const currentFile = pane === 'diff' ? fileAt(files, topLine) : null

  useInput((input, key) => {
    if (overlay) {
      if (overlay.kind === 'confirm') {
        if (input === 'y') {
          const { onYes } = overlay
          setOverlay(null)
          onYes()
        }
        if (input === 'n' || key.escape) setOverlay(null)
      }
      return
    }

    if (key.escape) {
      if (pane === 'diff') setPane('talk')
      else onBack()
      return
    }

    if (prompt) {
      if (input === 'y') {
        void answer(prompt, 'allow', { scope: 'once' })
        return
      }
      if (input === 'a') {
        void answer(prompt, 'allow', { scope: 'session' })
        return
      }
      if (input === 'n') {
        void answer(prompt, 'deny')
        return
      }
      if (input === 'N') {
        setReason('')
        setOverlay({ kind: 'deny', prompt })
        setMode('compose')
        return
      }
    }

    if (input === 'i') {
      setMode('compose')
      return
    }

    // `tab` walks the diff by file. Nothing else in a session claims it, and
    // scrolling a twelve-file patch by hand was the alternative.
    if (key.tab && pane === 'diff') {
      const next = stepFile(files, topLine, key.shift ? -1 : 1)
      if (next != null) scrollTo(next)
      return
    }

    if (input === 'd' && !key.ctrl) {
      setPane(current => (current === 'diff' ? 'talk' : 'diff'))
      return
    }
    if (input === 'c') void checks()
    if (input === 'f') void repair()
    if (input === 'u' && !key.ctrl) void updateBase()
    if (input === 't') void cycleTrust()
    if (input === 'x') void stop()
    if (input === 's') void shell()
    if (input === 'e') void editor()
    if (input === 'o') openBrowser(`/sessions/${id}`)
    if (input === 'p') askPullRequest()
    if (input === 'm') void askMerge()
    if (input === 'D') askClose()
    if (input === 'r') {
      poll.refresh()
      if (pane === 'diff') diff.refresh()
    }
  }, { isActive: isActive && mode === 'nav' })

  /** Put a given patch line at the top of the window. */
  function scrollTo(line: number) {
    const offset = Math.max(0, body.length - height - line)
    scroll.set(offset)
  }

  async function send() {
    const input = text.trim()
    if (!input) return
    setPendingInput(input)
    const ok = await action.run('send', null, async () => {
      const result = await api.send(id, input)
      setRunId(result.runId)
    })
    if (ok) {
      setDraft(`session:${id}`, '')
      setMode('nav')
      scroll.toBottom()
    }
  }

  /**
   * Answer a prompt, and take it off the screen now.
   *
   * The stream says `permission_resolved` a moment later, and waiting for that
   * left the frame showing a question that had been answered — which invites a
   * second `y` at something that is already gone.
   */
  async function answer(
    request: PermissionRequest,
    behavior: 'allow' | 'deny',
    opts: { scope?: 'once' | 'session'; message?: string } = {},
  ) {
    setAnswered(current => [...current, request.id])
    const ok = await action.run(
      `permission:${request.id}`,
      null,
      () => api.answerPermission(request.id, behavior, opts),
    )
    // Putting it back is better than pretending: if the answer did not land,
    // the run is still waiting and you still have to decide.
    if (!ok) setAnswered(current => current.filter(item => item !== request.id))
  }

  async function denyWithReason() {
    if (!overlay || overlay.kind !== 'deny') return
    const message = reason.trim()
    setOverlay(null)
    setMode('nav')
    await answer(overlay.prompt, 'deny', { message: message || undefined })
  }

  async function checks() {
    await action.run('checks', 'Running the checks…', () => api.runChecks(id))
    poll.refresh()
  }

  async function repair() {
    if (!session?.check || session.check.status === 'passing') {
      await action.run('repair', null, async () => {
        throw new Error('Nothing to fix — run the checks first with c.')
      })
      return
    }
    const ok = await action.run('repair', 'Asking it to fix the checks…', async () => {
      const started = await api.repair(id)
      setRunId(started.runId)
    })
    if (ok) poll.refresh()
  }

  async function updateBase() {
    const ok = await action.run('update', `Bringing ${session?.baseBranch ?? 'the base'} in…`, async () => {
      const result = await api.updateFromBase(id)
      if (result.status === 'conflicted') {
        throw new Error('Conflicts — the worktree is mid-merge. Press s and finish it by hand.')
      }
    })
    if (ok) poll.refresh()
  }

  async function cycleTrust() {
    const at = TRUST.findIndex(item => item.level === (session?.trust ?? 'readonly'))
    const next = TRUST[(at + 1) % TRUST.length]!
    const ok = await action.run('trust', `Trust: ${next.label}`, () => api.setTrust(id, next.level))
    if (ok) poll.refresh()
  }

  async function stop() {
    if (!runId) return
    await action.run('stop', 'Stopping…', () => api.cancelRun(runId))
    poll.refresh()
  }

  async function shell() {
    const cwd = session?.worktreePath
    if (!cwd) return
    await suspend(() => runInTty(defaultShell(), [], cwd).then(() => undefined))
  }

  /**
   * `$EDITOR` in the worktree.
   *
   * The plan called this shipped and it never was: there is a real editor on
   * this machine, and a young one embedded in a terminal app would be worse
   * than the one you have configured.
   */
  async function editor() {
    const cwd = session?.worktreePath
    if (!cwd) return
    await suspend(() => runInTty(defaultEditor(), [cwd], cwd).then(() => undefined))
  }

  function askPullRequest() {
    setOverlay({
      kind: 'confirm',
      question: 'File a pull request on GitHub?',
      detail: [
        `${session?.branch} → ${session?.baseBranch}`,
        'Uncommitted work is committed first.',
      ],
      onYes: () => { void pullRequest() },
    })
  }

  async function pullRequest() {
    await action.run('pr', 'Opening the pull request…', async () => {
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

  /**
   * Ask git what a merge would do before asking the person.
   *
   * `m` used to merge on the keypress, with `commitFirst` on, over a failing
   * check — which is a lot of consequence for a single letter next to `n`.
   */
  async function askMerge() {
    const ok = await action.run('merge.preview', 'Checking…', async () => {
      const preview = await api.previewMerge(id)
      const blocked = !preview.canMerge && !preview.blockedByChecks
      if (blocked) throw new Error(preview.blockedReason || 'This cannot be merged yet.')

      setOverlay({
        kind: 'confirm',
        question: `Merge into ${preview.targetBranch}?`,
        detail: [
          `${preview.commits} commit${preview.commits === 1 ? '' : 's'} from ${preview.currentBranch}`,
          preview.uncommittedFiles.length
            ? `${preview.uncommittedFiles.length} uncommitted file${preview.uncommittedFiles.length === 1 ? '' : 's'}, committed first`
            : '',
          preview.check ? `checks ${preview.check.status}${preview.checkStale ? ', stale' : ''}` : 'never checked',
          preview.blockedByChecks ? 'the checks do not pass — this overrules them' : '',
        ],
        onYes: () => { void merge(Boolean(preview.blockedByChecks)) },
      })
    })
    if (!ok) poll.refresh()
  }

  async function merge(override: boolean) {
    await action.run('merge', 'Merging…', () => api.mergeSession(id, { commitFirst: true, override }))
    poll.refresh()
  }

  function askClose() {
    const dirty = session?.worktree.dirty
    setOverlay({
      kind: 'confirm',
      question: 'Close this session and remove the worktree?',
      detail: [
        dirty ? 'There is uncommitted work in it, which will be lost.' : 'Nothing uncommitted.',
        `The branch ${session?.branch} goes too.`,
      ],
      onYes: () => { void close() },
    })
  }

  async function close() {
    const ok = await action.run('close', 'Closing…', () => api.closeSession(id, { force: true }))
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
  const changed = session.worktree.changedFiles
  const summary = [
    badge.label,
    changed ? `${changed} file${changed === 1 ? '' : 's'}` : null,
    session.worktree.ahead ? `${session.worktree.ahead} ahead` : null,
    session.worktree.behind ? `${session.worktree.behind} behind — u to catch up` : null,
    session.check
      ? `checks ${session.check.status}${session.checkStale ? ', stale' : ''} ${compactAge(session.check.at)}`
      : null,
    session.trust && session.trust !== 'readonly' ? `trust: ${session.trust}` : null,
    connected ? null : 'reconnecting…',
  ].filter(Boolean).join(' · ')

  const described = prompt
    ? describeToolCall({ toolName: prompt.toolName, input: prompt.input }, session.worktreePath)
    : null

  const footer = action.message
    || (pane === 'diff'
      ? hint(['diff.file', 'diff.back'])
      : hint(['session.write', 'session.diff', 'session.checks', 'session.repair', 'session.stop', 'session.shell', 'browser']))

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color="gray">← </Text>
        <Text color={ACCENT} bold>{session.title}</Text>
        <Text color="gray">{`    ${session.branch} → ${session.baseBranch}`}</Text>
      </Text>
      <Box paddingTop={1} paddingBottom={1}>
        <Text wrap="truncate">
          <Glyph tone={tone} spinning={Boolean(busy)} frame={spinnerFrame(tick)} />
          <Text> </Text>
          <Text color="gray">
            {pane === 'diff' ? `${patchSummary(files)}${currentFile ? `   ${currentFile.path}` : ''}` : summary}
          </Text>
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {visible.length === 0 ? (
          <EmptyState>Nothing said yet. Press i to write an instruction.</EmptyState>
        ) : (
          visible.map((line, i) => (
            <RichLine
              key={`${pane}-${scroll.offset}-${i}`}
              spans={line.spans}
              text={line.text}
              tone={line.tone}
            />
          ))
        )}
      </Box>

      {/*
        * Said rather than left to be noticed: output arriving below the window
        * while you read history is the one case where the pane is deliberately
        * not showing you the newest thing.
        */}
      {!scroll.atBottom ? (
        <Text color="yellow">{`↓ ${scroll.behind} more line${scroll.behind === 1 ? '' : 's'} below — G for the end`}</Text>
      ) : null}

      {prompt && described ? (
        <PermissionFrame
          verb={presentVerb(prompt.toolName)}
          target={described.target}
          reason={overlay?.kind === 'deny' ? (
            <TextField
              value={reason}
              onChange={setReason}
              onSubmit={() => { void denyWithReason() }}
              onCancel={() => {
                setOverlay(null)
                setMode('nav')
              }}
              isActive={composing}
              prefix="no, because "
              placeholder="use bun instead"
              width={width - 4}
            />
          ) : undefined}
        />
      ) : null}

      {overlay?.kind === 'confirm' ? (
        <Confirm question={overlay.question} detail={overlay.detail} />
      ) : null}

      {composing && overlay?.kind !== 'deny' ? (
        <Box paddingTop={1}>
          <TextField
            value={text}
            onChange={value => setDraft(`session:${id}`, value)}
            onSubmit={() => { void send() }}
            onCancel={() => setMode('nav')}
            isActive
            placeholder="instruction — ⌃j for a newline"
            width={width}
          />
        </Box>
      ) : overlay?.kind === 'deny' ? null : (
        <Box paddingTop={1}>
          <Text color="gray">
            {text ? `›  ${text.slice(0, Math.max(8, width - 12))} · i to go on` : '›  i to write'}
          </Text>
        </Box>
      )}

      <Box paddingTop={1}>
        <Text color={action.tone === 'error' ? 'red' : 'gray'} wrap="truncate">
          {action.pending ? `${spinnerFrame(tick)} ${footer}` : footer}
        </Text>
      </Box>
    </Box>
  )
}
