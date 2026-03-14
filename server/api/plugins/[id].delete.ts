import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveClaudePath } from '../../utils/claudeDir'

interface InstalledEntry {
  installPath: string
  [key: string]: unknown
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    if (!existsSync(path)) return null
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const id = decodeURIComponent(getRouterParam(event, 'id')!)

  // Remove from installed_plugins.json
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)

  if (!installed?.plugins?.[id]) {
    throw createError({ statusCode: 404, message: `Plugin not found: ${id}` })
  }

  delete installed.plugins[id]
  await writeFile(installedPath, JSON.stringify(installed, null, 2), 'utf-8')

  // Remove from enabledPlugins in settings.json
  const settingsPath = resolveClaudePath('settings.json')
  const settings = await readJson<Record<string, unknown>>(settingsPath)
  if (settings?.enabledPlugins && typeof settings.enabledPlugins === 'object') {
    const ep = settings.enabledPlugins as Record<string, boolean>
    if (id in ep) {
      delete ep[id]
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    }
  }

  return { ok: true }
})
