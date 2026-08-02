import type { Command, CommandPayload } from '~/types'

export interface CommandGroup {
  key: string
  label: string
  icon: string
  /** `plugin`, `project` or `user` — drives the badge colour. */
  kind: 'user' | 'project' | 'plugin'
  pluginId?: string
  commands: Command[]
}

export function useCommands() {
  const crud = useCrud<Command, CommandPayload>('/api/commands', { stateKey: 'commands', label: 'commands' })

  const groupedByDirectory = computed(() => {
    const groups: Record<string, Command[]> = {}
    for (const cmd of crud.items.value) {
      const dir = cmd.directory || 'root'
      if (!groups[dir]) groups[dir] = []
      groups[dir].push(cmd)
    }
    return groups
  })

  /**
   * Group by where the command actually comes from — your global directory, the
   * current project, or a specific plugin. This is the question people ask when
   * they see an unfamiliar command in the list.
   */
  const groupedBySource = computed<CommandGroup[]>(() => {
    const groups = new Map<string, CommandGroup>()

    for (const cmd of crud.items.value) {
      let key: string
      let group: Omit<CommandGroup, 'commands'>

      if (cmd.source === 'plugin') {
        key = `plugin:${cmd.pluginId}`
        group = {
          key,
          label: cmd.pluginName || 'Plugin',
          icon: 'i-lucide-puzzle',
          kind: 'plugin',
          pluginId: cmd.pluginId,
        }
      } else if (cmd.scope === 'project') {
        key = 'project'
        group = { key, label: 'This project', icon: 'i-lucide-folder-git-2', kind: 'project' }
      } else {
        key = 'user'
        group = { key, label: 'Personal', icon: 'i-lucide-user', kind: 'user' }
      }

      if (!groups.has(key)) groups.set(key, { ...group, commands: [] })
      groups.get(key)!.commands.push(cmd)
    }

    // Yours first, then the project's, then plugins alphabetically.
    const order = { user: 0, project: 1, plugin: 2 }
    return [...groups.values()].sort((a, b) =>
      order[a.kind] - order[b.kind] || a.label.localeCompare(b.label)
    )
  })

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
    groupedByDirectory,
    groupedBySource,
    getCommandsForAgent,
  }
}
