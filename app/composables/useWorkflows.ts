import type { Workflow, WorkflowPayload } from '~/types'

export function useWorkflows() {
  const crud = useCrud<Workflow, Partial<WorkflowPayload & { lastRunAt?: string }>>('/api/workflows', { stateKey: 'workflows', label: 'workflows' })

  return {
    workflows: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: (payload: WorkflowPayload) => crud.create(payload),
    update: crud.update,
    remove: crud.remove,
  }
}
