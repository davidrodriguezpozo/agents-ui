import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveClaudePath } from './claudeDir'
import { parseFrontmatter } from './frontmatter'
import type { SkillFrontmatter, GithubImport, GithubImportsRegistry } from '~/types'

interface ParsedGithubUrl {
  owner: string
  repo: string
  branch: string | null
  path: string | null
}

const SKIP_FILENAMES = new Set([
  'README.md', 'readme.md',
  'CHANGELOG.md', 'changelog.md',
  'CONTRIBUTING.md', 'contributing.md',
  'LICENSE.md', 'license.md',
  'CODE_OF_CONDUCT.md',
])

export function parseGithubUrl(url: string): ParsedGithubUrl | null {
  const match = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/
  )
  if (!match) return null

  return {
    owner: match[1]!,
    repo: match[2]!,
    branch: match[4] || null,
    path: match[5] || null,
  }
}

interface GithubTreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  url: string
}

interface SkillsIndexEntry {
  slug: string
  name: string
  description: string
  category?: string
  tags?: string | string[]
  path: string
  files: string[]
  metadata?: Record<string, unknown>
}

interface SkillsIndex {
  version: string
  skills: SkillsIndexEntry[]
}

export async function fetchRepoTree(owner: string, repo: string, branch: string): Promise<GithubTreeEntry[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'agents-ui',
    },
  })

  if (response.status === 403) {
    const resetHeader = response.headers.get('x-ratelimit-reset')
    const resetIn = resetHeader ? Math.ceil((parseInt(resetHeader) * 1000 - Date.now()) / 60000) : '?'
    throw createError({
      statusCode: 429,
      data: { error: 'rate_limited', message: `GitHub API rate limit reached. Try again in ${resetIn} minutes.` },
    })
  }

  if (response.status === 404) {
    throw createError({
      statusCode: 404,
      data: { error: 'not_found', message: 'Repository or branch not found' },
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      data: { error: 'github_error', message: `GitHub API error: ${response.statusText}` },
    })
  }

  const data = await response.json() as { tree: GithubTreeEntry[] }
  return data.tree
}

export async function fetchFileContent(owner: string, repo: string, branch: string, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'agents-ui',
    },
  })

  if (response.status === 403) {
    const resetHeader = response.headers.get('x-ratelimit-reset')
    const resetIn = resetHeader ? Math.ceil((parseInt(resetHeader) * 1000 - Date.now()) / 60000) : '?'
    throw createError({
      statusCode: 429,
      data: { error: 'rate_limited', message: `GitHub API rate limit reached. Try again in ${resetIn} minutes.` },
    })
  }

  if (!response.ok) {
    throw createError({ statusCode: response.status, message: `Failed to fetch ${path}` })
  }

  const data = await response.json() as { content: string; encoding: string }
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8')
  }
  return data.content
}

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}`
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'agents-ui',
    },
  })

  if (response.status === 403) {
    const resetHeader = response.headers.get('x-ratelimit-reset')
    const resetIn = resetHeader ? Math.ceil((parseInt(resetHeader) * 1000 - Date.now()) / 60000) : '?'
    throw createError({
      statusCode: 429,
      data: { error: 'rate_limited', message: `GitHub API rate limit reached. Try again in ${resetIn} minutes.` },
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: 404,
      data: { error: 'not_found', message: 'Repository not found' },
    })
  }

  const data = await response.json() as { default_branch: string }
  return data.default_branch
}

interface DetectedSkill {
  slug: string
  name: string
  description: string
  category: string | null
  tags: string[]
  filePath: string
  hasSupporting: boolean
}

export async function detectSkills(
  owner: string,
  repo: string,
  branch: string,
  targetPath: string | null,
): Promise<{ skills: DetectedSkill[]; detectionMethod: 'frontmatter' | 'skills-index' }> {
  const tree = await fetchRepoTree(owner, repo, branch)

  // 1. Check for skills-index.json at repo root
  const indexEntry = tree.find(e => e.path === 'skills-index.json')
  if (indexEntry) {
    const content = await fetchFileContent(owner, repo, branch, 'skills-index.json')
    const index = JSON.parse(content) as SkillsIndex
    let skills = index.skills.map(s => ({
      slug: s.slug,
      name: s.name || s.slug,
      description: typeof s.description === 'string' ? s.description.replace(/^>\s*/, '') : '',
      category: s.category || null,
      tags: Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? [s.tags] : []),
      filePath: s.files?.[0] || s.path,
      hasSupporting: (s.files?.length || 0) > 1,
    }))

    // Filter to target path if specified
    if (targetPath) {
      skills = skills.filter(s => s.filePath.startsWith(targetPath))
    }

    return { skills, detectionMethod: 'skills-index' }
  }

  // 2. Fallback: scan for .md files with valid frontmatter
  const prefix = targetPath ? targetPath + '/' : ''
  const mdFiles = tree.filter(e =>
    e.type === 'blob'
    && e.path.endsWith('.md')
    && (prefix ? e.path.startsWith(prefix) : true)
    && !SKIP_FILENAMES.has(e.path.split('/').pop()!)
  )

  const skills: DetectedSkill[] = []
  const filesToScan = mdFiles.slice(0, 50)

  for (const file of filesToScan) {
    try {
      const content = await fetchFileContent(owner, repo, branch, file.path)
      const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content)

      if (frontmatter.name && frontmatter.description) {
        const parts = file.path.split('/')
        const fileName = parts.pop()!
        const parentDir = parts.pop()
        const slug = (fileName.toLowerCase() === 'skill.md' && parentDir)
          ? parentDir
          : fileName.replace(/\.md$/, '')

        const dir = parts.concat(parentDir ? [parentDir] : []).join('/')
        const hasSupporting = tree.some(e =>
          e.type === 'blob'
          && e.path.startsWith(dir + '/')
          && e.path !== file.path
        )

        const pathParts = file.path.split('/')
        const category = pathParts.length > 2 ? pathParts[pathParts.length - 3] || null : null

        skills.push({
          slug,
          name: frontmatter.name,
          description: frontmatter.description,
          category,
          tags: [],
          filePath: file.path,
          hasSupporting,
        })
      }
    } catch {
      // Skip files that can't be fetched/parsed
    }
  }

  return { skills, detectionMethod: 'frontmatter' }
}

// ── Registry helpers ──────────────────────────────────

export function getImportsPath(): string {
  return resolveClaudePath('github', 'imports.json')
}

export async function readImportsRegistry(): Promise<GithubImportsRegistry> {
  const path = getImportsPath()
  if (!existsSync(path)) return { imports: [] }
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as GithubImportsRegistry
  } catch {
    return { imports: [] }
  }
}

export async function writeImportsRegistry(registry: GithubImportsRegistry): Promise<void> {
  const path = getImportsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(path, JSON.stringify(registry, null, 2), 'utf-8')
}

export function findImport(registry: GithubImportsRegistry, owner: string, repo: string): GithubImport | undefined {
  return registry.imports.find(i => i.owner === owner && i.repo === repo)
}
