# agents-ui Launch Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare agents-ui for public launch with a polished README, repo hygiene, empty-state CTAs, and draft launch posts.

**Architecture:** Content-heavy plan — most tasks create or rewrite markdown files (README, CONTRIBUTING, LICENSE, launch posts). Two tasks involve Vue component edits for empty-state CTAs. Image assets are placeholders the user captures manually.

**Tech Stack:** Nuxt 3, Vue 3, Nuxt UI, Tailwind CSS, Markdown

**Spec:** `docs/superpowers/specs/2026-03-20-launch-strategy-design.md`

---

## File Structure

**Create:**
- `README.md` — full rewrite as product page (hero, features, quick start, deep-dive)
- `LICENSE` — MIT license file
- `CONTRIBUTING.md` — contribution guidelines
- `docs/images/.gitkeep` — directory for screenshots/GIF (user populates manually)
- `docs/launch/hackernews.md` — Show HN post draft
- `docs/launch/reddit-claudeai.md` — r/ClaudeAI post draft
- `docs/launch/reddit-localllama.md` — r/LocalLLaMA post draft
- `docs/launch/reddit-other.md` — r/ChatGPTCoding or r/AItools post draft
- `docs/launch/twitter-thread.md` — Twitter/X thread draft
- `docs/launch/discord.md` — Discord post draft
- `docs/launch/roadmap-issue.md` — GitHub "What's next" roadmap issue draft

**Modify:**
- `app/pages/skills/index.vue` — add "Import from GitHub" CTA to empty state
- `app/pages/index.vue` — add "Explore templates" link to dashboard when content exists

---

### Task 0: Verify install command

**Files:**
- None (investigation only)

The package.json has `"private": true` and a `bin` entry pointing to `bin/start.mjs`. This means `npx agents-ui` / `bunx agents-ui` will NOT work unless the package is published to npm. The current install flow is `git clone` + `bun install` + `bun run dev`.

- [ ] **Step 1: Confirm the package is not published to npm**

Run: `npm view agents-ui`
Expected: 404 or "not found" — confirming it's not on npm.

- [ ] **Step 2: Test the git clone install flow end-to-end**

Run these commands in a temp directory:
```bash
cd /tmp
git clone https://github.com/<owner>/agents-ui.git agents-ui-test
cd agents-ui-test
bun install
bun run dev
```
Expected: App starts on http://localhost:3000. Verify it loads the dashboard.

- [ ] **Step 3: Document the verified install command**

The README (Task 4) uses `git clone` + `bun install` + `bun run dev`. If this test passes, no changes needed. If it fails, update the README draft before writing it.

Clean up: `rm -rf /tmp/agents-ui-test`

**Note:** Replace `<owner>` with the actual GitHub username/org.

---

### Task 1: Create LICENSE file

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT LICENSE file**

```text
MIT License

Copyright (c) 2026 agents-ui contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Task 2: Create CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

```markdown
# Contributing to agents-ui

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/<owner>/agents-ui.git
   cd agents-ui
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the dev server:
   ```bash
   bun run dev
   ```

4. Open `http://localhost:3000`

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test locally with `bun run dev`
4. Run type checking: `bun run typecheck`
5. Submit a pull request

## What to Work On

Check the [issues](https://github.com/<owner>/agents-ui/issues) for tasks labeled `good first issue`. If you have an idea for a new feature, open an issue first so we can discuss it.

## Code Style

- Vue 3 Composition API with `<script setup>`
- TypeScript for all new code
- Tailwind CSS for styling (using Nuxt UI components where possible)
- Composables for shared state and API calls (`app/composables/`)

## Project Structure

```
app/
├── components/     # Vue components
├── composables/    # Shared state & API wrappers
├── pages/          # Nuxt pages (file-based routing)
├── types/          # TypeScript interfaces
└── utils/          # Helpers (colors, templates)

server/
├── api/            # REST endpoints
└── utils/          # Server-side helpers
```

## Questions?

Open an issue or start a discussion. We're happy to help!
```

**Note:** Replace `<owner>` with the actual GitHub username/org before launch.

---

### Task 3: Create docs/images directory

**Files:**
- Create: `docs/images/.gitkeep`

- [ ] **Step 1: Create the directory with a .gitkeep**

Create an empty `docs/images/.gitkeep` file so the directory is tracked by git. The user will add screenshots and the hero GIF here manually.

---

### Task 4: Rewrite README.md as product page

**Files:**
- Modify: `README.md` (full rewrite)

**Depends on:** Task 0 (install command verified), Task 3 (docs/images/ directory exists)

- [ ] **Step 1: Rewrite README.md**

The README uses image placeholders (`docs/images/hero.gif`, `docs/images/dashboard.png`, etc.) that the user will replace after capturing screenshots. The install flow is `git clone` + `bun install` + `bun run dev` since the package is private (verified in Task 0).

```markdown
<div align="center">

# agents-ui

**A visual dashboard for managing your Claude Code agents, commands, skills, and workflows.**

Manage everything in your `.claude` directory — without touching the terminal.

<!-- Replace with your hero GIF after recording -->
![agents-ui demo](docs/images/hero.gif)

[Quick Start](#quick-start) · [Features](#features) · [Contributing](CONTRIBUTING.md)

</div>

---

## Quick Start

```bash
git clone https://github.com/<owner>/agents-ui.git
cd agents-ui
bun install
bun run dev
```

Open **http://localhost:3000** — that's it. agents-ui reads your `~/.claude` directory and you're ready to go.

> **Prerequisites:** [Bun](https://bun.sh) (or Node.js 18+). If using Node, replace `bun` with `npm` or `pnpm`.

---

## Features

### Agent Management
Create, edit, and organize AI agents with custom instructions, models, and memory settings. Pick from templates or build from scratch.

<!-- ![Agent Editor](docs/images/agent-editor.png) -->

### Command Builder
Build reusable slash commands with argument hints and allowed-tools configuration. Organize in nested directories.

### Relationship Graph
Interactive visualization of how your agents, commands, and skills connect. See the big picture at a glance.

<!-- ![Relationship Graph](docs/images/graph.png) -->

### Agent Studio
Test your agents live — send messages, inspect execution, and refine instructions in real time.

<!-- ![Agent Studio](docs/images/studio.png) -->

### Workflow Builder
Chain agents into multi-step pipelines with a visual editor. Define execution order and inspect results.

<!-- ![Workflow Builder](docs/images/workflows.png) -->

### Skill Management
Browse, create, and import skills from GitHub. Teach your agents new capabilities.

### Explore & Templates
Discover agent templates, browse extensions, and import community skills — all from one place.

<!-- ![Explore](docs/images/explore.png) -->

---

## Why agents-ui?

**If you already use Claude Code:** You manage agents by editing markdown files in `~/.claude/agents/`, commands in `~/.claude/commands/`, and skills scattered across directories. agents-ui gives you a visual layer on top — see everything at a glance, catch misconfigurations, and iterate faster.

**If you're new to Claude Code:** The CLI can feel overwhelming. agents-ui gives you a GUI to get started — create your first agent from a template, see what each setting does, and build confidence before diving into the terminal.

---

## Tech Stack

- [Nuxt 3](https://nuxt.com) + [Vue 3](https://vuejs.org)
- [Nuxt UI](https://ui.nuxt.com) + Tailwind CSS
- [VueFlow](https://vueflow.dev) for graph visualization
- [Bun](https://bun.sh) as package manager

## Environment Variables

| Variable     | Description                          | Default     |
| ------------ | ------------------------------------ | ----------- |
| `CLAUDE_DIR` | Path to your Claude config directory | `~/.claude` |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE)
```

**Note:** Replace `<owner>` with the actual GitHub username/org. Uncomment image references after capturing screenshots.

---

### Task 5: Add "Import from GitHub" CTA to skills empty state

**Files:**
- Modify: `app/pages/skills/index.vue:117-138`

- [ ] **Step 1: Read the full skills page to understand the template and script sections**

Read `app/pages/skills/index.vue` to understand the current empty state markup and what composables/state are available.

- [ ] **Step 2: Add the "Import from GitHub" button next to "Create a skill"**

In `app/pages/skills/index.vue`, find the empty state section (the `v-else` block around line 118). After the existing "Create a skill" `UButton`, add a second button that links to the Explore page's Imported tab:

Replace this block (around lines 136-138):
```html
        <p class="text-[13px] text-label">Skills teach agents specific capabilities. Link a skill to an agent to extend what it can do.</p>
        <UButton label="Create a skill" size="sm" @click="showCreateModal = true" />
      </div>
```

With:
```html
        <p class="text-[13px] text-label">Skills teach agents specific capabilities. Link a skill to an agent to extend what it can do.</p>
        <div class="flex items-center gap-2">
          <UButton label="Create a skill" size="sm" @click="showCreateModal = true" />
          <UButton label="Import from GitHub" size="sm" variant="outline" to="/explore?tab=imported" />
        </div>
      </div>
```

- [ ] **Step 3: Verify the page renders correctly**

Run `bun run dev` and navigate to the Skills page with no skills configured. Verify both buttons appear side by side and the "Import from GitHub" button navigates to `/explore?tab=imported`.

---

### Task 6: Add "Explore templates" link on dashboard

**Files:**
- Modify: `app/pages/index.vue`

The dashboard's `WelcomeOnboarding` component already shows templates when there are no agents. But when agents exist (`hasContent` is true), there's no quick path to the Explore page. Add an "Explore templates" link in the dashboard's quick-links section.

- [ ] **Step 1: Read the dashboard page to find the quick-links/navigation section**

Read `app/pages/index.vue` to locate the navigation cards that link to agents, commands, skills, etc. Look for the section that shows when `hasContent` is true.

- [ ] **Step 2: Add an "Explore" card to the quick-links grid**

Find the grid of navigation cards in `app/pages/index.vue`. The existing cards use this pattern (see the "Create Workflow" card at line ~440):
```html
<NuxtLink to="/workflows" class="block rounded-xl p-4 focus-ring hover-card bg-card group">
  <div class="flex items-center gap-3">
    <div class="size-8 rounded-lg flex items-center justify-center shrink-0" style="...">
      <UIcon ... />
    </div>
    ...
  </div>
</NuxtLink>
```

Add the following card **after** the Workflows NuxtLink (after line ~467, before the closing `</div>` of the grid):

```html
            <NuxtLink
              to="/explore"
              class="block rounded-xl p-4 focus-ring hover-card bg-card group"
            >
              <div class="flex items-center gap-3">
                <div
                  class="size-8 rounded-lg flex items-center justify-center shrink-0"
                  style="
                    background: var(--accent-muted);
                    border: 1px solid rgba(229, 169, 62, 0.12);
                  "
                >
                  <UIcon
                    name="i-lucide-compass"
                    class="size-4"
                    style="color: var(--accent)"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-medium">Explore</div>
                  <div class="text-[11px] text-label">Templates & extensions</div>
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 text-meta opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5"
                />
              </div>
            </NuxtLink>
```

This matches the exact pattern of the sibling cards (block, rounded-xl, p-4, inner flex with size-8 icon container).

- [ ] **Step 3: Verify the card renders and links correctly**

Run `bun run dev`, navigate to the dashboard (with at least one agent configured so `hasContent` is true). Verify the Explore card appears in the grid and links to `/explore`.

---

### Audit Note: Workflows page empty state

The spec calls for the Workflows page to show a "Create your first workflow" CTA when empty. **No changes needed** — the existing empty state at `app/pages/workflows/index.vue:126-178` already shows:
- A centered icon and heading ("Chain your agents together")
- Description text encouraging the user to start
- A template grid with clickable workflow templates
- An "Or create from scratch" button

This is a stronger onboarding experience than a simple CTA button. No task required.

---

### Task 7: Draft launch posts

**Files:**
- Create: `docs/launch/hackernews.md`
- Create: `docs/launch/reddit-claudeai.md`
- Create: `docs/launch/reddit-localllama.md`
- Create: `docs/launch/reddit-other.md`
- Create: `docs/launch/twitter-thread.md`
- Create: `docs/launch/discord.md`

- [ ] **Step 1: Create docs/launch/ directory and all post drafts**

**docs/launch/hackernews.md:**
```markdown
# Show HN Post

**Title:** Show HN: agents-ui – A visual dashboard for managing Claude Code agents

**Text:**

I built a web dashboard for managing Claude Code's .claude directory — agents, commands, skills, and workflows.

If you use Claude Code, you've probably hand-edited markdown files in ~/.claude/agents/ and ~/.claude/commands/. agents-ui gives you a visual layer: create agents from templates, see how everything connects in a relationship graph, test agents in a live studio, and build multi-step workflows with a visual editor.

Tech stack: Nuxt 3 + Vue 3, VueFlow for the graph, Tailwind CSS. Runs locally, reads your existing .claude directory.

GitHub: https://github.com/<owner>/agents-ui

Happy to answer questions about the architecture or Claude Code agent patterns.
```

**docs/launch/reddit-claudeai.md:**
```markdown
# r/ClaudeAI Post

**Title:** I built a visual dashboard for managing Claude Code agents

**Body:**

I've been using Claude Code heavily and got tired of editing agent markdown files by hand. So I built **agents-ui** — an open-source web dashboard that sits on top of your `.claude` directory.

**What it does:**
- Create and edit agents, commands, and skills with a GUI
- See how everything connects with an interactive relationship graph
- Test agents live in Agent Studio
- Build multi-step workflows with a visual editor
- Browse templates and import skills from GitHub

It runs locally — just clone, install, and open localhost:3000. It reads your existing `.claude` config, so there's nothing to migrate.

GitHub: https://github.com/<owner>/agents-ui

Would love feedback from other Claude Code users. What features would be most useful for your workflow?

<!-- Include hero GIF inline -->
```

**docs/launch/reddit-localllama.md:**
```markdown
# r/LocalLLaMA Post

**Title:** Open-source GUI for Claude Code agent management

**Body:**

Sharing an open-source tool I built: **agents-ui** — a Nuxt 3 web dashboard for managing Claude Code agents, commands, skills, and workflows.

It's a visual layer on top of the `.claude` directory that Claude Code uses for configuration. Instead of editing markdown files, you get a GUI with an interactive relationship graph, live agent testing, a workflow builder, and template browsing.

Fully local, MIT licensed, no telemetry.

Tech: Nuxt 3, Vue 3, VueFlow, Tailwind CSS.

GitHub: https://github.com/<owner>/agents-ui

<!-- Include screenshot of relationship graph -->
```

**docs/launch/reddit-other.md:**
```markdown
# r/ChatGPTCoding / r/AItools Post

**Title:** agents-ui — open-source dashboard for managing Claude Code agents

**Body:**

Built a visual dashboard for Claude Code's agent system. Create agents, build workflows, see relationship graphs, test live — all from a web UI instead of editing markdown files.

Open source, runs locally: https://github.com/<owner>/agents-ui
```

**docs/launch/twitter-thread.md:**
```markdown
# Twitter/X Thread

**Tweet 1 (hook):**
I built an open-source dashboard for managing Claude Code agents.

No more editing markdown files by hand. Create agents, test them live, build workflows, and see how everything connects — all from a web UI.

https://github.com/<owner>/agents-ui

#ClaudeCode @AnthropicAI

---

**Tweet 2 (relationship graph):**
The relationship graph shows how your agents, commands, and skills connect at a glance.

Built with VueFlow — fully interactive, drag-and-drop.

<!-- Attach graph screenshot -->

---

**Tweet 3 (agent studio):**
Agent Studio lets you test agents in real time — send messages, inspect execution, and tweak instructions without leaving the browser.

<!-- Attach studio screenshot -->

---

**Tweet 4 (workflows):**
Chain agents into multi-step workflows with a visual editor. Define execution order and inspect results step by step.

<!-- Attach workflow builder screenshot -->

---

**Tweet 5 (CTA):**
It's MIT licensed, runs locally, and reads your existing .claude directory.

Clone it, run `bun run dev`, and you're in.

https://github.com/<owner>/agents-ui
```

**docs/launch/discord.md:**
```markdown
# Discord Post

Hey all — I built **agents-ui**, an open-source web dashboard for managing Claude Code agents, commands, skills, and workflows.

If you use Claude Code, this gives you a visual layer on top of your `.claude` directory:
- GUI for creating/editing agents, commands, skills
- Interactive relationship graph
- Live agent testing (Agent Studio)
- Visual workflow builder
- Template browsing and GitHub skill imports

Runs locally, MIT licensed. Clone + `bun install` + `bun run dev` and you're in.

GitHub: https://github.com/<owner>/agents-ui

Would love feedback!

<!-- Attach hero GIF -->
```

**Note:** Replace `<owner>` with actual GitHub username/org. Add images after capturing.

---

### Task 8: Draft roadmap issue

**Files:**
- Create: `docs/launch/roadmap-issue.md`

- [ ] **Step 1: Create roadmap issue draft**

```markdown
# GitHub Issue: What's Next for agents-ui

**Title:** Roadmap: What's next for agents-ui

**Labels:** `roadmap`, `discussion`

**Body:**

## What's next

agents-ui is under active development. Here's what's on the horizon:

### Near-term
- **GitHub Skill Import** — Import skills from GitHub repos by URL, with auto-detection and update notifications
- **Marketplace Discovery** — Browse and install plugins from registered marketplaces, directly from the UI
- **MCP Server Integration** — Manage Model Context Protocol servers and their tools

### Ideas (community input welcome)
- Team/shared configuration support
- Agent performance analytics
- Diff view for configuration changes
- CLI companion (`agents-ui` as an npx command)
- Dark/light theme toggle

---

**What would be most useful for you?** Drop a comment with your use case — it helps us prioritize.

If you'd like to contribute, check out [CONTRIBUTING.md](../CONTRIBUTING.md) and look for issues labeled `good first issue`.
```

---

## Manual Steps (user must do)

These are NOT automated tasks — they require the user's action:

1. **Capture screenshots and hero GIF** — Run the app locally, record 30-60s GIF, take 5-6 screenshots. Save to `docs/images/`. See spec Section 2 for the shot list.
2. **Create social preview image** — 1280x640px branded card. Save to `docs/images/social-preview.png`.
3. **Uncomment image references in README** — After adding images, remove the `<!-- -->` comment wrappers around image tags in README.md.
4. **Replace `<owner>` placeholders** — In README.md, CONTRIBUTING.md, and all launch posts, replace `<owner>` with the actual GitHub username/org.
5. **Set GitHub repo settings** — Description, topics (`claude`, `claude-code`, `ai-agents`, `developer-tools`, `vue`, `nuxt`), and social preview image via GitHub UI.
6. **Create "good first issue" labels** — Add label in GitHub Issues settings.
7. **Publish launch posts** — Pick a Tue-Thu, post HN first at ~8-9am ET, then Reddit (spaced a few hours apart), Twitter, Discord.
8. **Post roadmap issue** — Create the GitHub issue from `docs/launch/roadmap-issue.md` content.
