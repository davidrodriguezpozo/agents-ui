# agents-ui Launch Strategy Design

**Date:** 2026-03-20
**Status:** Draft
**Goal:** Position agents-ui for discovery and adoption by Claude Code users (both power users and newcomers) through a polished README, visual assets, and coordinated distribution.

---

## Target Audience

- **Primary:** Claude Code power users who want a visual layer on top of the CLI
- **Secondary:** Claude Code newcomers who find the CLI intimidating and want a GUI to get started

Both share the same tool (Claude Code) and benefit from the same product, but messaging should address both: "see everything at a glance" for power users, "get started without memorizing commands" for newcomers.

---

## 1. README as Product Page

The README is the primary storefront. It gets restructured from developer docs into a product page that also serves developers.

### Layout (top to bottom)

1. **Hero block**
   - One-line tagline (e.g., "A visual dashboard for managing your Claude Code agents, commands, skills, and workflows")
   - Hero GIF: 30-60s screen recording showing key flows (dashboard, agent creation, relationship graph, chat)
   - One-command install: verify the actual install command before launch (check if `npx agents-ui` / `bunx agents-ui` works, or if it requires `git clone` + `bun install` + `bun dev`). The install command must be tested end-to-end before writing the README.

2. **Feature grid**
   - 4-6 feature cards, each with a screenshot and 1-2 sentence description
   - Key features to highlight:
     - Agent / Command / Skill management
     - Relationship Graph (VueFlow visualization)
     - Agent Studio (live testing)
     - Workflow Builder (visual editor)
     - Chat interface
   - Before/after framing where useful (e.g., "editing `.claude/agents/*.md` by hand -> visual agent builder")

3. **Quick start**
   - Prerequisites (Node/Bun)
   - Install + run (2-3 commands max)
   - "Open http://localhost:3000 and you're in"

4. **Feature deep-dive**
   - Longer descriptions of each major feature with screenshots
   - Organized by user journey: setup -> create agents -> test in studio -> build workflows

5. **Contributing + License**
   - Existing dev-oriented content moved to the bottom

### Non-goals

- No separate landing page (GitHub README is the landing page)
- No embedded video (GIF is sufficient)

---

## 2. Screenshots and GIF Capture Plan

All assets captured from local running instance and committed to the repo.

### Hero GIF (1 asset)

- 30-60 second screen recording
- Flow: Dashboard -> create/edit an agent -> view relationship graph -> open chat or studio
- Tool: macOS screen recording + convert to GIF (Kap, ffmpeg, or similar)
- Resolution: ~1200px wide, crisp

### Feature screenshots (5-6 assets)

1. Dashboard overview
2. Agent editor (frontmatter fields, model selection)
3. Relationship graph (VueFlow visualization - the "wow" screenshot)
4. Agent Studio / Chat interface
5. Workflow builder (visual editor)
6. Explore page (skills/templates browsing)

### Social preview image (1 asset)

- Used as GitHub social preview (appears when repo URL is shared on Twitter/Slack/Discord)
- Dimensions: 1280x640px (GitHub requirement)
- Content: branded card with product name, tagline, and a key screenshot (e.g., relationship graph)
- Can be created with Figma, Canva, or a simple HTML page screenshotted at the right dimensions

### Storage and formatting

- Commit to `docs/images/` directory in the repo
- Reference in README with relative paths (renders on GitHub)
- Dark mode preferred (looks better in READMEs)
- Consistent window size across all captures
- Subtle drop shadow or browser frame for polish

---

## 3. Distribution Strategy

Coordinated push across channels where Claude Code users and AI tooling enthusiasts are active.

### Launch day (all same day, Tue-Thu, posts go out ~8-9am ET)

1. **Hacker News - Show HN**
   - Title: "Show HN: agents-ui - A visual dashboard for managing Claude Code agents"
   - Short description focusing on the problem it solves, link to GitHub

2. **Reddit**
   - r/ClaudeAI - primary audience, Claude-specific. Title: "I built a visual dashboard for managing Claude Code agents" — conversational, show-and-tell tone. Include GIF inline.
   - r/LocalLLaMA - broader AI tooling crowd, CLI-savvy devs. Title: "Open-source GUI for Claude Code agent management" — more technical, emphasize it's OSS. Note: check subreddit rules on self-promotion before posting.
   - r/ChatGPTCoding or r/AItools - wider reach. Keep it brief, link to GitHub.
   - Space posts a few hours apart to avoid triggering Reddit's cross-post spam filters.

3. **Twitter/X**
   - Thread format: hook tweet + 3-4 tweets showing features (embed GIF + screenshots)
   - Tag @AnthropicAI, use #ClaudeCode hashtag
   - Pin the thread

4. **Discord**
   - Claude Code community Discord
   - AI/dev tool Discord servers

### Post-launch (week after)

- Respond to all comments and issues - first-week engagement is critical
- Post a "What's next" roadmap issue on GitHub to signal active development. Content should cover 2-3 near-term features (e.g., GitHub skill import, marketplace discovery, MCP integration) and invite community input on priorities.
- If traction builds, write a short blog post / dev.to article on the architecture

### Not doing (for now)

- Product Hunt (save for a bigger milestone)
- Demo video production
- Paid promotion

---

## 4. Onboarding and First Impression

Small touches that reduce friction for someone who just clicked through from a launch post.

### GitHub repo polish

- **Description line:** Concise, shows in search/shares (e.g., "Visual dashboard for managing Claude Code agents, commands, skills & workflows")
- **Topics/tags:** `claude`, `claude-code`, `ai-agents`, `developer-tools`, `vue`, `nuxt`
- **Social preview image:** Set via GitHub repo settings. See Section 2 for asset spec (1280x640px branded card).

### In-app first run

- Dashboard should be useful even with zero agents configured
- Empty states need clear CTAs. Specifically, audit these pages for empty-state behavior:
  - Dashboard: should show "Create your first agent" and "Explore templates" CTAs when no agents exist
  - Skills page: should show "Import skills from GitHub" CTA when no skills exist
  - Workflows page: should show "Create your first workflow" CTA
- Explore page with templates is good onboarding - ensure it's discoverable from dashboard (e.g., a card or link on the dashboard)

### GitHub repo hygiene

- Add `CONTRIBUTING.md` - even a short one signals the project welcomes contributors
- Add "good first issue" labels on GitHub Issues to invite participation
- Ensure `LICENSE` file is present

### Not doing

- No guided tutorial or walkthrough overlay
- No email capture or analytics
- No onboarding wizard

---

## Success Criteria

- README communicates what the product does within 10 seconds of landing on the repo
- One-command install gets users to a running dashboard
- Launch posts generate meaningful engagement (comments, stars, issues)
- First-time users can create an agent without reading docs

---

## Implementation Order

1. Verify install command — determine whether `npx agents-ui` / `bunx agents-ui` works, or document the git clone workflow
2. Capture screenshots and hero GIF (requires running app locally)
3. Create social preview image (1280x640px branded card)
4. Create `docs/images/` directory and commit all assets (screenshots, GIF, social preview)
5. Rewrite README with new structure
6. Audit empty states on Dashboard, Skills, and Workflows pages — add CTAs where missing
7. Add social preview image to repo settings (manual, via GitHub UI)
8. Add repo description and topics on GitHub (manual, via GitHub UI)
9. Create `CONTRIBUTING.md`
10. Ensure `LICENSE` file is present
11. Draft launch posts for each channel (HN, Reddit x3, Twitter thread, Discord)
12. Draft "What's next" roadmap issue content (2-3 near-term features + community input invitation)
13. Pick a launch day (Tue-Thu) and publish all posts
14. Post-launch: engage with comments, publish roadmap issue, create "good first issue" labels
