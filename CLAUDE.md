# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Chronos MCP is a cron-based scheduler that triggers MCP (Model Context Protocol) tool calls at configured times. It connects to any MCP-compatible server via stdio or HTTP transports and invokes tools on a schedule defined by cron expressions.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript (tsc → dist/)
pnpm dev              # Dev mode with auto-reload (ts-node-dev)
pnpm start            # Run compiled output (node dist/index.js)
pnpm lint             # ESLint on src/

# Docker
docker compose up -d              # Start (uses mcp-network external network)
docker compose up --build -d      # Rebuild and start
```

## Architecture

The app is a single Node.js process with an Express HTTP server, an in-memory cron scheduler, and an MCP client that creates ephemeral connections per tool call.

**Startup flow** (`index.ts`): loadConfig → setLogRetention → loadLogs → reloadRules → listen on HTTP

**Core modules:**

- **`scheduler.ts`** — Manages a `Map<ruleId, ScheduledTask>` of node-cron tasks. When a cron fires, it resolves parameter templates, calls the MCP tool, and logs the result. `reloadRules()` stops all tasks then starts enabled ones.
- **`mcp-client.ts`** — Creates a fresh `@modelcontextprotocol/sdk` `Client` per invocation, connects via the configured transport (stdio/HTTP), calls the tool with a 30s timeout, then closes. Wraps transports to silently handle servers that don't support `notifications/initialized`.
- **`template.ts`** — Resolves `{{variable}}` placeholders (now, date, time, timestamp, year, month, day, hour, minute, second) in parameter objects at trigger time. Recursively handles nested objects and arrays.
- **`config.ts`** — Reads/writes `config.json` (path from `CONFIG_PATH` env var). Holds config in a module-level singleton. All mutations go through `saveConfig()` which writes to disk.
- **`logger.ts`** — In-memory log store (`Map<ruleId, ExecutionLog[]>`) with debounced persistence to `data/logs.json`. Capped by `logRetention` (default 100 per rule).
- **`api.ts`** — Express routes under `/api/` for CRUD on rules, logs, status, and manual trigger. Serves static files from `web/` directory. Zod validation on request bodies.
- **`types.ts`** — Zod schemas defining `AppConfig`, `CronRule`, `TargetConfig`, `ExecutionLog` and their inferred TypeScript types.

**Web UI** (`web/`): Static HTML+JS served by Express. Single-page interface for managing rules and viewing logs. Talks to the REST API.

## Key Design Decisions

- **Ephemeral MCP connections**: Each tool call creates a new MCP client connection and closes it after. No persistent connections to target servers.
- **Config is the source of truth**: Rules live in `config.json` on disk. The in-memory scheduler is rebuilt from config on changes.
- **Logs are separate from config**: Execution logs persist to `data/logs.json` with debounced writes (2s), not in config.json.
- **No test framework configured**: There are no tests currently. The `package.json` has no test script.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONFIG_PATH` | `./config.json` | Path to config file |
| `PORT` | `9054` (from config) | HTTP port |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `TZ` | `UTC` | Timezone for cron evaluation |

## API Routes

CRUD: `GET/POST /api/rules`, `PUT/DELETE /api/rules/:id`
Actions: `POST /api/rules/:id/toggle`, `POST /api/rules/:id/trigger`, `POST /api/restart`
Logs: `GET /api/rules/:id/logs`, `DELETE /api/rules/:id/logs`, `GET /api/logs`
Status: `GET /api/status`
