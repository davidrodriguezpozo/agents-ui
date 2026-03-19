# Agent Studio & Foundation Cleanup

**Date:** 2026-03-19
**Status:** Draft

## Overview

Transform agents-ui from a configuration manager into an integrated Agent Studio — a workspace where users build, test, and observe their Claude Code agents in one view. Pair this with targeted tech debt cleanup to create a solid foundation.

## Goals

- Eliminate the build-save-navigate-test loop: users test agents live as they edit
- Progressive disclosure: beginners get guidance, power users get the full studio
- Reduce codebase complexity by breaking oversized files and eliminating duplication
- Add observability: see what your agent did (tool calls, thinking, token usage)
- Bring all pages to a consistent quality standard

## Non-Goals

- CLI orchestration (spawning `claude` processes) — keep using Claude API directly for now
- Plugin marketplace backend — out of scope
- Multi-user collaboration or auth

---

## Phase 1: Foundation Cleanup

### 1.1 Generic CRUD Composable

Replace the 3 near-identical composables (`useAgents`, `useCommands`, `useSkills`) with a generic `useCrud<T>()`. `usePlugins` is excluded — its interface is fundamentally different (id-based, no create/update, uses `toggleEnabled`/`updateSkill` instead).

```typescript
// composables/useCrud.ts
export function useCrud<T extends { slug: string }>(
  basePath: string,
  opts: { stateKey: string }
) {
  // stateKey preserves existing useState keys to avoid breaking hydration
  const items = useState<T[]>(opts.stateKey, () => [])
  const loading = useState(`${opts.stateKey}Loading`, () => false)
  const error = useState<string | null>(`${opts.stateKey}Error`, () => null)

  async function fetchAll() { /* ... */ }
  async function fetchOne(slug: string): Promise<T> { /* ... */ }
  async function create(payload: unknown): Promise<T> { /* ... */ }
  async function update(slug: string, payload: unknown): Promise<T> { /* ... */ }
  async function remove(slug: string) { /* ... */ }

  return { items, loading, error, fetchAll, fetchOne, create, update, remove }
}
```

Existing composables become thin wrappers, **preserving their original `useState` keys**:
- `useAgents` — calls `useCrud<Agent>('/api/agents', { stateKey: 'agents' })`, no extra logic
- `useCommands` — calls `useCrud<Command>('/api/commands', { stateKey: 'commands' })`, adds `getCommandsForAgent()` and `groupedByDirectory` computed
- `useSkills` — calls `useCrud<Skill>('/api/skills', { stateKey: 'skills' })`, no extra logic
- `useWorkflows` — calls `useCrud<Workflow>('/api/workflows', { stateKey: 'workflows' })`, no extra logic (same slug-based CRUD shape)
- `usePlugins` — **not refactored** (different interface: id-based, no create/update, has `toggleEnabled`/`updateSkill`)

### 1.2 Remove templates.vue

`pages/templates.vue` (362 lines) is 98% identical to `pages/explore.vue` (356 lines). Delete `templates.vue`, update the nav link in `app.vue` to point to `/explore` (or remove it if Explore already has its own nav entry), and add a route redirect from `/templates` to `/explore` in `nuxt.config.ts` for bookmark/external link compatibility.

### 1.3 Type Consolidation

Move types currently defined inline in composables and pages into `app/types/index.ts`, organized by domain:

- `ChatMessage`, `StreamActivity` (from `useChat.ts`)
- `Suggestion` (from `pages/index.vue`)

Organize `types/index.ts` with clear section comments: Agents, Commands, Skills, Plugins, Workflows, Chat, UI.

### 1.4 Targeted CSS Modularization

Keep in `main.css`:
- CSS custom properties (design tokens)
- Global resets and base typography
- Shared utility classes

Move into `<style scoped>` as components are rebuilt:
- Chat styles (`.chat-*`) → chat sub-components
- Graph styles (`.graph-*`) → `graph.vue`
- Editor styles (`.editor-*`) → studio components
- Form styles (`.field-*`, `.pill-picker`, `.color-picker`) → respective components

---

## Phase 2: Agent Studio

### 2.1 Studio Layout

Redesign `pages/agents/[slug].vue` from a 1008-line monolith into a slim layout shell (~100 lines) that composes panel components.

**Layout structure:**
```
+---------------------------+------------------+
|                           |                  |
|     Editor Panel          |   Test Panel     |
|     (left, ~60%)          |   (right, ~40%) |
|                           |                  |
|  [Instructions] [Settings]|   Live chat      |
|  [Skills]                 |   with agent     |
|                           |                  |
+---------------------------+------------------+
|  Execution Inspector (collapsible)           |
|  Tool calls | Thinking | Tokens             |
+----------------------------------------------+
```

The right panel is collapsible on smaller screens. The bottom panel is collapsed by default.

### 2.2 ChatPanel Decomposition

Break `ChatPanel.vue` (704 lines) into focused sub-components:

| Component | Responsibility | Approx Lines |
|-----------|---------------|-------------|
| `chat/ChatMessage.vue` | Single message bubble, markdown rendering | ~80 |
| `chat/ChatInput.vue` | Textarea, auto-resize, send, keyboard shortcuts | ~60 |
| `chat/StreamIndicator.vue` | Thinking/tool/writing status with animations | ~50 |
| `chat/QuickActions.vue` | Suggestion chips grid | ~40 |
| `ChatPanel.vue` | Orchestrator composing the above, global chat | ~120 |

### 2.3 Studio Components

New components in `components/studio/`:

**`EditorPanel.vue`** — Tabbed container for Instructions, Settings, Skills tabs. Manages tab state, emits changes upward.

**`InstructionEditor.vue`** — The instruction textarea with:
- Line numbers
- "Improve with Claude" button (calls `/api/agents/improve-instructions`)
- Real-time character/word count
- Beginner hints (collapsible tips about writing good instructions)

**`TestPanel.vue`** — Studio-specific chat that:
- Uses shared `chat/*` sub-components
- Has its own isolated state via `useStudioChat()` composable (separate `useState` keys: `studio-chat-messages`, `studio-chat-streaming`, etc.) — completely independent from the global `useChat()` used by `ChatPanel`
- Sends current (possibly unsaved) instructions as the system prompt
- Shows "Draft mode" indicator when instructions differ from saved version
- Feeds conversation data to the execution inspector
- The global ChatPanel slide-over remains functional while the studio is open — they are independent sessions

**`ExecutionInspector.vue`** — Collapsible bottom panel showing:
- Tool calls as expandable cards (name, duration, status). **Note:** The current `claude-agent-sdk` stream only emits `toolName` and `elapsed_time_seconds` — no tool inputs/outputs. Phase 2 shows tool name + elapsed time only. Phase 3 enhances the chat backend to capture `tool_use`/`tool_result` content blocks from the SDK message stream for full input/output display. If SDK limitations prevent this, the inspector gracefully degrades to name + timing.
- Thinking blocks (collapsible)
- Token usage summary (input/output/total)
- Timing information

### 2.4 Instruction Assistant

New endpoint: `POST /api/agents/improve-instructions`

**Request:**
```json
{
  "name": "My Agent",
  "description": "Helps with code review",
  "currentInstructions": "You are a code reviewer..."
}
```

**Response:**
```json
{
  "suggestions": [
    {
      "type": "specificity",
      "description": "Add concrete examples of what to look for",
      "original": "Review the code carefully",
      "suggested": "Review for: unused variables, missing error handling, SQL injection risks, and functions over 50 lines"
    }
  ],
  "improvedInstructions": "You are a code reviewer that..."
}
```

Displayed in the UI as a side-by-side view showing `original` vs `suggested` per suggestion. User can accept all, accept individual suggestions, or dismiss.

**Edge cases:**
- If `currentInstructions` is empty, generates initial instructions from `name` + `description` (no diff view — just shows the generated text with accept/dismiss)
- Timeout: 30 second limit on the Claude call. Shows "Taking longer than expected..." after 15s. On timeout, shows error toast and lets user retry.
- Malformed response: If Claude returns text that doesn't parse as the expected JSON schema, the backend returns the raw string body as `improvedInstructions` with an empty `suggestions` array. The UI shows the raw text as a single "accept/dismiss" choice with no diff view or per-suggestion controls.

### 2.5 Progressive Disclosure

- **New users (no agents yet):** Land on `/explore` with templates. Creating from template opens the wizard, then deposits them in the studio with a prompt to test.
- **New users (in studio):** Bottom inspector is collapsed. A subtle hint says "Expand to see what your agent is doing under the hood."
- **Power users:** Full studio with all panels. Frontmatter editor available in Settings tab under an "Advanced" collapse.

---

## Phase 3: Observability & History

### 3.1 Conversation History

**Storage:** Uses the existing `getClaudeDir()` utility to resolve the base path (respects `CLAUDE_DIR` env var). History files are stored at `<claudeDir>/agent-history/[agent-slug]/[timestamp].json`.

```json
{
  "id": "2026-03-19T14:30:00Z",
  "agentSlug": "code-reviewer",
  "messages": [...],
  "toolCalls": [...],
  "tokenUsage": { "input": 1500, "output": 800 },
  "duration": 12400,
  "createdAt": "2026-03-19T14:30:00Z"
}
```

**New composable:** `useAgentHistory.ts` — fetch, list, and delete history entries.

**New endpoints:**
- `GET /api/agents/[slug]/history` — list sessions (metadata only)
- `GET /api/agents/[slug]/history/[id]` — full session with messages and tool calls
- `DELETE /api/agents/[slug]/history/[id]` — delete a session

**Studio integration:** New "History" tab in the editor panel. Shows past conversations as a list with date, message count, and first user message preview. Clicking a session loads it read-only in the test panel with the execution inspector showing that session's tool calls.

### 3.2 Tool Call Visualization

In the execution inspector, tool calls render as expandable cards:

```
+-----------------------------------------------+
| > read_file                         120ms  OK  |
|   Input: { "path": "/src/index.ts" }          |
|   Output: (42 lines) [Expand]                 |
+-----------------------------------------------+
| > edit_file                         85ms   OK  |
|   Input: { "path": "/src/index.ts", ... }     |
|   Output: "File updated" [Expand]             |
+-----------------------------------------------+
```

### 3.3 Page Parity Lift

Bring skills, plugins, and workflows index pages up to the agent list standard:
- Add search input with real-time filtering
- Consistent card components with hover states
- Empty states with guidance ("No skills yet — skills let your agents...")
- Loading skeletons matching the redesigned pages

### 3.4 Workflow Execution Replay

Enhance `WorkflowExecutionLog.vue` to reuse `ExecutionInspector` for per-step tool call visibility. Each workflow step expands to show the same tool call cards, thinking blocks, and token usage.

---

## File Structure

```
app/
├── components/
│   ├── chat/
│   │   ├── ChatMessage.vue          # Single message bubble
│   │   ├── ChatInput.vue            # Input textarea + send
│   │   ├── StreamIndicator.vue      # Status animations
│   │   └── QuickActions.vue         # Suggestion chips
│   ├── studio/
│   │   ├── EditorPanel.vue          # Tabbed editor container
│   │   ├── InstructionEditor.vue    # Instructions + improve button
│   │   ├── TestPanel.vue            # Live agent chat
│   │   └── ExecutionInspector.vue   # Tool calls, thinking, tokens
│   ├── ChatPanel.vue                # Global chat (slim orchestrator)
│   └── ...existing
├── composables/
│   ├── useCrud.ts                   # Generic CRUD
│   ├── useAgents.ts                 # Thin wrapper
│   ├── useCommands.ts               # Wrapper + getCommandsForAgent
│   ├── useSkills.ts                 # Thin wrapper
│   ├── usePlugins.ts                # Wrapper (id adapter)
│   ├── useStudioChat.ts             # Isolated chat state for studio
│   ├── useAgentHistory.ts           # Conversation history
│   └── ...existing
├── types/
│   └── index.ts                     # All types, organized by domain
├── pages/
│   ├── agents/[slug].vue            # Studio layout shell (~100 lines)
│   └── ...existing (templates.vue removed)
server/
├── api/
│   ├── agents/
│   │   ├── [slug]/
│   │   │   ├── history.get.ts           # List history
│   │   │   └── history/
│   │   │       ├── [id].get.ts          # Get session
│   │   │       └── [id].delete.ts       # Delete session
│   │   └── improve-instructions.post.ts
│   └── ...existing
```

## Migration Notes

- `ChatPanel.vue` decomposition is purely structural — no behavior changes to global chat
- `useCrud<T>()` wrappers must preserve original `useState` keys (`'agents'`, `'agentsLoading'`, etc.) to avoid breaking SSR hydration
- `usePlugins` is not migrated to `useCrud` — its interface is too different (id-based, no create/update)
- `templates.vue` removal needs: (1) delete the file, (2) update nav link in `app.vue`, (3) add route redirect in `nuxt.config.ts`
- CSS migration is incremental — styles move to scoped blocks only when their component is touched
- Agent history uses `getClaudeDir()` for path resolution — no migration needed, starts empty
- `useStudioChat` and `useChat` are fully independent — no shared state. Both can be active simultaneously.
