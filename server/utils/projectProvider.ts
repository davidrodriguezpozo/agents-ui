import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { asProviderId, DEFAULT_PROVIDER, type ProviderId } from './providers'

/**
 * Which agent a repository's new sessions start on.
 *
 * There are two places a provider can be chosen and this is the quieter one:
 * the picker where a session is created is for the session in front of you, and
 * this is for the answer you would otherwise give it every time. A repository
 * whose test suite only one agent reliably passes is a real thing, and setting
 * it once per repository beats remembering it per session.
 *
 * Keyed by repository, never by working directory — a session's `projectDir` is
 * a worktree that is created per session and deleted when it closes, so a
 * preference filed against that key is written where nothing reads and
 * evaporates. The same mistake the sandbox made once; see `RunRequest.repoDir`.
 *
 * Never throws. An unreadable file means Claude Code, which is what every
 * session did before this existed — falling back to the thing that has always
 * worked is safe, and refusing to start a session over a preferences file is
 * not.
 */
type ProjectProviders = Record<string, ProviderId>

export const projectProviderStore = defineJsonStore<ProjectProviders>({
  label: 'project provider',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-provider.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

/** The default for this repository, or Claude Code when nothing was chosen. */
export async function providerForProject(dir: string | undefined): Promise<ProviderId> {
  if (!dir) return DEFAULT_PROVIDER

  try {
    return asProviderId((await projectProviderStore.read())[dir]) ?? DEFAULT_PROVIDER
  } catch {
    // Deliberately swallowed — see above.
    return DEFAULT_PROVIDER
  }
}

export async function setProjectProvider(dir: string, provider: ProviderId): Promise<ProviderId> {
  return projectProviderStore.update((projects) => {
    projects[dir] = provider
    return provider
  })
}

/** Forget the choice, so this repository starts on Claude Code again. */
export async function clearProjectProvider(dir: string): Promise<void> {
  await projectProviderStore.update((projects) => {
    delete projects[dir]
  })
}
