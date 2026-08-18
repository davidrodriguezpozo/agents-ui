/**
 * What the wall will and will not do when spoken to.
 *
 * Standing across a room from a screen and saying "start a session that fixes
 * the failing checks in billing" is the shortest path from a thought to work
 * happening that this app has. It is also the least guarded surface it has ever
 * had, and the two facts are the same fact: **anything audible in the room can
 * speak**. A colleague, a video call, a podcast, a television. None of them are
 * authenticated by being loud.
 *
 * So the grammar is deliberately small, and the interesting part of this file is
 * what it refuses. Four rules, in the order they matter:
 *
 * **Nothing is ever heard unless a key is held.** There is no wake word and no
 * ambient listening, which also happens to answer the privacy problem below: a
 * microphone that is only on while a finger is on a key cannot be surprising.
 *
 * **Anything that starts or stops work is confirmed by hand.** The confirmation
 * is a keypress, never a spoken "yes" — a spoken confirmation is the same
 * unauthenticated channel as the command, and would make the whole two-step
 * theatre. Somebody physically present presses a key; that is the authentication.
 *
 * **The dangerous verbs are not implemented, they are answered.** Merging,
 * pushing, deleting, granting permissions and changing settings are refused *in
 * words*, so a room hears why rather than watching nothing happen. Adding them
 * later would not be a feature, it would be removing this file's reason to exist.
 *
 * **A misheard instruction is shown before it runs.** Speech recognition is a
 * guess. The transcript and the parsed intent are both on screen, and the
 * confirmation is against what was *understood*, not what was said.
 *
 * A privacy note that belongs next to the code rather than in a release note:
 * Chrome's Web Speech API is not local. Audio captured while the key is held is
 * sent to Google for transcription. This app otherwise runs entirely on your own
 * machine, so that is a real exception and the UI says so before the microphone
 * is ever enabled. A local recogniser is the obvious upgrade and would remove the
 * caveat entirely.
 */

export type VoiceCommand =
  /** Start a session. Cuts a worktree, spends money, runs an agent. */
  | { kind: 'session'; instruction: string; project?: string }
  /** Stop what is running — the brake, which is why it is in the grammar. */
  | { kind: 'stop'; project?: string }
  /** Heard, understood, and declined. `why` is said out loud. */
  | { kind: 'refused'; verb: string; why: string }
  | { kind: 'unknown'; heard: string }

/**
 * Verbs this will not do, and what it says instead.
 *
 * Each of these is reachable in the app in one click by somebody sitting at it.
 * The objection is not that they are hard, it is that a voice is not a person:
 * `merge` is irreversible from the repository's point of view, `approve` hands
 * an agent a tool it was refused, and both would be triggerable by a passing
 * conversation.
 */
const REFUSALS: { pattern: RegExp; verb: string; why: string }[] = [
  {
    /**
     * Inflected on purpose. `\bmerge\b` does not match "merges", and the phrase
     * that found that out was "start a session that merges the billing branch" —
     * which parsed as a perfectly ordinary session request whose entire
     * instruction was the refused thing.
     *
     * "landed" is deliberately absent: it is the past tense people use to *ask*
     * ("what landed today"), and refusing a question would be nonsense. The
     * imperative is covered by `land` on its own.
     */
    pattern: /\b(merge[sd]?|merging|land|ship it|push(es|ed|ing)?|pull request|open a pr)\b/,
    verb: 'merge',
    why: 'Landing work is not something a voice can do here. Do it from the session.',
  },
  {
    pattern: /\b(delete[sd]?|deleting|remove[sd]?|discard(s|ed)?|throw away|wipe[sd]?|reset)\b/,
    verb: 'delete',
    why: 'Nothing is deleted by voice.',
  },
  {
    pattern: /\b(approve|allow|grant|permission|yes to)\b/,
    verb: 'approve',
    why: 'Permission answers are not taken by voice — anything in the room could give one.',
  },
  {
    pattern: /\b(settings?|preferences?|cap|limit|sandbox|budget)\b.*\b(change|set|raise|turn off|disable)\b|\b(change|set|raise|turn off|disable)\b.*\b(settings?|preferences?|cap|limit|sandbox|budget)\b/,
    verb: 'settings',
    why: 'Settings are changed in the app, not from here.',
  },
]

/**
 * Lead-ins people say to a screen and mean nothing by.
 *
 * Stripped so that "hey claude, show me the fleet" and "show the fleet" are the
 * same command. Also strips the polite tail, because "please" ends up in the
 * middle of an instruction otherwise.
 */
function normalise(transcript: string): string {
  return transcript
    .toLowerCase()
    // Dashes and quotes as well as sentence punctuation — recognisers emit em
    // dashes, and one of them stranded "— show me the night" as unparseable.
    // The plain hyphen survives, because folder names are full of them.
    .replace(/[.,!?;:—–"'“”]+/g, ' ')
    .replace(/^\s*(hey|ok|okay|hi)?\s*(claude|studio|fleet|computer)?\s*[, ]*/, ' ')
    .replace(/\bplease\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `in billing`, `on the storefront repo` — the project, when one was named. */
function projectIn(text: string): { project?: string; rest: string } {
  const match = text.match(/\b(?:in|on|for)\s+(?:the\s+)?([a-z0-9][a-z0-9 _-]{0,40}?)(?:\s+repo(?:sitory)?|\s+project)?$/)
  if (!match) return { rest: text }

  return { project: match[1]!.trim(), rest: text.slice(0, match.index).trim() }
}

/**
 * A sentence, understood — or honestly reported as not.
 *
 * The order is the safety property, and it is not the obvious one.
 *
 * **Refusals come first**, ahead of the two commands that act. "Start a session
 * that merges the billing branch" is a session request wrapped round a verb this
 * will not do, and reading it as a session would launch an agent whose entire
 * instruction is the refused thing. That sentence is the reason this ordering is
 * written down rather than left to chance.
 *
 * **Nothing here navigates.** The grammar used to move the wall's rotation, and
 * those phrases were answered ahead of the refusals because looking at something
 * cannot do anything. The rotation is gone and so are they: a screen with one
 * layout has nowhere to be sent. What survives of that reasoning is the reason
 * "landed" is absent from the merge refusal — the past tense is how people ask a
 * question, and refusing a question is nonsense.
 */
export function parseCommand(transcript: string): VoiceCommand {
  const heard = transcript.trim()
  const text = normalise(heard)
  if (!text) return { kind: 'unknown', heard }

  for (const { pattern, verb, why } of REFUSALS) {
    if (pattern.test(text)) return { kind: 'refused', verb, why }
  }

  /**
   * The brake. Broad on purpose — somebody saying "stop" at a wall means it, and
   * stopping a turn keeps everything it has already written, so the worst case
   * of a false positive is a turn you ask for again.
   */
  if (/^stop\b/.test(text)) {
    const { project } = projectIn(text)
    return { kind: 'stop', project }
  }

  const session = text.match(/^(?:start|begin|new|create|make)\s+(?:a\s+)?(?:new\s+)?session\s*(?:that|to|which|for)?\s*(.*)$/)
  if (session) {
    const { project, rest } = projectIn((session[1] ?? '').trim())
    const instruction = rest.trim()

    // An instruction is the whole point: a session with nothing to do is a
    // worktree somebody has to tidy up, and "start a session" on its own is far
    // more likely to be a half-finished sentence than a request for one.
    if (!instruction) return { kind: 'unknown', heard }

    return { kind: 'session', instruction, project }
  }

  return { kind: 'unknown', heard }
}

/**
 * Whether a hand has to agree.
 *
 * Both of the commands that survive change something on this machine, so both
 * are confirmed. It stays a function rather than becoming `true` because the
 * distinction is the rule — anything added to this grammar that does not change
 * anything belongs on the other side of it, and a hard-coded `true` is how the
 * next person adds something that does and never notices.
 */
export function needsConfirmation(command: VoiceCommand): boolean {
  return command.kind === 'session' || command.kind === 'stop'
}

/** What the screen shows, and what is said back if speech is on. */
export function describe(command: VoiceCommand): string {
  switch (command.kind) {
    case 'session':
      return command.project
        ? `Start a session in ${command.project}: ${command.instruction}`
        : `Start a session: ${command.instruction}`
    case 'stop':
      return command.project ? `Stop what is running in ${command.project}` : 'Stop what is running'
    case 'refused':
      return command.why
    case 'unknown':
      return command.heard ? `Not understood: “${command.heard}”` : 'Nothing heard'
  }
}

/**
 * Which project a spoken name meant.
 *
 * Matched against the repositories already registered, never against the
 * filesystem: a voice command must not be able to name a directory this app was
 * not already pointed at. Exact folder name first, then a prefix, then a
 * contained word — and nothing at all rather than a wrong repository, because
 * the caller's fallback (the project you are in) is a much better wrong answer
 * than somebody else's repo.
 */
export function matchProject<T extends { path: string; name: string }>(
  spoken: string | undefined,
  projects: T[],
): T | null {
  if (!spoken) return null

  const want = spoken.toLowerCase().replace(/\s+/g, '-')
  const of = (project: T) => project.name.toLowerCase()

  return projects.find(p => of(p) === want)
    ?? projects.find(p => of(p).startsWith(want))
    ?? projects.find(p => of(p).includes(want))
    ?? null
}
