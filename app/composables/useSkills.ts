import type { Skill, SkillPayload } from '~/types'

export function useSkills() {
  const skills = useState<Skill[]>('skills', () => [])
  const loading = useState('skillsLoading', () => false)

  async function fetchAll() {
    loading.value = true
    try {
      skills.value = await $fetch<Skill[]>('/api/skills')
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(slug: string) {
    return await $fetch<Skill>(`/api/skills/${slug}`)
  }

  async function create(payload: SkillPayload) {
    const skill = await $fetch<Skill>('/api/skills', { method: 'POST', body: payload })
    skills.value.push(skill)
    return skill
  }

  async function update(slug: string, payload: SkillPayload) {
    const skill = await $fetch<Skill>(`/api/skills/${slug}`, { method: 'PUT', body: payload })
    const idx = skills.value.findIndex(s => s.slug === slug)
    if (idx >= 0) skills.value[idx] = skill
    else skills.value.push(skill)
    return skill
  }

  async function remove(slug: string) {
    await $fetch(`/api/skills/${slug}`, { method: 'DELETE' })
    skills.value = skills.value.filter(s => s.slug !== slug)
  }

  return { skills, loading, fetchAll, fetchOne, create, update, remove }
}
