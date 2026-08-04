# Agent Manager
#
# Every target here is a command already documented in the README; this just
# means you do not have to remember which of them is `bun run`, which is a bare
# `node`, and which needs a rebuild first.
#
# Override anything on the command line:
#
#     make dev PORT=3001
#     make test PKG=npm

PKG  ?= bun
PORT ?= 3000
export PORT

# The service runs the build rather than the dev server, so several targets
# below have to go through `build` first to mean anything.
SERVER := node bin/start.mjs

.DEFAULT_GOAL := help

.PHONY: help setup dev start build test watch typecheck check \
        service service-status service-restart service-stop service-logs \
        demo demo-stop clean

help: ## Show this list
	@echo "Agent Manager — make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  PORT=$(PORT)  PKG=$(PKG)"

setup: ## Install dependencies
	$(PKG) install

dev: ## Run with hot reload, for working on the app
	$(PKG) run dev

start: ## Run the built server in this terminal
	$(SERVER)

build: ## Build into .output/
	$(PKG) run build

test: ## Run the test suite
	$(PKG) run test

watch: ## Run the tests and keep watching
	$(PKG) run test:watch

typecheck: ## Typecheck everything
	$(PKG) run typecheck

check: test typecheck ## Everything CI would object to

## ---- Running it for real ------------------------------------------------

service: build ## Install as a background service, so rituals fire without you
	$(SERVER) install

service-status: ## Is it installed, is it answering
	@$(SERVER) status

service-restart: build ## Pick up code changes (install is idempotent)
	$(SERVER) install

service-stop: ## Remove the service — your sessions and rituals are untouched
	$(SERVER) uninstall

service-logs: ## Follow what the background service is saying
	@tail -f "$${CLAUDE_DIR:-$$HOME/.claude}/agents-ui/logs/service.log"

## ---- Screenshots and demos ----------------------------------------------

demo: build ## Seed a self-contained demo and serve it on 3200
	node scripts/demo-data.mjs seed
	CLAUDE_DIR=$$HOME/.claude-demo PORT=3200 node .output/server/index.mjs

demo-stop: ## Delete the demo directory and its repository
	node scripts/demo-data.mjs revert

## ---- Housekeeping -------------------------------------------------------

# Build output only. Nothing here touches ~/.claude, which holds real sessions,
# rituals and the worktrees they are working in.
clean: ## Remove build artefacts
	rm -rf .output .nuxt
