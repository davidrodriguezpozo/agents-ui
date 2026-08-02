import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getScopeRoots } from '../../utils/scope'
import type { Workflow } from '~/types'

export default defineEventHandler(async (event) => {
  const workflows: Workflow[] = []

  for (const root of getScopeRoots(event)) {
    const dir = join(root.dir, 'workflows')
    if (!existsSync(dir)) continue

    const files = (await readdir(dir)).filter(f => f.endsWith('.json'))
    for (const filename of files) {
      const filePath = join(dir, filename)
      try {
        const data = JSON.parse(await readFile(filePath, 'utf-8'))
        workflows.push({
          slug: filename.replace(/\.json$/, ''),
          filePath,
          scope: root.scope,
          ...data,
        })
      } catch {
        // Skip malformed workflow files
      }
    }
  }

  return workflows.sort((a, b) => a.name.localeCompare(b.name))
})
