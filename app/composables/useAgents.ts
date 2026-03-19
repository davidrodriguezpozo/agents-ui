import type { Agent, AgentPayload } from '~/types'

export function useAgents() {
  const crud = useCrud<Agent, AgentPayload>('/api/agents', { stateKey: 'agents', label: 'agents' })

  return {
    agents: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
  }
}
