# GitHub Skill Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to import skills from GitHub repositories by pasting a URL, with auto-detection, selective import, and update notifications.

**Architecture:** New server-side GitHub scanning and git operations utilities power 6 API endpoints. A Vue composable (`useGithubImports`) manages client state. The existing skill scanner is extended to discover imported skills from `<claudeDir>/github/`. Three new components handle the import modal, repo cards, and source badges.

**Tech Stack:** Nuxt 3, Vue 3 Composition API, h3 server routes, Node.js `child_process` for git operations, GitHub REST API (unauthenticated), Nuxt UI components.

**Spec:** `docs/superpowers/specs/2026-03-19-github-skill-import-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `server/utils/github.ts` | GitHub URL parsing, API scanning, skill detection |
| `server/utils/gitOps.ts` | Git clone, pull, ls-remote, diff wrappers |
| `server/api/github/scan.post.ts` | Scan a GitHub URL for importable skills |
| `server/api/github/import.post.ts` | Clone repo, register in imports.json |
| `server/api/github/imports.get.ts` | List all imports with status |
| `server/api/github/check-updates.post.ts` | Check all imports for remote changes |
| `server/api/github/update.post.ts` | Pull latest for a specific import |
| `server/api/github/remove.post.ts` | Delete an import (clone + registry entry) |
| `app/composables/useGithubImports.ts` | Client-side state for GitHub imports |
| `app/components/GithubImportModal.vue` | URL input → preview → select → import flow |
| `app/components/ImportedRepoCard.vue` | Repo card with skill count and update badge |
| `app/components/ImportBadge.vue` | Small GitHub icon badge for skill lists |

### Modified Files
| File | Change |
|------|--------|
| `app/types/index.ts` | Add `GithubImport`, `ScannedSkill`, `source` field on `Skill` |
| `server/api/skills/index.get.ts` | Extend scanner to walk `<claudeDir>/github/` |
| `app/pages/explore.vue` | Add "Imported" tab and "Import from GitHub" button |
| `app/pages/skills/index.vue` | Show `ImportBadge` on imported skills |
| `app/pages/skills/[slug].vue` | Read-only mode for imported skills, "Edit a copy" button |
| `app/pages/index.vue` | Show imported count in skill stats |
| `app/pages/settings.vue` | Add "GitHub Imports" management section |

---

## Task 1: Types & Interfaces

**Files:**
- Modify: `app/types/index.ts:95-115`

- [ ] **Step 1: Add GitHub import types to `app/types/index.ts`**

After line 115 (after `SkillPayload`), add:

```typescript
// ── GitHub Imports ──────────────────────────────────

export interface ScannedSkill {
  slug: string
  name: string
  description: string
  category: string | null
  tags: string[]
  filePath: string
  hasSupporting: boolean
  conflict: boolean
}

export interface ScanResult {
  owner: string
  repo: string
  branch: string
  targetPath: string
  skills: ScannedSkill[]
  detectionMethod: 'frontmatter' | 'skills-index'
}

export interface GithubImport {
  owner: string
  repo: string
  url: string
  targetPath: string
  localPath: string
  importedAt: string
  lastChecked: string
  currentSha: string
  remoteSha: string
  selectedSkills: string[]
}

export interface GithubImportsRegistry {
  imports: GithubImport[]
}
```

- [ ] **Step 2: Add `source` field to `Skill` interface**

Change the `Skill` interface (line 95-100) from:

```typescript
export interface Skill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
}
```

To:

```typescript
export interface Skill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
  source?: 'local' | 'github' | 'plugin'
  githubRepo?: string
}
```

- [ ] **Step 3: Verify the app still builds**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && bun run build 2>&1 | tail -5`
Expected: Build succeeds (new types are additive, `source` is optional)

---

## Task 2: GitHub URL Parser & Skill Detection (`server/utils/github.ts`)

**Files:**
- Create: `server/utils/github.ts`

- [ ] **Step 1: Create `server/utils/github.ts`**

```typescript
import { parseFrontmatter } from './frontmatter'
import type { SkillFrontmatter } from '~/types'

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
  // Handle: https://github.com/owner/repo
  // Handle: https://github.com/owner/repo/tree/branch/path
  // Handle: https://github.com/owner/repo/blob/branch/path/file.md
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
  // Limit to first 50 md files to avoid rate limits
  const filesToScan = mdFiles.slice(0, 50)

  for (const file of filesToScan) {
    try {
      const content = await fetchFileContent(owner, repo, branch, file.path)
      const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content)

      if (frontmatter.name && frontmatter.description) {
        // Derive slug from parent folder or filename
        const parts = file.path.split('/')
        const fileName = parts.pop()!
        const parentDir = parts.pop()
        const slug = (fileName.toLowerCase() === 'skill.md' && parentDir)
          ? parentDir
          : fileName.replace(/\.md$/, '')

        // Check for supporting files in same directory
        const dir = parts.concat(parentDir ? [parentDir] : []).join('/')
        const hasSupporting = tree.some(e =>
          e.type === 'blob'
          && e.path.startsWith(dir + '/')
          && e.path !== file.path
        )

        // Infer category from folder structure
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
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && npx tsc --noEmit server/utils/github.ts 2>&1 | head -20`

If tsc isn't available standalone, just verify the dev server starts:
Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && timeout 10 bun run dev 2>&1 | tail -5` (should start without errors)

---

## Task 3: Git Operations Utility (`server/utils/gitOps.ts`)

**Files:**
- Create: `server/utils/gitOps.ts`

- [ ] **Step 1: Create `server/utils/gitOps.ts`**

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'

const exec = promisify(execFile)

async function hasGit(): Promise<boolean> {
  try {
    await exec('git', ['--version'])
    return true
  } catch {
    return false
  }
}

export async function ensureGit(): Promise<void> {
  if (!(await hasGit())) {
    throw createError({
      statusCode: 500,
      data: { error: 'git_not_found', message: 'Git is required for GitHub imports. Install it from git-scm.com' },
    })
  }
}

export async function gitClone(repoUrl: string, destPath: string): Promise<void> {
  await ensureGit()
  if (existsSync(destPath)) {
    throw createError({
      statusCode: 409,
      data: { error: 'already_exists', message: 'This repository is already imported' },
    })
  }
  try {
    await exec('git', ['clone', '--depth', '1', repoUrl, destPath], { timeout: 120_000 })
  } catch (e: any) {
    // Clean up partial clone on failure
    if (existsSync(destPath)) {
      await rm(destPath, { recursive: true, force: true })
    }
    throw createError({
      statusCode: 500,
      data: { error: 'clone_failed', message: `Failed to clone: ${e.stderr || e.message}` },
    })
  }
}

export async function gitPull(repoPath: string): Promise<string> {
  await ensureGit()
  const { stdout } = await exec('git', ['pull'], { cwd: repoPath, timeout: 60_000 })
  return stdout.trim()
}

export async function gitGetHead(repoPath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
  return stdout.trim()
}

export async function gitLsRemote(repoUrl: string): Promise<string> {
  await ensureGit()
  try {
    const { stdout } = await exec('git', ['ls-remote', repoUrl, 'HEAD'], { timeout: 15_000 })
    const sha = stdout.split('\t')[0]
    return sha || ''
  } catch {
    return '' // Network failure — silently use cached state
  }
}

export async function gitDiffFiles(repoPath: string, fromSha: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['diff', '--name-only', fromSha, 'HEAD'], { cwd: repoPath })
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export async function removeClone(destPath: string): Promise<void> {
  if (existsSync(destPath)) {
    await rm(destPath, { recursive: true, force: true })
  }
}
```

---

## Task 4: Import Registry Helpers

**Files:**
- Modify: `server/utils/github.ts` (append)

- [ ] **Step 1: Add registry read/write functions at the end of `server/utils/github.ts`**

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveClaudePath } from './claudeDir'
import type { GithubImport, GithubImportsRegistry } from '~/types'

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
```

Note: The imports at the top of `github.ts` need to be merged with the existing ones. The `readFile`, `writeFile`, `mkdir`, `existsSync`, and `dirname` imports should be added at the top of the file alongside the existing imports.

---

## Task 5: Scan Endpoint (`server/api/github/scan.post.ts`)

**Files:**
- Create: `server/api/github/scan.post.ts`

- [ ] **Step 1: Create the scan endpoint**

```typescript
import { parseGithubUrl, getDefaultBranch, detectSkills, readImportsRegistry } from '../../utils/github'

export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)

  if (!url || typeof url !== 'string') {
    throw createError({
      statusCode: 400,
      data: { error: 'invalid_url', message: 'A GitHub URL is required' },
    })
  }

  const parsed = parseGithubUrl(url.trim())
  if (!parsed) {
    throw createError({
      statusCode: 400,
      data: { error: 'invalid_url', message: 'Could not parse GitHub URL. Expected format: https://github.com/owner/repo' },
    })
  }

  const branch = parsed.branch || await getDefaultBranch(parsed.owner, parsed.repo)
  const { skills, detectionMethod } = await detectSkills(parsed.owner, parsed.repo, branch, parsed.path)

  if (skills.length === 0) {
    throw createError({
      statusCode: 404,
      data: { error: 'no_skills', message: 'No valid skill files found at this location' },
    })
  }

  // Check for conflicts with existing local skills
  const registry = await readImportsRegistry()
  // We also need local skills to check conflicts — use a simple directory check
  const { existsSync } = await import('node:fs')
  const { resolveClaudePath } = await import('../../utils/claudeDir')
  const skillsDir = resolveClaudePath('skills')

  const skillsWithConflicts = skills.map(s => ({
    ...s,
    conflict: existsSync(resolveClaudePath('skills', s.slug, 'SKILL.md')),
  }))

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    targetPath: parsed.path || '',
    skills: skillsWithConflicts,
    detectionMethod,
  }
})
```

---

## Task 6: Import Endpoint (`server/api/github/import.post.ts`)

**Files:**
- Create: `server/api/github/import.post.ts`

- [ ] **Step 1: Create the import endpoint**

```typescript
import { resolveClaudePath } from '../../utils/claudeDir'
import { readImportsRegistry, writeImportsRegistry, findImport } from '../../utils/github'
import { gitClone, gitGetHead } from '../../utils/gitOps'

export default defineEventHandler(async (event) => {
  const { owner, repo, url, targetPath, selectedSkills } = await readBody<{
    owner: string
    repo: string
    url: string
    targetPath: string
    selectedSkills: string[]
  }>(event)

  if (!owner || !repo || !url) {
    throw createError({ statusCode: 400, message: 'owner, repo, and url are required' })
  }

  const registry = await readImportsRegistry()

  // Prevent concurrent import of same repo
  if (findImport(registry, owner, repo)) {
    throw createError({
      statusCode: 409,
      data: { error: 'already_exists', message: 'This repository is already imported' },
    })
  }

  const localPath = resolveClaudePath('github', owner, repo)
  const repoUrl = `https://github.com/${owner}/${repo}.git`

  await gitClone(repoUrl, localPath)

  let sha: string
  try {
    sha = await gitGetHead(localPath)
  } catch {
    sha = ''
  }

  const now = new Date().toISOString()
  const entry = {
    owner,
    repo,
    url,
    targetPath: targetPath || '',
    localPath,
    importedAt: now,
    lastChecked: now,
    currentSha: sha,
    remoteSha: sha,
    selectedSkills: selectedSkills || [],
  }

  registry.imports.push(entry)

  try {
    await writeImportsRegistry(registry)
  } catch (e) {
    // Rollback: remove cloned directory if registry write fails
    const { removeClone } = await import('../../utils/gitOps')
    await removeClone(localPath)
    throw createError({ statusCode: 500, message: 'Failed to save import registry' })
  }

  return entry
})
```

---

## Task 7: List, Check Updates, Update, Remove Endpoints

**Files:**
- Create: `server/api/github/imports.get.ts`
- Create: `server/api/github/check-updates.post.ts`
- Create: `server/api/github/update.post.ts`
- Create: `server/api/github/remove.post.ts`

- [ ] **Step 1: Create `server/api/github/imports.get.ts`**

```typescript
import { readImportsRegistry } from '../../utils/github'

export default defineEventHandler(async () => {
  return await readImportsRegistry()
})
```

- [ ] **Step 2: Create `server/api/github/check-updates.post.ts`**

```typescript
import { readImportsRegistry, writeImportsRegistry } from '../../utils/github'
import { gitLsRemote } from '../../utils/gitOps'

export default defineEventHandler(async () => {
  const registry = await readImportsRegistry()
  const now = new Date().toISOString()

  const results = await Promise.allSettled(
    registry.imports.map(async (entry) => {
      const remoteSha = await gitLsRemote(`https://github.com/${entry.owner}/${entry.repo}.git`)
      entry.lastChecked = now
      if (remoteSha) entry.remoteSha = remoteSha
      return entry
    })
  )

  await writeImportsRegistry(registry)

  return {
    imports: registry.imports,
    updatesAvailable: registry.imports.filter(i => i.currentSha !== i.remoteSha).length,
  }
})
```

- [ ] **Step 3: Create `server/api/github/update.post.ts`**

```typescript
import { readImportsRegistry, writeImportsRegistry, findImport } from '../../utils/github'
import { gitPull, gitGetHead, gitDiffFiles } from '../../utils/gitOps'

export default defineEventHandler(async (event) => {
  const { owner, repo } = await readBody<{ owner: string; repo: string }>(event)

  const registry = await readImportsRegistry()
  const entry = findImport(registry, owner, repo)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Import not found' })
  }

  const oldSha = entry.currentSha
  await gitPull(entry.localPath)
  const newSha = await gitGetHead(entry.localPath)
  const changedFiles = oldSha ? await gitDiffFiles(entry.localPath, oldSha) : []

  entry.currentSha = newSha
  entry.remoteSha = newSha
  entry.lastChecked = new Date().toISOString()

  await writeImportsRegistry(registry)

  return { entry, changedFiles }
})
```

- [ ] **Step 4: Create `server/api/github/remove.post.ts`**

```typescript
import { readImportsRegistry, writeImportsRegistry, findImport } from '../../utils/github'
import { removeClone } from '../../utils/gitOps'

export default defineEventHandler(async (event) => {
  const { owner, repo } = await readBody<{ owner: string; repo: string }>(event)

  const registry = await readImportsRegistry()
  const entry = findImport(registry, owner, repo)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Import not found' })
  }

  await removeClone(entry.localPath)
  registry.imports = registry.imports.filter(i => !(i.owner === owner && i.repo === repo))
  await writeImportsRegistry(registry)

  return { success: true }
})
```

---

## Task 8: Extend Skill Scanner

**Files:**
- Modify: `server/api/skills/index.get.ts:1-86`

- [ ] **Step 1: Add GitHub skill scanning after the plugin skills section**

In `server/api/skills/index.get.ts`, after the plugin scanning block (after line 83, before the return), add a third scanning section:

```typescript
  // 3. GitHub-imported skills
  const githubDir = resolveClaudePath('github')
  if (existsSync(githubDir)) {
    const { readImportsRegistry } = await import('../../utils/github')
    const registry = await readImportsRegistry()

    for (const entry of registry.imports) {
      if (!existsSync(entry.localPath)) continue

      // Walk the target path within the cloned repo
      const scanRoot = entry.targetPath
        ? join(entry.localPath, entry.targetPath)
        : entry.localPath

      if (!existsSync(scanRoot)) continue

      const walkForSkills = async (dir: string) => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const item of entries) {
          if (item.name.startsWith('.')) continue
          const fullPath = join(dir, item.name)
          if (item.isDirectory()) {
            // Check for SKILL.md in this directory
            const skillPath = join(fullPath, 'SKILL.md')
            if (existsSync(skillPath)) {
              const raw = await readFile(skillPath, 'utf-8')
              const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
              if (frontmatter.name && frontmatter.description) {
                // Only include if in selectedSkills (or all if empty)
                if (entry.selectedSkills.length === 0 || entry.selectedSkills.includes(item.name)) {
                  skills.push({
                    slug: item.name,
                    frontmatter: { name: item.name, ...frontmatter },
                    body,
                    filePath: skillPath,
                    source: 'github',
                    githubRepo: `${entry.owner}/${entry.repo}`,
                  })
                }
              }
            }
            // Recurse into subdirectories
            await walkForSkills(fullPath)
          }
        }
      }

      await walkForSkills(scanRoot)
    }
  }
```

Also add the `readdir` import at the top if not already present (it already is on line 1).

---

## Task 9: GitHub Imports Composable

**Files:**
- Create: `app/composables/useGithubImports.ts`

- [ ] **Step 1: Create the composable**

```typescript
import type { GithubImport, GithubImportsRegistry, ScanResult } from '~/types'

export function useGithubImports() {
  const imports = useState<GithubImport[]>('githubImports', () => [])
  const loading = useState('githubImportsLoading', () => false)
  const scanning = useState('githubImportsScanning', () => false)
  const updatesAvailable = useState('githubImportsUpdates', () => 0)

  async function fetchImports() {
    loading.value = true
    try {
      const data = await $fetch<GithubImportsRegistry>('/api/github/imports')
      imports.value = data.imports
    } catch (e) {
      console.error('Failed to fetch GitHub imports:', e)
    } finally {
      loading.value = false
    }
  }

  async function scan(url: string): Promise<ScanResult> {
    scanning.value = true
    try {
      return await $fetch<ScanResult>('/api/github/scan', {
        method: 'POST',
        body: { url },
      })
    } finally {
      scanning.value = false
    }
  }

  async function importRepo(params: {
    owner: string
    repo: string
    url: string
    targetPath: string
    selectedSkills: string[]
  }): Promise<GithubImport> {
    const entry = await $fetch<GithubImport>('/api/github/import', {
      method: 'POST',
      body: params,
    })
    imports.value.push(entry)
    return entry
  }

  async function checkUpdates() {
    try {
      const data = await $fetch<{ imports: GithubImport[]; updatesAvailable: number }>(
        '/api/github/check-updates',
        { method: 'POST' },
      )
      imports.value = data.imports
      updatesAvailable.value = data.updatesAvailable
    } catch {
      // Silently fail — cached state is fine
    }
  }

  async function updateImport(owner: string, repo: string): Promise<{ changedFiles: string[] }> {
    const data = await $fetch<{ entry: GithubImport; changedFiles: string[] }>(
      '/api/github/update',
      { method: 'POST', body: { owner, repo } },
    )
    const idx = imports.value.findIndex(i => i.owner === owner && i.repo === repo)
    if (idx !== -1) imports.value[idx] = data.entry
    updatesAvailable.value = imports.value.filter(i => i.currentSha !== i.remoteSha).length
    return { changedFiles: data.changedFiles }
  }

  async function removeImport(owner: string, repo: string) {
    await $fetch('/api/github/remove', {
      method: 'POST',
      body: { owner, repo },
    })
    imports.value = imports.value.filter(i => !(i.owner === owner && i.repo === repo))
    updatesAvailable.value = imports.value.filter(i => i.currentSha !== i.remoteSha).length
  }

  return {
    imports,
    loading,
    scanning,
    updatesAvailable,
    fetchImports,
    scan,
    importRepo,
    checkUpdates,
    updateImport,
    removeImport,
  }
}
```

---

## Task 10: ImportBadge Component

**Files:**
- Create: `app/components/ImportBadge.vue`

- [ ] **Step 1: Create the badge component**

```vue
<script setup lang="ts">
defineProps<{
  repo: string
}>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
    style="background: var(--badge-subtle-bg); color: var(--text-disabled);"
    :title="`Imported from github.com/${repo}`"
  >
    <svg class="size-2.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
    {{ repo.split('/')[1] }}
  </span>
</template>
```

---

## Task 11: ImportedRepoCard Component

**Files:**
- Create: `app/components/ImportedRepoCard.vue`

- [ ] **Step 1: Create the repo card component**

```vue
<script setup lang="ts">
import type { GithubImport } from '~/types'

const props = defineProps<{
  entry: GithubImport
}>()

const emit = defineEmits<{
  update: [owner: string, repo: string]
  remove: [owner: string, repo: string]
}>()

const hasUpdate = computed(() => props.entry.currentSha !== props.entry.remoteSha)

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div
    class="rounded-xl overflow-hidden bg-card"
  >
    <div class="p-4 space-y-3">
      <div class="flex items-center gap-2.5">
        <div
          class="size-8 rounded-lg flex items-center justify-center shrink-0"
          style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
        >
          <svg class="size-4 text-label" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium truncate">{{ entry.owner }}/{{ entry.repo }}</div>
          <span class="text-[10px] text-meta">{{ entry.selectedSkills.length }} skill{{ entry.selectedSkills.length === 1 ? '' : 's' }} selected</span>
        </div>
        <span
          v-if="hasUpdate"
          class="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style="background: rgba(59, 130, 246, 0.1); color: var(--info, #3b82f6);"
        >
          Update available
        </span>
      </div>

      <div class="flex items-center gap-3 text-[10px] text-meta font-mono">
        <span>Imported {{ formatDate(entry.importedAt) }}</span>
        <span>SHA {{ entry.currentSha.slice(0, 7) }}</span>
      </div>
    </div>

    <div class="px-4 py-3 flex items-center justify-between" style="border-top: 1px solid var(--border-subtle);">
      <a
        :href="entry.url"
        target="_blank"
        rel="noopener"
        class="text-[12px] text-meta hover:text-label transition-colors"
      >
        View on GitHub
      </a>
      <div class="flex items-center gap-2">
        <UButton
          v-if="hasUpdate"
          label="Update"
          icon="i-lucide-download"
          size="xs"
          variant="soft"
          @click="emit('update', entry.owner, entry.repo)"
        />
        <UButton
          label="Remove"
          icon="i-lucide-trash-2"
          size="xs"
          variant="ghost"
          color="error"
          @click="emit('remove', entry.owner, entry.repo)"
        />
      </div>
    </div>
  </div>
</template>
```

---

## Task 12: GithubImportModal Component

**Files:**
- Create: `app/components/GithubImportModal.vue`

- [ ] **Step 1: Create the import modal component**

```vue
<script setup lang="ts">
import type { ScanResult, ScannedSkill } from '~/types'

const emit = defineEmits<{
  imported: []
}>()

const { scan, importRepo, scanning } = useGithubImports()
const toast = useToast()

const step = ref<'url' | 'preview' | 'importing' | 'done'>('url')
const url = ref('')
const scanResult = ref<ScanResult | null>(null)
const selected = ref<Set<string>>(new Set())
const importing = ref(false)
const error = ref('')

async function doScan() {
  error.value = ''
  try {
    scanResult.value = await scan(url.value)
    // Select all by default
    selected.value = new Set(scanResult.value.skills.map(s => s.slug))
    step.value = 'preview'
  } catch (e: any) {
    error.value = e.data?.data?.message || e.data?.message || e.message || 'Failed to scan repository'
  }
}

function toggleSkill(slug: string) {
  if (selected.value.has(slug)) {
    selected.value.delete(slug)
  } else {
    selected.value.add(slug)
  }
  // Trigger reactivity
  selected.value = new Set(selected.value)
}

function toggleAll() {
  if (!scanResult.value) return
  if (selected.value.size === scanResult.value.skills.length) {
    selected.value = new Set()
  } else {
    selected.value = new Set(scanResult.value.skills.map(s => s.slug))
  }
}

async function doImport() {
  if (!scanResult.value || selected.value.size === 0) return
  importing.value = true
  step.value = 'importing'
  try {
    await importRepo({
      owner: scanResult.value.owner,
      repo: scanResult.value.repo,
      url: url.value,
      targetPath: scanResult.value.targetPath,
      selectedSkills: [...selected.value],
    })
    step.value = 'done'
    toast.add({ title: `Imported ${selected.value.size} skills from ${scanResult.value.owner}/${scanResult.value.repo}`, color: 'success' })
    emit('imported')
  } catch (e: any) {
    error.value = e.data?.data?.message || e.data?.message || e.message || 'Import failed'
    step.value = 'preview'
  } finally {
    importing.value = false
  }
}

function reset() {
  step.value = 'url'
  url.value = ''
  scanResult.value = null
  selected.value = new Set()
  error.value = ''
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay min-w-[480px]">
    <h3 class="text-page-title">Import from GitHub</h3>

    <!-- Step 1: URL input -->
    <template v-if="step === 'url'">
      <p class="text-[12px] text-label leading-relaxed">
        Paste a GitHub repository URL to scan for importable skills.
      </p>

      <div class="field-group">
        <label class="field-label">GitHub URL</label>
        <input
          v-model="url"
          class="field-input"
          placeholder="https://github.com/owner/repo"
          @keydown.enter="doScan"
        />
        <span class="field-hint">Supports repo URLs, subfolder URLs, and single file URLs</span>
      </div>

      <div
        v-if="error"
        class="rounded-lg px-3 py-2 text-[12px]"
        style="background: rgba(248, 113, 113, 0.06); color: var(--error); border: 1px solid rgba(248, 113, 113, 0.12);"
      >
        {{ error }}
      </div>

      <div class="flex justify-end gap-2">
        <UButton
          label="Scan"
          icon="i-lucide-search"
          size="sm"
          :loading="scanning"
          :disabled="!url.trim()"
          @click="doScan"
        />
      </div>
    </template>

    <!-- Step 2: Preview & select -->
    <template v-if="step === 'preview' && scanResult">
      <div class="flex items-center justify-between">
        <p class="text-[12px] text-label">
          Found <strong>{{ scanResult.skills.length }}</strong> skills in
          <span class="font-mono">{{ scanResult.owner }}/{{ scanResult.repo }}</span>
        </p>
        <button class="text-[12px] text-meta hover:text-label" @click="toggleAll">
          {{ selected.size === scanResult.skills.length ? 'Deselect all' : 'Select all' }}
        </button>
      </div>

      <div class="max-h-80 overflow-y-auto space-y-1 rounded-lg p-1" style="background: var(--surface-base);">
        <label
          v-for="skill in scanResult.skills"
          :key="skill.slug"
          class="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover-row"
        >
          <input
            type="checkbox"
            :checked="selected.has(skill.slug)"
            class="mt-0.5 shrink-0"
            @change="toggleSkill(skill.slug)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-medium truncate">{{ skill.name }}</span>
              <span
                v-if="skill.conflict"
                class="text-[9px] font-medium px-1.5 py-px rounded-full shrink-0"
                style="background: rgba(234, 179, 8, 0.1); color: var(--warning, #eab308);"
              >
                exists locally
              </span>
              <span
                v-if="skill.category"
                class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
              >
                {{ skill.category }}
              </span>
            </div>
            <p class="text-[11px] text-label mt-0.5 line-clamp-2">{{ skill.description }}</p>
          </div>
        </label>
      </div>

      <div
        v-if="error"
        class="rounded-lg px-3 py-2 text-[12px]"
        style="background: rgba(248, 113, 113, 0.06); color: var(--error); border: 1px solid rgba(248, 113, 113, 0.12);"
      >
        {{ error }}
      </div>

      <div class="flex justify-between">
        <UButton label="Back" variant="ghost" color="neutral" size="sm" @click="reset" />
        <UButton
          :label="`Import ${selected.size} skill${selected.size === 1 ? '' : 's'}`"
          icon="i-lucide-download"
          size="sm"
          :disabled="selected.size === 0"
          @click="doImport"
        />
      </div>
    </template>

    <!-- Step 3: Importing -->
    <template v-if="step === 'importing'">
      <div class="flex flex-col items-center py-8 space-y-3">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
        <p class="text-[13px] text-label">Cloning repository...</p>
      </div>
    </template>

    <!-- Step 4: Done -->
    <template v-if="step === 'done'">
      <div class="flex flex-col items-center py-6 space-y-3">
        <div
          class="size-12 rounded-full flex items-center justify-center"
          style="background: rgba(34, 197, 94, 0.1);"
        >
          <UIcon name="i-lucide-check" class="size-6" style="color: var(--success, #22c55e);" />
        </div>
        <p class="text-[13px] font-medium">Import complete</p>
        <p class="text-[12px] text-label">
          {{ selected.size }} skill{{ selected.size === 1 ? '' : 's' }} imported from
          <span class="font-mono">{{ scanResult?.owner }}/{{ scanResult?.repo }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
```

---

## Task 13: Explore Page — Add "Imported" Tab & Import Button

**Files:**
- Modify: `app/pages/explore.vue:1-357`

- [ ] **Step 1: Update the script section**

In `app/pages/explore.vue`, add the GitHub imports composable and update the tab type.

After line 9 (`const { plugins, ...`), add:

```typescript
const {
  imports: githubImports,
  loading: importsLoading,
  updatesAvailable,
  fetchImports,
  checkUpdates,
  updateImport,
  removeImport,
} = useGithubImports()
```

Change line 16 from:
```typescript
const activeTab = ref<'templates' | 'extensions'>(route.query.tab === 'extensions' ? 'extensions' : 'templates')
```
To:
```typescript
const activeTab = ref<'templates' | 'extensions' | 'imported'>(
  route.query.tab === 'extensions' ? 'extensions'
    : route.query.tab === 'imported' ? 'imported'
    : 'templates'
)
const showImportModal = ref(false)
```

Add after `onMounted(() => fetchPlugins())` (line 127):

```typescript
onMounted(async () => {
  await fetchImports()
  // Check for updates in background (non-blocking)
  checkUpdates()
})

async function onUpdate(owner: string, repo: string) {
  try {
    await updateImport(owner, repo)
    toast.add({ title: 'Import updated', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

async function onRemove(owner: string, repo: string) {
  try {
    await removeImport(owner, repo)
    toast.add({ title: 'Import removed', color: 'success' })
  } catch {
    toast.add({ title: 'Failed to remove', color: 'error' })
  }
}
```

- [ ] **Step 2: Update the template — add Import button to header**

Change the `<PageHeader>` trailing template (line 133-135) from:
```html
<template #trailing>
  <span class="text-[12px] text-meta">{{ agentTemplates.length + commandTemplates.length }} templates</span>
</template>
```
To:
```html
<template #trailing>
  <span class="text-[12px] text-meta">{{ agentTemplates.length + commandTemplates.length }} templates</span>
</template>
<template #right>
  <UButton label="Import from GitHub" icon="i-lucide-github" size="sm" variant="soft" @click="showImportModal = true" />
</template>
```

- [ ] **Step 3: Add the "Imported" tab button**

After the Extensions tab button (after line 162), add:

```html
<button
  class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
  :style="{
    background: activeTab === 'imported' ? 'var(--surface-base)' : 'transparent',
    color: activeTab === 'imported' ? 'var(--text-primary)' : 'var(--text-tertiary)',
    boxShadow: activeTab === 'imported' ? '0 1px 3px var(--card-shadow)' : 'none',
  }"
  @click="activeTab = 'imported'"
>
  Imported ({{ githubImports.length }})
  <span
    v-if="updatesAvailable > 0"
    class="ml-1 inline-flex items-center justify-center size-4 rounded-full text-[9px] font-bold text-white"
    style="background: var(--info, #3b82f6);"
  >
    {{ updatesAvailable }}
  </span>
</button>
```

- [ ] **Step 4: Add the Imported tab content**

After the Extensions tab `</template>` (after line 353), add:

```html
<!-- Imported Tab -->
<template v-if="activeTab === 'imported'">
  <p class="text-[13px] leading-relaxed text-label">
    Skills imported from GitHub repositories. Updates are checked automatically.
  </p>

  <div v-if="importsLoading" class="space-y-1">
    <SkeletonRow v-for="i in 3" :key="i" />
  </div>

  <div v-else-if="githubImports.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <ImportedRepoCard
      v-for="entry in githubImports"
      :key="`${entry.owner}/${entry.repo}`"
      :entry="entry"
      @update="onUpdate"
      @remove="onRemove"
    />
  </div>

  <div v-else class="text-center py-12 space-y-4">
    <div class="size-12 mx-auto rounded-full flex items-center justify-center" style="background: var(--badge-subtle-bg);">
      <svg class="size-6 text-meta" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </div>
    <p class="text-[13px] text-label">No GitHub imports yet. Use the button above to import skills from a repository.</p>
  </div>
</template>
```

- [ ] **Step 5: Add the modal at the bottom of the template**

Before the closing `</div>` of the root element, add:

```html
<UModal v-model:open="showImportModal">
  <template #content>
    <GithubImportModal @imported="showImportModal = false; fetchImports()" />
  </template>
</UModal>
```

---

## Task 14: Skills List Page — Show Import Badges

**Files:**
- Modify: `app/pages/skills/index.vue:60-103`

- [ ] **Step 1: Add ImportBadge to skill list items**

In `app/pages/skills/index.vue`, inside the skill list NuxtLink (between the agent badge and description spans), add the GitHub badge after line 89:

```html
<!-- GitHub badge -->
<ImportBadge
  v-if="skill.source === 'github' && skill.githubRepo"
  :repo="skill.githubRepo"
/>
```

---

## Task 15: Skill Editor — Read-Only Mode for Imported Skills

**Files:**
- Modify: `app/pages/skills/[slug].vue:1-303`

- [ ] **Step 1: Add read-only detection and "Edit a copy" function**

In the script section, after line 10 (`const slug = ...`), add:

```typescript
const isImported = computed(() => skill.value?.source === 'github')
```

Add a function after `deleteSkill` (after line 83):

```typescript
async function editCopy() {
  if (!skill.value) return
  const { create } = useSkills()
  try {
    const copy = await create({
      frontmatter: { ...skill.value.frontmatter, name: skill.value.frontmatter.name + ' (copy)' },
      body: skill.value.body,
    })
    toast.add({ title: 'Copy created', color: 'success' })
    router.push(`/skills/${copy.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create copy', description: e.data?.message || e.message, color: 'error' })
  }
}
```

- [ ] **Step 2: Add read-only banner and conditional UI**

After the draft recovery banner (after line 165), add:

```html
<!-- Read-only banner for imported skills -->
<div
  v-if="isImported"
  class="rounded-xl px-4 py-3 flex items-center gap-3"
  style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
>
  <svg class="size-4 shrink-0 text-label" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
  <span class="text-[12px] flex-1 text-label">
    This skill is imported from GitHub and is read-only. Updates from the source may overwrite local changes.
  </span>
  <UButton label="Edit a copy" size="xs" variant="soft" @click="editCopy" />
</div>
```

- [ ] **Step 3: Disable editing for imported skills**

Add `:disabled="isImported"` to the form inputs and textarea:
- Line 215 input: `<input v-model="frontmatter.name" class="field-input" :disabled="isImported" />`
- Line 220 input: `<input v-model="frontmatter.context" ... :disabled="isImported" />`
- Line 225 input: `<input v-model="frontmatter.agent" ... :disabled="isImported" />`
- Line 240 textarea: `<textarea v-model="frontmatter.description" ... :disabled="isImported" />`
- Line 262 textarea: `<textarea v-model="body" ... :disabled="isImported" />`

Also hide the Save and Delete buttons when imported. Change the `#right` template (lines 124-149) to wrap Save/Delete in `v-if="!isImported"`:

```html
<template #right>
  <UButton
    label="Use"
    icon="i-lucide-play"
    size="sm"
    variant="soft"
    :disabled="!skill"
    @click="prefillSkill(skill!.frontmatter.name)"
  />
  <a
    :href="`/api/skills/${slug}/export`"
    download
    class="text-[12px] px-2 py-1 rounded focus-ring text-label hover-bg"
    title="Download .md file"
  >
    <UIcon name="i-lucide-download" class="size-3.5" />
  </a>
  <template v-if="!isImported">
    <button
      class="text-[12px] px-2 py-1 rounded focus-ring text-label"
      @click="showDeleteConfirm = true"
    >
      Delete
    </button>
    <span v-if="isDirty" class="text-[10px] font-mono unsaved-pulse" style="color: var(--warning);">unsaved</span>
    <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
  </template>
  <UButton v-else label="Edit a copy" icon="i-lucide-copy" size="sm" @click="editCopy" />
</template>
```

---

## Task 16: Dashboard — Show Imported Count

**Files:**
- Modify: `app/pages/index.vue:8,147-176`

- [ ] **Step 1: Add GitHub imports data to dashboard**

In `app/pages/index.vue`, after line 8 (`const { skills, fetchAll: fetchSkills } = useSkills()`), add:

```typescript
const { imports: githubImports, fetchImports } = useGithubImports()
```

In `onMounted`, add `fetchImports()` to the `Promise.all` on line 49:

```typescript
await Promise.all([loadSettings(), fetchPlugins(), fetchSkills(), fetchImports()])
```

- [ ] **Step 2: Update the skills stat label to show imported count**

This is a simple display tweak. Change the skills entry in `statItems` (lines 162-168) to include a computed label:

After the `statItems` computed (after line 176), add:

```typescript
const importedSkillCount = computed(() => githubImports.value.reduce((sum, i) => sum + i.selectedSkills.length, 0))
```

In the template, the stat card for skills already shows `item.count` which comes from `animatedCounts.skills`. Since imported skills are now included in the skills API response, the count will naturally include them. No template change needed — the count updates automatically.

---

## Task 17: Settings Page — GitHub Imports Management

**Files:**
- Modify: `app/pages/settings.vue`

- [ ] **Step 1: Add GitHub imports section to settings**

In the script section, after line 4 (`const { settings, ... } = useSettings()`), add:

```typescript
const {
  imports: githubImports,
  loading: importsLoading,
  fetchImports: fetchGithubImports,
  checkUpdates,
  updateImport,
  removeImport,
} = useGithubImports()
```

Add to `onMounted` (after line 13):

```typescript
onMounted(async () => {
  await fetchGithubImports()
})
```

Add handler functions (after `removePlugin` function, line 55):

```typescript
async function onUpdateImport(owner: string, repo: string) {
  try {
    await updateImport(owner, repo)
    toast.add({ title: 'Import updated', color: 'success' })
  } catch {
    toast.add({ title: 'Update failed', color: 'error' })
  }
}

async function onRemoveImport(owner: string, repo: string) {
  try {
    await removeImport(owner, repo)
    toast.add({ title: 'Import removed', color: 'success' })
  } catch {
    toast.add({ title: 'Remove failed', color: 'error' })
  }
}

async function onCheckUpdates() {
  try {
    await checkUpdates()
    toast.add({ title: 'Update check complete', color: 'success' })
  } catch {
    toast.add({ title: 'Update check failed', color: 'error' })
  }
}
```

- [ ] **Step 2: Add the GitHub Imports section in the template**

After the Extensions section (after line 307), add:

```html
<!-- GitHub Imports -->
<div class="rounded-xl p-5 space-y-4 bg-card">
  <div class="flex items-center justify-between">
    <h3 class="text-section-title">GitHub Imports</h3>
    <UButton
      v-if="githubImports.length > 0"
      label="Check for updates"
      icon="i-lucide-refresh-cw"
      size="xs"
      variant="soft"
      @click="onCheckUpdates"
    />
  </div>
  <p class="text-[12px] text-meta">
    Manage skill repositories imported from GitHub.
  </p>

  <div v-if="githubImports.length === 0" class="text-[13px] text-label">
    No GitHub imports. Use the Explore page to import skills from GitHub.
  </div>

  <div v-else class="space-y-2">
    <div
      v-for="entry in githubImports"
      :key="`${entry.owner}/${entry.repo}`"
      class="flex items-center justify-between py-2 px-3 rounded-lg"
      style="background: var(--input-bg);"
    >
      <div class="flex-1 min-w-0">
        <span class="font-mono text-[12px] text-body">{{ entry.owner }}/{{ entry.repo }}</span>
        <span class="text-[10px] text-meta ml-2">{{ entry.selectedSkills.length }} skills</span>
      </div>
      <div class="flex items-center gap-2">
        <span
          v-if="entry.currentSha !== entry.remoteSha"
          class="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style="background: rgba(59, 130, 246, 0.1); color: var(--info, #3b82f6);"
        >
          Update available
        </span>
        <UButton
          v-if="entry.currentSha !== entry.remoteSha"
          label="Update"
          size="xs"
          variant="soft"
          @click="onUpdateImport(entry.owner, entry.repo)"
        />
        <button
          class="p-1.5 -m-0.5 rounded focus-ring text-meta"
          aria-label="Remove import"
          @click="onRemoveImport(entry.owner, entry.repo)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</div>
```

---

## Task 18: Verify Build & Manual Test

- [ ] **Step 1: Verify the app builds**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && bun run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 2: Start dev server and verify pages load**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && bun run dev`

Manually verify:
1. Dashboard loads, skill count shows
2. Skills list page loads
3. Explore page loads with all 3 tabs (Templates, Extensions, Imported)
4. Import from GitHub button opens the modal
5. Settings page shows GitHub Imports section

- [ ] **Step 3: Test the full import flow**

1. Go to Explore page → click "Import from GitHub"
2. Paste: `https://github.com/elliottrjacobs/skills-gtm`
3. Verify skills are detected and shown in preview
4. Select some skills → click Import
5. Verify the repo clones and skills appear in the Skills list
6. Verify imported skills show the GitHub badge
7. Verify imported skills open in read-only mode
8. Verify "Edit a copy" creates a local editable copy
9. Go to Settings → verify GitHub Imports section shows the import
10. Click "Remove" → verify cleanup works
