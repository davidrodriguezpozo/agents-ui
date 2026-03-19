# Marketplace & Plugin Discovery — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Feature 7 of the agents-ui roadmap (Marketplace)

## Overview

Enhance the Extensions tab on the Explore page to show available (uninstalled) plugins from all registered Claude Code marketplaces, allow one-click installation, and manage marketplace sources — all from the UI. Mutating operations delegate to the `claude` CLI for compatibility.

## Goals

- Browse all available plugins across registered marketplaces
- Install/uninstall plugins from the UI without touching the terminal
- Manage marketplace sources (add, remove, update)
- Reflect the same data and operations as `claude plugin` CLI commands

## Non-Goals

- Plugin versioning or rollback
- Plugin ratings or reviews
- Custom marketplace registry format (we read what's on disk)
- Replacing or reimplementing CLI internals (we shell out to `claude`)

---

## Enhanced Extensions Tab Layout

The Extensions tab on the Explore page gets three sections:

### 1. Installed Plugins (top)
- Existing UI: enable/disable toggles, grouped by marketplace
- New: "Uninstall" button per plugin (calls `claude plugin remove <name>`)
- After uninstall, plugin moves to the "Available" section

### 2. Available Plugins (middle)
- All plugins from registered marketplaces that are NOT currently installed
- Grouped by marketplace name
- Each plugin shows: name, description, skill count, command count
- "Install" button per plugin (calls `claude plugin add <marketplace>/<name>`)
- Loading state during install, refresh after completion
- After install, plugin moves to the "Installed" section

### 3. Marketplace Sources (bottom, collapsible `<details>`)
- Lists registered marketplaces from `known_marketplaces.json`
- Each shows: name, source type (git/github/directory), last updated date
- "Update" button per source (calls `claude plugin marketplace update <name>`)
- "Remove" button per source (calls `claude plugin marketplace remove <name>`)
- "Add marketplace" button opens a modal with URL input

---

## Available Plugin Detection

For each marketplace in `known_marketplaces.json`:

1. Read `installLocation` to find the local directory
2. Walk `<installLocation>/plugins/` for subdirectories
3. For each subdirectory with `.claude-plugin/plugin.json`, read metadata:
   - `name`, `description`, `author` from `plugin.json`
   - Count subdirectories in `skills/` if it exists
   - Count subdirectories in `commands/` if it exists
4. Cross-reference with `installed_plugins.json` to determine installed status
5. Return unified list grouped by marketplace

### `known_marketplaces.json` format (read-only):
```json
{
  "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
    "installLocation": "/path/to/marketplaces/claude-plugins-official",
    "lastUpdated": "2026-03-19T14:44:22.406Z"
  }
}
```

### `plugin.json` format (per plugin):
```json
{
  "name": "code-review",
  "description": "Automated code review for pull requests",
  "author": { "name": "Anthropic", "email": "support@anthropic.com" }
}
```

---

## CLI Integration

All mutating operations shell out to the `claude` CLI via `execFile`:

| Operation | Command |
|-----------|---------|
| Install plugin | `claude plugin add <marketplace>/<plugin-name>` |
| Uninstall plugin | `claude plugin remove <plugin-name>` |
| Add marketplace | `claude plugin marketplace add <url>` |
| Remove marketplace | `claude plugin marketplace remove <name>` |
| Update marketplace | `claude plugin marketplace update <name>` |

**Error handling:**
- Capture stdout and stderr from CLI
- If exit code is non-zero, return stderr as error message to the client
- Timeout of 120 seconds for install operations (cloning may be slow)
- Check that `claude` CLI is available before attempting operations

**After each mutating operation:**
- Re-read filesystem state (`installed_plugins.json`, marketplace directories)
- Return fresh data to the client so UI updates immediately

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/marketplace/available` | GET | List all available plugins from all marketplaces with installed status |
| `/api/marketplace/install` | POST | Install a plugin via CLI. Body: `{ marketplace: string, plugin: string }` |
| `/api/marketplace/uninstall` | POST | Uninstall a plugin via CLI. Body: `{ plugin: string }` |
| `/api/marketplace/sources` | GET | List registered marketplace sources |
| `/api/marketplace/sources/add` | POST | Add a marketplace via CLI. Body: `{ url: string }` |
| `/api/marketplace/sources/remove` | POST | Remove a marketplace via CLI. Body: `{ name: string }` |
| `/api/marketplace/sources/update` | POST | Update a marketplace via CLI. Body: `{ name: string }` |

### Response shapes:

**GET `/api/marketplace/available`:**
```json
{
  "marketplaces": {
    "claude-plugins-official": {
      "plugins": [
        {
          "name": "code-review",
          "description": "Automated code review...",
          "author": { "name": "Anthropic" },
          "skillCount": 2,
          "commandCount": 1,
          "installed": true
        }
      ]
    }
  }
}
```

**GET `/api/marketplace/sources`:**
```json
{
  "sources": [
    {
      "name": "claude-plugins-official",
      "sourceType": "github",
      "sourceUrl": "anthropics/claude-plugins-official",
      "lastUpdated": "2026-03-19T14:44:22.406Z"
    }
  ]
}
```

**POST (mutating) responses:**
```json
{ "success": true, "output": "Plugin installed successfully" }
{ "success": false, "error": "Plugin not found in marketplace" }
```

---

## Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `server/utils/marketplace.ts` | Scan marketplace directories, read plugin metadata, read known_marketplaces.json |
| `server/utils/cli.ts` | Wrapper for shelling out to `claude` CLI with timeout, error capture |
| `server/api/marketplace/available.get.ts` | List available plugins |
| `server/api/marketplace/install.post.ts` | Install via CLI |
| `server/api/marketplace/uninstall.post.ts` | Uninstall via CLI |
| `server/api/marketplace/sources/index.get.ts` | List marketplace sources |
| `server/api/marketplace/sources/add.post.ts` | Add source via CLI |
| `server/api/marketplace/sources/remove.post.ts` | Remove source via CLI |
| `server/api/marketplace/sources/update.post.ts` | Update source via CLI |
| `app/composables/useMarketplace.ts` | Client state for available plugins and marketplace sources |
| `app/components/AvailablePluginCard.vue` | Available plugin with Install button |
| `app/components/MarketplaceSourceRow.vue` | Marketplace source with update/remove |
| `app/components/AddMarketplaceModal.vue` | Modal to add a marketplace URL |

### Modified Files

| File | Change |
|------|--------|
| `app/types/index.ts` | Add `AvailablePlugin`, `MarketplaceSource`, `MarketplaceData` types |
| `app/pages/explore.vue` | Rewrite Extensions tab with three sections |
| `app/composables/usePlugins.ts` | Add `uninstall` method |

### No Breaking Changes
- Existing plugin enable/disable functionality unchanged
- Existing plugin detail page (`/plugins/[id]`) unchanged
- Marketplace data is read-only from the filesystem; CLI handles all mutations

---

## Error Handling

| Error Case | Behavior |
|------------|----------|
| `claude` CLI not found | Show clear error: "Claude Code CLI is required. Install it from claude.ai" |
| CLI command fails (non-zero exit) | Show stderr output as error toast |
| Marketplace directory missing on disk | Skip that marketplace, show warning badge |
| `plugin.json` missing or malformed | Skip that plugin entry |
| Install timeout (>120s) | Show timeout error, suggest retrying |
| No marketplaces registered | Show empty state with instructions to add one |
