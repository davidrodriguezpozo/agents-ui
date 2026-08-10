import type { Skill, SkillFile, SkillPayload } from '~/types'

interface SkillFileContents {
  path: string
  content: string
  size: number
}

/** What a folder import sends: one entry per file, paths relative to the folder. */
export interface SkillImportFile {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

export function useSkills() {
  const crud = useCrud<Skill, SkillPayload>('/api/skills', { stateKey: 'skills', label: 'skills' })

  const filesPath = (slug: string) => `/api/skills/${encodeURIComponent(slug)}/files`

  /**
   * A supporting file's text — `references/api.md` and the like.
   *
   * Fetched one at a time rather than with the skill: the tree is what you need
   * to see, and the contents are what you need only once you have clicked.
   */
  async function readFile(slug: string, path: string) {
    return await $fetch<SkillFileContents>(filesPath(slug), { query: { path } })
  }

  /** Create or overwrite a supporting file. Returns the tree as it now stands. */
  async function saveFile(slug: string, path: string, content: string) {
    return await $fetch<{ path: string; files: SkillFile[] }>(filesPath(slug), {
      method: 'PUT',
      body: { path, content },
    })
  }

  async function removeFile(slug: string, path: string) {
    return await $fetch<{ deleted: boolean; path: string; files: SkillFile[] }>(filesPath(slug), {
      method: 'DELETE' as const,
      query: { path },
    })
  }

  /** Import one SKILL.md, or a whole skill folder, into the current scope. */
  async function importSkill(payload: { content: string } | { files: SkillImportFile[] }) {
    const { withScope } = useScope()
    const skill = await $fetch<Skill>(withScope('/api/skills/import'), {
      method: 'POST',
      body: payload,
    })
    await crud.fetchAll()
    return skill
  }

  return {
    skills: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
    readFile,
    saveFile,
    removeFile,
    importSkill,
  }
}
