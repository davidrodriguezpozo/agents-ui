import { Box, Text, useInput } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { sessionBadge } from '~/utils/sessionBadge'
import { anchorsFor, renderPatch } from '../../diffTool'
import { fileAt, patchFiles, patchSummary, stepFile } from '../../diff'
import { compactAge, plain, spinnerFrame, toneForBadge, toneForDiffLine, windowOf } from '../../format'
import { promptDetail, promptHeadline } from '../../prompts'
import { followRun, type LiveRun } from '../../runStream'
import { composeInEditor, defaultEditor, defaultShell, runInTty } from '../../shell'
import { displayTurns, transcriptLines, type TranscriptLine } from '../../transcript'
import type { PermissionRequest, TrustLevel } from '../../types'
import { Confirm, EmptyState, Glyph, PermissionFrame, RichLine, TextField } from '../components'
import { useStudio } from '../context'
import { usePoll, useScroll, useTick } from '../hooks'
import { ACCENT } from '../theme'

/** What `t` cycles through, and what each level means in one word. */
const TRUST: { level: TrustLevel; label: string }[] = [
  { level: 'readonly', label: 'read only — it asks before it writes' },
  { level: 'edits', label: 'edits — it writes here without asking' },
  { level: 'full', label: 'full — it does not ask at all' },
]

type Drawn = TranscriptLine

type Overlay =
  | { kind: 'confirm'; question: string; detail?: string[]; onYes: () => void }
  | { kind: 'deny'; prompt: PermissionRequest }

/**
 * A session, in the pane beside the rail.
 *
 * The transcript, or the diff, plus everything you might do to it. It no longer
 * owns the screen or the way back: `esc` returns the keys to the rail, which
 * never went away, so moving between two running agents is one keypress rather
 * than a trip out to a list and back.
 */
export function SessionPane({
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
  const {
    api, keys, mode, setMode, jobs, suspend, openBrowser, motions, draft, setDraft, nudge, diffTool,
  } = useStudio()

  const [pendingInput, setPendingInput] = useState('')
  const [live, setLive] = useState<LiveRun | null>(null)
  const [connected, setConnected] = useState(true)
  const [runId, setRunId] = useState<string | null>(null)
  const [pane, setPane] = useState<'talk' | 'diff'>('talk')
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [answered, setAnswered] = useState<string[]>([])
  const [reason, setReason] = useState('')

  const composing = mode === 'insert'
  const draftKey = `session:${id}`
  const text = draft(draftKey)

  /**
   * Whether anything is moving, as of the last frame. Read from a ref because
   * the answer depends on the very data this poll fetches; a frame behind is
   * the right amount, since the notification stream nudges the deps the moment
   * the server has news.
   */
  const moving = useRef(true)

  const poll = usePoll(signal => api.session(id, signal), {
    every: 4_000,
    idle: 20_000,
    live: moving.current,
    deps: [id, nudge],
  })
  const session = poll.data

  // A `git diff` per poll, so it runs while you are reading it and not otherwise.
  const diff = usePoll(signal => api.diff(id, signal), {
    every: 8_000,
    enabled: pane === 'diff',
    deps: [id],
  })

  const busy = session?.activity === 'working' || live?.status === 'running' || live?.status === 'queued'
  moving.current = Boolean(busy) || session?.status === 'running'
  const tick = useTick(Boolean(busy) || jobs.active.length > 0)

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
      if (!controller.signal.aborted) poll.refresh()
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

  /**
   * The diff as somebody else's diff renderer draws it, when they have one.
   *
   * A person who installed `delta` has already decided how a diff should look,
   * and three colours of our own is a worse version of a thing they chose.
   */
  const rendered = useMemo(
    () => (pane === 'diff' ? renderPatch(patch, width, diffTool) : null),
    [pane, patch, width, diffTool],
  )
  const anchors = useMemo(
    () => (rendered ? anchorsFor(rendered, files.map(file => file.path)) : null),
    [rendered, files],
  )

  /**
   * One shape for both panes, so the scroll window does not care which it is
   * looking at: a line of text, optionally coloured, optionally already styled
   * by the Markdown renderer.
   */
  const diffBody = useMemo<Drawn[]>(() => {
    if (pane !== 'diff') return []
    if (rendered) return rendered.map(text => ({ kind: 'text', text }))
    const raw = patch ? plain(patch).split('\n') : ['No changes.']
    return raw.map(text => ({ kind: 'text', text, tone: toneForDiffLine(text) }))
  }, [pane, rendered, patch])

  const prompt = live?.prompts.find(item => !answered.includes(item.id))
  const body: Drawn[] = pane === 'diff' ? diffBody : lines
  const room = Math.max(1, height - (prompt ? 4 : 0) - (overlay ? 5 : 0))
  const scroll = useScroll(body.length, room, motions, focused && mode === 'nav')
  const visible = windowOf(body, scroll.offset, room)

  const topLine = Math.max(0, body.length - scroll.offset - room)
  const currentFile = pane === 'diff' && !rendered ? fileAt(files, topLine) : null

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

    if (prompt) {
      if (input === 'y') return void answer(prompt, 'allow', { scope: 'once' })
      if (input === 'a') return void answer(prompt, 'allow', { scope: 'session' })
      if (input === 'n' && !key.shift) return void answer(prompt, 'deny')
      if (input === 'N') {
        setReason('')
        setOverlay({ kind: 'deny', prompt })
        setMode('insert')
        return
      }
    }

    if (pane === 'diff') {
      if (keys.matches('diff.back', input, key)) {
        setPane('talk')
        return
      }
      if (input === 'n' || input === 'N') {
        stepTo(input === 'n' ? 1 : -1)
        return
      }
    } else if (key.escape) {
      onBack()
      return
    }

    if (keys.matches('session.write', input, key)) {
      setMode('insert')
      return
    }
    if (keys.matches('session.editor', input, key)) return void writeInEditor()
    if (keys.matches('session.diff', input, key) && pane !== 'diff') {
      setPane('diff')
      return
    }
    if (keys.matches('session.checks', input, key)) void checks()
    if (keys.matches('session.repair', input, key)) void repair()
    if (keys.matches('session.update', input, key)) void updateBase()
    if (keys.matches('session.trust', input, key)) void cycleTrust()
    if (keys.matches('session.stop', input, key)) void stop()
    if (keys.matches('session.shell', input, key)) void shell()
    if (keys.matches('session.worktree', input, key)) void worktreeEditor()
    if (keys.matches('session.pr', input, key)) askPullRequest()
    if (keys.matches('session.merge', input, key)) void askMerge()
    if (keys.matches('session.close', input, key)) askClose()
    if (keys.matches('browser', input, key)) openBrowser(`/sessions/${id}`)
    if (keys.matches('refresh', input, key)) {
      poll.refresh()
      diff.refresh()
    }
  }, { isActive: focused && mode === 'nav' })

  /** Jump the window to the next or previous file in the patch. */
  function stepTo(direction: 1 | -1) {
    if (anchors && anchors.length) {
      const next = direction === 1
        ? anchors.find(anchor => anchor > topLine)
        : [...anchors].reverse().find(anchor => anchor < topLine)
      if (next != null) scroll.set(Math.max(0, body.length - room - next))
      return
    }
    const next = stepFile(files, topLine, direction)
    if (next != null) scroll.set(Math.max(0, body.length - room - next))
  }

  async function send(instruction: string) {
    const value = instruction.trim()
    if (!value) return
    setPendingInput(value)
    const ok = await jobs.run('send', null, async () => {
      const result = await api.send(id, value)
      setRunId(result.runId)
    })
    if (ok) {
      setDraft(draftKey, '')
      setMode('nav')
      setPane('talk')
      scroll.toBottom()
    }
  }

  /**
   * Write it in `$EDITOR`.
   *
   * Instructions are prose, and a one-line field inside a terminal app is never
   * going to be good at prose. `git commit` settled this: hand over a file, take
   * back what was saved.
   */
  async function writeInEditor() {
    let written: string | null = null
    await suspend(async () => {
      written = await composeInEditor(text)
    })
    if (written) await send(written)
  }

  async function answer(
    request: PermissionRequest,
    behavior: 'allow' | 'deny',
    opts: { scope?: 'once' | 'session'; message?: string } = {},
  ) {
    setAnswered(current => [...current, request.id])
    const ok = await jobs.run(
      `permission:${request.id}`,
      null,
      () => api.answerPermission(request.id, behavior, opts),
    )
    // Putting it back is better than pretending: if the answer did not land, the
    // run is still waiting and you still have to decide.
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
    await jobs.run('checks', 'Running the checks', () => api.runChecks(id))
    poll.refresh()
  }

  async function repair() {
    if (!session?.check || session.check.status === 'passing') {
      await jobs.run('repair', null, async () => {
        throw new Error('Nothing to fix — run the checks first with c.')
      })
      return
    }
    const ok = await jobs.run('repair', 'Asking it to fix the checks', async () => {
      const started = await api.repair(id)
      setRunId(started.runId)
    })
    if (ok) poll.refresh()
  }

  async function updateBase() {
    const ok = await jobs.run('update', `Bringing ${session?.baseBranch ?? 'the base'} in`, async () => {
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
    const ok = await jobs.run('trust', `Trust: ${next.label}`, () => api.setTrust(id, next.level))
    if (ok) poll.refresh()
  }

  async function stop() {
    if (!runId) return
    await jobs.run('stop', 'Stopping', () => api.cancelRun(runId))
    poll.refresh()
  }

  async function shell() {
    const cwd = session?.worktreePath
    if (!cwd) return
    await suspend(() => runInTty(defaultShell(), [], cwd).then(() => undefined))
  }

  async function worktreeEditor() {
    const cwd = session?.worktreePath
    if (!cwd) return
    await suspend(() => runInTty(defaultEditor(), [cwd], cwd).then(() => undefined))
  }

  function askPullRequest() {
    setOverlay({
      kind: 'confirm',
      question: 'File a pull request on GitHub?',
      detail: [`${session?.branch} → ${session?.baseBranch}`, 'Uncommitted work is committed first.'],
      onYes: () => { void pullRequest() },
    })
  }

  async function pullRequest() {
    await jobs.run('pr', 'Opening the pull request', async () => {
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

  /** Ask git what a merge would do before asking the person. */
  async function askMerge() {
    const ok = await jobs.run('merge.preview', 'Checking', async () => {
      const preview = await api.previewMerge(id)
      if (!preview.canMerge && !preview.blockedByChecks) {
        throw new Error(preview.blockedReason || 'This cannot be merged yet.')
      }

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
    await jobs.run('merge', 'Merging', () => api.mergeSession(id, { commitFirst: true, override }))
    poll.refresh()
  }

  function askClose() {
    setOverlay({
      kind: 'confirm',
      question: 'Close this session and remove the worktree?',
      detail: [
        session?.worktree.dirty
          ? 'There is uncommitted work in it, which will be lost.'
          : 'Nothing uncommitted.',
        `The branch ${session?.branch} goes too.`,
      ],
      onYes: () => { void close() },
    })
  }

  async function close() {
    const ok = await jobs.run('close', 'Closing', () => api.closeSession(id, { force: true }))
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

  const footer = pane === 'diff'
    ? keys.hint(['diff.file', 'diff.back', 'session.shell'])
    : keys.hint(['session.write', 'session.editor', 'session.diff', 'session.checks', 'session.repair', 'session.stop'])

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color={ACCENT} bold>{plain(session.title)}</Text>
        <Text color="gray">{`    ${session.branch} → ${session.baseBranch}`}</Text>
      </Text>
      <Box paddingTop={1} paddingBottom={1} flexShrink={0}>
        <Text wrap="truncate">
          <Glyph tone={tone} spinning={Boolean(busy)} frame={spinnerFrame(tick)} />
          <Text> </Text>
          <Text color="gray">
            {pane === 'diff'
              ? `${patchSummary(files)}${currentFile ? `   ${currentFile.path}` : ''}`
              : summary}
          </Text>
        </Text>
      </Box>

      {/*
        * `overflow="hidden"` and nothing shrinkable around it.
        *
        * Yoga compresses a flex child that does not fit and Ink draws the
        * content anyway — one line over another, which reads as corruption
        * rather than as a layout being one row out. Everything fixed says
        * `flexShrink={0}`, so the only thing that can give is this box, and
        * when it does it clips instead of overlapping.
        */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
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

      {!scroll.atBottom ? (
        <Text color="yellow">{`↓ ${scroll.behind} more below — G for the end`}</Text>
      ) : null}

      {prompt ? (
        <PermissionFrame
          verb={promptHeadline(prompt, session.worktreePath).replace(/^wants to /, '')}
          target=""
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
          ) : (
            <Box flexDirection="column">
              {promptDetail(prompt, session.worktreePath, 6).map((line, i) => (
                <Text key={i} color={line.tone === 'cyan' ? ACCENT : line.tone} wrap="truncate">
                  {line.text}
                </Text>
              ))}
              <Text color="gray">{keys.hint(['session.allow', 'session.deny'])}</Text>
            </Box>
          )}
        />
      ) : null}

      {overlay?.kind === 'confirm' ? (
        <Confirm question={overlay.question} detail={overlay.detail} />
      ) : null}

      {composing && overlay?.kind !== 'deny' ? (
        <Box paddingTop={1} flexShrink={0}>
          <TextField
            value={text}
            onChange={value => setDraft(draftKey, value)}
            onSubmit={() => { void send(text) }}
            onCancel={() => setMode('nav')}
            isActive
            placeholder="instruction — ⌃j for a newline, I for $EDITOR"
            width={width}
          />
        </Box>
      ) : overlay?.kind === 'deny' ? null : (
        <Box paddingTop={1} flexShrink={0}>
          <Text color="gray" wrap="truncate">
            {text ? `›  ${text} · i to go on` : '›  i to write'}
          </Text>
        </Box>
      )}

      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">{footer}</Text>
      </Box>
    </Box>
  )
}
