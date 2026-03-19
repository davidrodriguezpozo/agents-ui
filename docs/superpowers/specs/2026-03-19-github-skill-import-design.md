# GitHub Skill Import — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Feature 1 of the agents-ui roadmap (Interleaved Ecosystem + Intelligence approach)

## Overview

Allow users to import skills from GitHub repositories by pasting a URL. The system auto-detects valid skill files, presents a preview for selective import, clones the repo into `~/.claude/github/`, and tracks imports for update notifications.

This is the foundation for community skill sharing — designed to handle skills now, with architecture that supports expanding to agents, commands, and workflows later.

## Goals

- Zero-friction import: paste a URL, pick skills, done
- Handle diverse repo structures (flat folders, nested categories, with or without manifests)
- Keep imported content updatable via git
- Minimal changes to existing code — bounded modifications to the skill scanner and UI only where necessary

## Non-Goals

- Marketplace / discovery UI (future feature)
- Publishing skills to GitHub from the app
- Agent, command, or workflow import (future expansion)
- Authentication for private repos (initial version uses public repos only)

---

## Import Flow

1. User clicks "Import from GitHub" (available on Explore page header)
2. Modal opens with a URL input field
3. User pastes a GitHub URL — supported formats:
   - `https://github.com/owner/repo` — scan whole repo
   - `https://github.com/owner/repo/tree/main/skills/some-folder` — scan subfolder
   - Single `.md` file URL — direct import
4. App calls `POST /api/github/scan` which uses the GitHub API to scan the target
5. Modal shows a preview list with checkboxes:
   - Skill name and description (from frontmatter)
   - Category/tags (from `skills-index.json` or inferred from folder path)
   - File path within the repo
   - Whether it has supporting files (references, meta.json, etc.)
   - Conflict warnings if a skill with the same slug exists locally
6. User selects skills and clicks "Import"
7. Server clones the full repo into `~/.claude/github/<owner>/<repo>/` (selection controls tracking, not what's on disk — the full repo is always cloned so `git pull` works correctly)
8. Success state shows imported skills with links to view them

## Skill Detection

**`skills-index.json` lookup:**
- First check at the repo root, regardless of what URL path was provided
- If found, use it as source of truth (covers goose-skills style repos with categories, tags, and metadata)
- Filter entries to only those within the target subfolder if a subfolder URL was provided

**Frontmatter heuristic fallback:**
- Recursively scan the target path for `.md` files (including `SKILL.md`) with YAML frontmatter containing at least `name` and `description` fields
- Skip common non-skill markdown by filename: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE.md`

**Slug derivation:**
- The slug is the parent folder name of the skill file (e.g., `skills/gtm-icp/SKILL.md` → slug `gtm-icp`)
- For single-file skills without a dedicated folder, the slug is the filename without extension (e.g., `my-skill.md` → slug `my-skill`)

## Scan API Contract

**`POST /api/github/scan`**

Request:
```json
{
  "url": "https://github.com/owner/repo/tree/main/skills"
}
```

Response:
```json
{
  "owner": "elliottrjacobs",
  "repo": "skills-gtm",
  "branch": "main",
  "targetPath": "skills",
  "skills": [
    {
      "slug": "gtm-icp",
      "name": "gtm-icp",
      "description": "Build deep ICP and buyer persona profiles...",
      "category": null,
      "tags": [],
      "filePath": "skills/gtm-icp/SKILL.md",
      "hasSupporting": true,
      "conflict": false
    }
  ],
  "detectionMethod": "frontmatter" | "skills-index"
}
```

Error responses:
```json
{ "error": "invalid_url", "message": "Could not parse GitHub URL" }
{ "error": "not_found", "message": "Repository or path not found" }
{ "error": "rate_limited", "message": "GitHub API rate limit reached. Try again in X minutes or configure a token in Settings." }
{ "error": "no_skills", "message": "No valid skill files found at this location" }
```

## Storage

**Cloned repos:**
- Stored at `<claudeDir>/github/<owner>/<repo>/` (absolute path resolved via `resolveClaudePath()` — never stored with `~` notation)
- Full repo clone always (not sparse-checkout) — simplifies updates and avoids partial state
- Skills from these directories are not automatically discovered by the existing scanner — the scanner must be extended (see Required Modifications below)

**Import registry:**
- `<claudeDir>/github/imports.json` tracks all imported repos:

```json
{
  "imports": [
    {
      "owner": "elliottrjacobs",
      "repo": "skills-gtm",
      "url": "https://github.com/elliottrjacobs/skills-gtm",
      "targetPath": "skills",
      "localPath": "/Users/name/.claude/github/elliottrjacobs/skills-gtm",
      "importedAt": "2026-03-19T10:00:00Z",
      "lastChecked": "2026-03-19T10:00:00Z",
      "currentSha": "abc123def456",
      "remoteSha": "abc123def456",
      "selectedSkills": ["gtm-icp", "gtm-pricing"]
    }
  ]
}
```

## Conflict Handling

- If a skill with the same slug already exists locally, the preview shows a warning icon
- Options: **skip** (don't import this skill) or **overwrite** (replace the local version)
- Imported skills carry source metadata in the registry for traceability

## Update Mechanism

**Detection:**
- Runs in the background (non-blocking) on app load and when the user visits the Imported tab
- Server runs `git ls-remote` for each import to compare remote HEAD with stored SHA
- Results cached in `imports.json` (`lastChecked`, `remoteSha` fields)
- If the network call fails (offline, timeout), silently use cached state

**Notification:**
- If remote SHA differs from current SHA, a badge appears:
  - On the Explore page "Imported" tab
  - Next to the specific import entry
- Badge shows number of imports with available updates

**Update action:**
- User clicks "Update available" on an import
- Server runs `git diff --name-only <currentSha>..HEAD` in the cloned repo to show changed skill files
- User confirms, server runs `git pull`, updates `currentSha` in `imports.json`

**Uninstall:**
- Check if user has created local copies via "Edit a copy" (copies live in `<claudeDir>/skills/`, so they're safe)
- Remove the cloned directory and the entry from `imports.json`

---

## UI Integration

### Explore Page
- New **"Imported" tab** alongside Templates and Extensions
- Shows all GitHub imports grouped by repo, with update status badges
- "Import from GitHub" button in the page header (visible from any tab)

### Skills List Page
- Imported skills appear alongside local ones
- Small GitHub icon badge indicates imported source (determined by checking if `filePath` is under `<claudeDir>/github/`)
- Hover shows the source repo URL
- Imported skills open in **read-only mode** (local edits would be overwritten on update)
- "Edit a copy" option duplicates the skill into `<claudeDir>/skills/<slug>/` (user space)

### Dashboard
- Import count included in stats (e.g., "12 skills (4 imported)")

### Settings Page
- New section: "GitHub Imports"
- List all imports, check for updates in bulk, manage/remove
- Optional: GitHub personal access token input for higher API rate limits on public repos

---

## Architecture

### New API Endpoints

| Endpoint | Method | Nitro File | Purpose |
|----------|--------|------------|---------|
| `/api/github/scan` | POST | `server/api/github/scan.post.ts` | Takes a GitHub URL, returns detected skills |
| `/api/github/import` | POST | `server/api/github/import.post.ts` | Clones repo, writes registry, returns imported skills |
| `/api/github/imports` | GET | `server/api/github/imports.get.ts` | Returns all imports with update status |
| `/api/github/check-updates` | POST | `server/api/github/check-updates.post.ts` | Runs `git ls-remote` against all imports |
| `/api/github/update` | POST | `server/api/github/update.post.ts` | Runs `git pull` on a specific import (owner/repo in body) |
| `/api/github/remove` | POST | `server/api/github/remove.post.ts` | Removes clone and registry entry (owner/repo in body) |

### New Composable
- `useGithubImports()` — wraps API calls, manages import state, provides reactive update badges

### New Server Utilities
- `server/utils/github.ts` — URL parsing, GitHub API scanning, `skills-index.json` detection, frontmatter validation
- `server/utils/gitOps.ts` — clone, pull, ls-remote, diff operations (wraps `git` CLI via `execa`)

### New Components
- `GithubImportModal.vue` — URL input, preview list with checkboxes, import action
- `ImportedRepoCard.vue` — repo info, skill count, update status badge
- `ImportBadge.vue` — small GitHub icon for skill list items

### Required Modifications to Existing Code

These are bounded, intentional changes:

1. **`server/api/skills/index.get.ts`** — extend the skill scanner to also walk `<claudeDir>/github/` directories, collecting skills from imported repos. Tag these skills with `source: 'github'` in the response.
2. **`app/types/index.ts`** — add optional `source?: 'local' | 'github' | 'plugin'` field to the `Skill` type
3. **`app/pages/skills/[slug].vue`** — check `source` field; if `'github'`, render editor as read-only with "Edit a copy" button
4. **`app/pages/explore.vue`** — add "Imported" to the tab union type and render the new tab content
5. **`app/pages/index.vue`** (Dashboard) — include imported count in skill stats

---

## Error Handling

| Error Case | Behavior |
|------------|----------|
| `git` not installed | Check on first import attempt. Show clear error: "Git is required for GitHub imports. Install it from git-scm.com" |
| GitHub API rate limit (60 req/hr unauthenticated) | Show error with time until reset. Suggest configuring a token in Settings. |
| Concurrent import of same repo | Lock on `owner/repo` key — second request returns "Import already in progress" |
| Clone fails mid-way | Clean up partial directory before returning error. Don't write to `imports.json`. |
| `imports.json` write fails after successful clone | Remove cloned directory (rollback). Return error to user. |
| Network offline during update check | Silently use cached state. No error shown. |
| Repo deleted or made private after import | Update check fails gracefully. Show "Repository unavailable" status on the import card. |

---

## Future Expansion

This architecture is designed to expand to full bundle imports (agents, commands, workflows) by:
1. Extending the detection heuristics in `github.ts` to recognize other entity types
2. Adding entity type to the preview UI (checkbox groups per type)
3. No storage changes needed — everything already goes into `<claudeDir>/github/`

---

## Reference Repos

These repos informed the detection design:
- [athina-ai/goose-skills](https://github.com/athina-ai/goose-skills) — has `skills-index.json`, nested categories, `SKILL.md` + `skill.meta.json` per skill
- [elliottrjacobs/skills-gtm](https://github.com/elliottrjacobs/skills-gtm) — flat `skills/` folder, `SKILL.md` with YAML frontmatter, optional `references/` subfolder
