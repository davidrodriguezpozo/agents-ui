import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getScopeRoots } from '../../utils/scope'
import { readInstalledPlugins } from '../../utils/pluginScan'
import { describeRecurrence, readSchedules, type Recurrence } from '../../utils/schedules'

interface RitualDeclaration {
  command: string
  title?: string
  description?: string
  hour?: number
  minute?: number
  days?: number[]
  recommended?: boolean
}

/**
 * Daily rituals a team lead has suggested, declared in a `rituals.json` at the
 * root of a plugin:
 *
 *   { "rituals": [
 *       { "command": "/hd:goodmorning", "title": "Morning briefing",
 *         "hour": 8, "days": [1,2,3,4,5], "recommended": true }
 *   ] }
 *
 * This rides the same git → marketplace → plugin path as everything else, so a
 * lead ships rituals the way they already ship commands. Nothing is scheduled
 * automatically — people opt in.
 */
export default defineEventHandler(async (event) => {
  const roots = getScopeRoots(event)
  const [plugins, existing] = await Promise.all([
    readInstalledPlugins(roots[0]!.dir),
    readSchedules(),
  ])

  const alreadyScheduled = new Set(existing.map(s => s.input.trim()))
  const suggestions = []

  for (const plugin of plugins) {
    const path = join(plugin.entry.installPath, 'rituals.json')
    if (!existsSync(path)) continue

    let declared: RitualDeclaration[]
    try {
      const parsed = JSON.parse(await readFile(path, 'utf-8')) as { rituals?: RitualDeclaration[] }
      declared = parsed.rituals ?? []
    } catch {
      continue
    }

    for (const ritual of declared) {
      if (!ritual.command?.trim()) continue

      const recurrence: Recurrence = {
        hour: ritual.hour ?? 9,
        minute: ritual.minute ?? 0,
        days: ritual.days ?? [1, 2, 3, 4, 5],
      }

      suggestions.push({
        command: ritual.command.trim(),
        title: ritual.title || ritual.command.trim(),
        description: ritual.description || '',
        recurrence,
        recurrenceLabel: describeRecurrence(recurrence),
        recommended: ritual.recommended !== false,
        pluginName: plugin.name,
        alreadyAdded: alreadyScheduled.has(ritual.command.trim()),
      })
    }
  }

  return suggestions
})
