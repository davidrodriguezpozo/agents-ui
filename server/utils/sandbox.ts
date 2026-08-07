import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * What a run is allowed to touch.
 *
 * This is the setting the rest of the product was waiting for. Everything here
 * is built around leaving work running when nobody is watching, and until now
 * the honest description of an unattended run was "a shell, as you, with your
 * network and your whole disk". That is a fine thing to accept while you are
 * sitting in front of it and a poor thing to accept at 08:00 on a Sunday.
 *
 * The Agent SDK sandboxes commands for us. What it wants from here is small:
 * whether to do it at all, and which hosts to let through. The rest — which
 * files may be read and written — comes from `Read` and `Edit` permission
 * rules, which this app already models, so there is deliberately no second
 * filesystem allowlist here to disagree with them.
 *
 * **On by default**, which is the one genuinely contentious choice in this
 * file. A project that has never been configured is sandboxed, including one
 * whose rituals have been running happily for months. The alternative — on for
 * new projects only — protects nobody who is already using the thing, and the
 * people already leaving rituals running unattended are precisely the ones this
 * is for. The cost is a ritual that starts failing on a Tuesday because it
 * needed a host nobody had listed, so a blocked run says exactly which host it
 * wanted and turning the sandbox off for a project is one click.
 */

export interface ProjectSandbox {
  enabled: boolean
  /**
   * Hosts a sandboxed run may reach. Empty means none: no registry, no API, no
   * `git push`. That is the right default for a briefing that reads issues and
   * writes a summary, and the wrong one for anything that installs packages,
   * which is why this is the first thing a blocked run tells you about.
   */
  allowedDomains: string[]
}

export const DEFAULT_PROJECT_SANDBOX: ProjectSandbox = {
  enabled: true,
  allowedDomains: [],
}

/**
 * Kept out of the project's own `.claude/settings.json` for the same reason the
 * check command and the permission grants are: that file is usually tracked,
 * and deciding what your machine is allowed to reach should not arrive in
 * somebody else's `git pull` as policy.
 */
export type ProjectSandboxes = Record<string, ProjectSandbox>

export const projectSandboxStore = defineJsonStore<ProjectSandboxes>({
  label: 'project sandboxing',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-sandbox.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

/** Anything unusable in the file reads as the default, never as "off". */
export function normaliseSandbox(value: unknown): ProjectSandbox {
  const raw = (value ?? {}) as Partial<ProjectSandbox>
  return {
    // A file written before this existed says nothing about sandboxing, which
    // is not the same as saying no to it.
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_PROJECT_SANDBOX.enabled,
    allowedDomains: Array.isArray(raw.allowedDomains)
      ? [...new Set(raw.allowedDomains.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
          .map(d => d.trim()))]
      : [],
  }
}

export interface ResolvedSandbox extends ProjectSandbox {
  /** Whether somebody chose this, or it is simply what we do by default. */
  source: 'configured' | 'default'
}

/**
 * What a repository's runs are allowed to do. Never throws: an unreadable
 * config means the safe default, not a failed turn — the opposite of how the
 * permission allowlist degrades, and for the opposite reason. Falling back to
 * "ask" is safe; falling back to "unsandboxed" would not be.
 */
export async function sandboxForProject(dir: string | undefined): Promise<ResolvedSandbox> {
  if (!dir) return { ...DEFAULT_PROJECT_SANDBOX, source: 'default' }

  try {
    const configured = (await projectSandboxStore.read())[dir]
    if (configured) return { ...normaliseSandbox(configured), source: 'configured' }
  } catch {
    // Deliberately swallowed — see above.
  }

  return { ...DEFAULT_PROJECT_SANDBOX, source: 'default' }
}

export async function setProjectSandbox(dir: string, patch: Partial<ProjectSandbox>): Promise<ProjectSandbox> {
  return projectSandboxStore.update((projects) => {
    const next = normaliseSandbox({ ...(projects[dir] ?? DEFAULT_PROJECT_SANDBOX), ...patch })
    projects[dir] = next
    return next
  })
}

/** Forget the choice, so this project is sandboxed by default again. */
export async function clearProjectSandbox(dir: string): Promise<void> {
  await projectSandboxStore.update((projects) => {
    delete projects[dir]
  })
}

// --- Telling people before it bites them ------------------------------------

/**
 * Which projects have been told that their runs are now sandboxed.
 *
 * Sandboxing arrived switched on, and it reaches projects that were configured
 * before it existed. That is the right default — the people already leaving
 * rituals running unattended are exactly who it protects — but it means someone
 * whose 08:00 briefing has quietly fetched an API for months can have it start
 * failing on a Tuesday for a reason that is nowhere on their screen.
 *
 * A failing run now explains itself well. This is the half-step before that:
 * saying so while everything still works, which is the only version of this
 * that costs nobody a morning.
 *
 * Kept apart from the setting itself on purpose. Acknowledging is not choosing
 * — it must not make a project read as *configured*, or "reset to the default"
 * would vanish for people who had never set anything.
 */
export const sandboxNoticeStore = defineJsonStore<string[]>({
  label: 'sandbox notices',
  path: () => join(getClaudeDir(), 'agents-ui', 'sandbox-notice.json'),
  empty: () => [],
  decode: parsed => parsed?.acknowledged ?? [],
  encode: acknowledged => ({ version: 1, acknowledged }),
})

export async function acknowledgeSandboxNotice(dir: string): Promise<void> {
  await sandboxNoticeStore.update((dirs) => {
    if (!dirs.includes(dir)) dirs.push(dir)
  })
}

/** Rituals as this needs to see them: pinned somewhere, on, and already proven. */
export interface RitualAtRisk {
  projectDir?: string
  enabled: boolean
  lastRunAt?: number
}

/**
 * Whether this project should be told, before something breaks.
 *
 * Three conditions, and all of them matter:
 *
 * - **Nothing has been chosen here.** Somebody who has already been to Settings
 *   knows; telling them again is noise.
 * - **It has scheduled work that has actually run.** A ritual that has never
 *   run cannot have been relying on anything, and a project with no rituals at
 *   all has nothing running unattended to break. This is what keeps the notice
 *   off brand-new projects, where it would be a banner about a hypothetical.
 * - **They have not already said they have read it.**
 */
export function shouldWarn(opts: {
  source: 'configured' | 'default'
  rituals: RitualAtRisk[]
  acknowledged: boolean
  dir: string
}): boolean {
  if (opts.source === 'configured' || opts.acknowledged) return false
  return opts.rituals.some(ritual =>
    ritual.enabled && Boolean(ritual.lastRunAt) && ritual.projectDir === opts.dir)
}

// --- Handing it to the SDK ---------------------------------------------------

/**
 * Shape a project's setting into the SDK's `sandbox` option, or nothing at all
 * when it is off — an absent key and `{ enabled: false }` mean the same thing
 * to the SDK, and the absent one leaves no doubt in a logged options object.
 *
 * Three of these are not offered as choices, because getting them wrong is how
 * a sandbox becomes decoration:
 *
 * - `allowUnsandboxedCommands: false` stops a run letting *itself* out. The SDK
 *   otherwise honours a per-command escape hatch, which is reasonable when a
 *   person is there to see it used and is exactly the wrong default for a run
 *   nobody is watching. Widening the sandbox stays a thing the owner does, in
 *   Settings, on purpose.
 * - `autoAllowBashIfSandboxed: true` is the reason this is worth having beyond
 *   safety. A sandboxed command does not need to stop and ask, so the failure
 *   mode this product spends the most code on — a ritual that came back at 08:00
 *   having been refused a tool, with half its job undone — largely stops
 *   happening. Sandboxed runs are both safer and likelier to finish.
 * - `allowLocalBinding: true` because a test suite or a dev server binding a
 *   port on this machine is ordinary work, and not a way out of anything.
 */
export function toSandboxSettings(sandbox: ProjectSandbox) {
  if (!sandbox.enabled) return undefined

  return {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: {
      allowLocalBinding: true,
      ...(sandbox.allowedDomains.length ? { allowedDomains: sandbox.allowedDomains } : {}),
    },
  }
}
