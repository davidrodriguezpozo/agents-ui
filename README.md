# agents-ui

A web dashboard for managing Claude Code agents and commands. Browse, create, edit, and visualize the relationships between your agents and commands stored in your `.claude` directory.

## Screenshots

![Main View](images/main-view.png)

![Agent Details](images/agent-details.png)

## Features

- **Dashboard** — Overview of agents, commands, model distribution, and quick links
- **Agent Management** — Create, edit, and delete agents with frontmatter metadata (model, color, memory type)
- **Command Management** — Organize commands in nested directories with allowed-tools configuration
- **Relationship Graph** — Interactive node-edge visualization of agent/command dependencies using VueFlow
- **Settings** — Configure plugins and system preferences

## Tech Stack

- [Nuxt 3](https://nuxt.com) + [Vue 3](https://vuejs.org)
- [Nuxt UI](https://ui.nuxt.com) + Tailwind CSS
- [VueFlow](https://vueflow.dev) for graph visualization
- [Bun](https://bun.sh) as package manager

## Setup

```bash
bun install
```

## Development

```bash
bun run dev
```

The app runs on `http://localhost:3000` by default.

## Build

```bash
bun run build
bun run preview
```

## Environment Variables

| Variable    | Description                          | Default    |
| ----------- | ------------------------------------ | ---------- |
| `CLAUDE_DIR` | Path to your Claude config directory | `~/.claude` |

## Project Structure

```
app/
├── components/     # AgentForm, CommandForm, PageHeader
├── composables/    # useAgents, useCommands, useClaudeDir, useSettings
├── pages/          # Dashboard, agents/, commands/, graph, settings
├── types/          # TypeScript type definitions
└── utils/          # Color mappings

server/
├── api/            # REST endpoints for agents, commands, config, settings
└── utils/          # Frontmatter parsing, relationship extraction
```

## License

MIT
