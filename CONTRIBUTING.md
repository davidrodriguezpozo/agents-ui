# Contributing to agents-ui

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/davidrodriguezpozo/agents-ui.git
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

Check the [issues](https://github.com/davidrodriguezpozo/agents-ui/issues) for tasks labeled `good first issue`. If you have an idea for a new feature, open an issue first so we can discuss it.

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
