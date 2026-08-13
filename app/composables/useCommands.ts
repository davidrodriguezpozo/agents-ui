import type { Command, CommandPayload } from '~/types'

export function useCommands() {
  const crud = useCrud<Command, CommandPayload>('/api/commands', { stateKey: 'commands', label: 'commands' })

  function getCommandsForAgent(agentSlug: string, agentName: string, allCommands: Command[]): Command[] {
    const slugLower = agentSlug.toLowerCase()
    const nameLower = agentName.toLowerCase()
    return allCommands.filter(cmd => {
      const bodyLower = cmd.body.toLowerCase()
      return bodyLower.includes(`/${slugLower}`) || bodyLower.includes(slugLower) || bodyLower.includes(nameLower)
    })
  }

  return {
    commands: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
    getCommandsForAgent,
  }
}
