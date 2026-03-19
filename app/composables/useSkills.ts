import type { Skill, SkillPayload } from '~/types'

export function useSkills() {
  const crud = useCrud<Skill, SkillPayload>('/api/skills', { stateKey: 'skills', label: 'skills' })

  return {
    skills: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
  }
}
