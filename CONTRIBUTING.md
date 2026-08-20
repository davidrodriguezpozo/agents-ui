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
   make setup
   ```

3. Start the dev server:
   ```bash
   make dev
   ```

4. Open `http://localhost:3000`

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test locally with `make dev`
4. Run `make check` — tests and typecheck, both of which pass on `main`
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

cli/                # Terminal app (Ink). Bundled into .output/cli/

server/
├── api/            # REST endpoints
└── utils/          # Server-side helpers
```

## Releasing

Publishing happens only in the `Publish` workflow, which npm authenticates by OIDC —
there is no token on anyone's laptop. Bump the version in `package.json`, commit, then
publish a GitHub release tagged `v<version>`; the workflow refuses a tag that disagrees
with the version, and re-releasing a published version is a quiet no-op.

Two things pass every test and still ship a broken package, because both only exist
once the tarball is installed. Check them by hand:

1. **A page renders.** `npm pack`, install the tarball somewhere else, start it and open
   it. Nitro symlinks some vendored dependencies and npm's tarball drops symlinks —
   see `scripts/dereference-output.mjs`.
2. **A run actually runs.** Start a session or ask the chat for anything. The Agent SDK
   spawns a native Claude Code binary that is not part of the build, and an install has
   none of the `node_modules` a checkout resolves it from — see
   `server/utils/claudeExecutable.ts`.

## Questions?

Open an issue or start a discussion. We're happy to help!
