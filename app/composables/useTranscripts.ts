import type { Session } from './useSessions'

export interface Transcript {
  sdkSessionId: string
  title: string
  turnCount: number
  updatedAt: number
}

/**
 * Conversations you had with Claude Code in the terminal, in this project.
 *
 * Adopting one continues the same conversation here — but in a worktree, with
 * a diff and a merge behind it, which the terminal cannot give you.
 */
export function useTranscripts() {
  const transcripts = useState<Transcript[]>('transcripts', () => [])
  const loading = useState('transcriptsLoading', () => false)

  async function fetchAll(dir?: string) {
    loading.value = true
    try {
      const result = await $fetch<{ transcripts: Transcript[] }>('/api/transcripts', {
        query: dir ? { dir } : undefined,
      })
      transcripts.value = result.transcripts
    } catch {
      // Nothing to continue is the same outcome as nothing readable, and this
      // is an offer rather than a feature anyone is waiting on.
      transcripts.value = []
    } finally {
      loading.value = false
    }
  }

  async function adopt(sdkSessionId: string, dir?: string): Promise<Session> {
    const session = await $fetch<Session>('/api/transcripts/adopt', {
      method: 'POST',
      body: { sdkSessionId, dir },
    })
    transcripts.value = transcripts.value.filter(t => t.sdkSessionId !== sdkSessionId)
    return session
  }

  return { transcripts, loading, fetchAll, adopt }
}
