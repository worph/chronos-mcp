# Chronos MCP

A cron-based scheduler that triggers MCP tool calls at configured times. Define rules with standard cron expressions and map them to any tool on any MCP-compatible server.

## Overview

```
┌─────────────────────────────────────────────────────┐
│                  chronos-mcp container               │
│                                                     │
│  ┌──────────────┐        ┌─────────────────────┐   │
│  │  Cron Engine │───────►│    MCP Client        │   │
│  │  (node-cron) │        │  • stdio transport   │   │
│  └──────────────┘        │  • http transport    │   │
│         ▲                │                      │   │
│         │ rules          └──────────┬──────────┘   │
│  ┌──────┴──────┐                    │ tool call     │
│  │   Web UI    │ :9054              ▼               │
│  │  (config)   │         ┌──────────────────────┐  │
│  └─────────────┘         │   Target MCP Server   │  │
│         ▲                │   (any MCP-compatible) │  │
│         │                └──────────────────────┘  │
│  ┌──────┴──────┐                                    │
│  │  REST API   │                                    │
│  └─────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## Features

- **Cron scheduling**: Standard cron expressions with seconds precision
- **MCP tool invocation**: Call any tool on any MCP-compatible server on schedule
- **MCP server interface**: Exposes its own MCP server so LLMs can manage cron rules via MCP
- **Multiple transports**: Supports `stdio` and `http` (Streamable) MCP transports
- **Parameter templates**: Dynamic parameter values using date/time template variables
- **Web UI**: Browser-based interface to manage rules, view logs, and see MCP server config
- **Docker-ready**: Containerized, stateless deployment
- **Multiple rules**: Define as many cron rules as needed, each targeting different tools or servers

## How It Works

1. You define a cron rule: a schedule, a target MCP server, a tool name, and parameters
2. When the cron fires, Chronos connects to the configured MCP server
3. It calls the specified tool with the configured parameters
4. The result is logged; errors are surfaced in the Web UI and logs

## Quick Start

### Prerequisites

- Docker
- An MCP-compatible server to target

### Running with Docker (Recommended)

```bash
# Copy and edit config
cp config.example.json config.json

# Start with Docker Compose
docker compose up -d

# View logs
docker logs -f chronos-mcp
```

The Web UI will be available at `http://localhost:9054`


## Configuration

Access the Web UI at `http://localhost:9054` to manage cron rules and MCP targets.

### Cron Rule Fields

| Field | Description |
|-------|-------------|
| Name | Human-readable label for the rule |
| Schedule | Cron expression (supports seconds: `* * * * * *`) |
| Enabled | Toggle to activate or pause the rule |
| MCP Target | Which MCP server to connect to |
| Tool Name | The tool to call on the target server |
| Parameters | JSON object of parameters passed to the tool |

### Cron Expression Format

```
 ┌──────── second (0-59)       [optional]
 │ ┌────── minute (0-59)
 │ │ ┌──── hour (0-23)
 │ │ │ ┌── day of month (1-31)
 │ │ │ │ ┌ month (1-12)
 │ │ │ │ │ ┌ day of week (0-7, 0 and 7 = Sunday)
 │ │ │ │ │ │
 * * * * * *
```

Examples:

| Expression | Meaning |
|------------|---------|
| `0 9 * * 1-5` | Every weekday at 09:00 |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First day of every month at midnight |
| `30 8 * * 1` | Every Monday at 08:30 |
| `0 */6 * * *` | Every 6 hours |

### MCP Target Settings

| Field | Description |
|-------|-------------|
| Transport | `stdio` or `http` |
| Command | For stdio: the command to spawn the MCP server process |
| Args | For stdio: command arguments array |
| URL | For http: the MCP server endpoint |
| Auth Token | For http: optional Bearer token for authentication |

### Parameter Templates

Parameters support dynamic values resolved at trigger time:

| Template Variable | Value |
|-------------------|-------|
| `{{now}}` | ISO 8601 timestamp of the trigger time |
| `{{date}}` | Date in `YYYY-MM-DD` format |
| `{{time}}` | Time in `HH:MM:SS` format |
| `{{timestamp}}` | Unix timestamp (seconds) |
| `{{year}}` | Current year |
| `{{month}}` | Current month (01-12) |
| `{{day}}` | Current day of month (01-31) |
| `{{hour}}` | Current hour (00-23) |
| `{{minute}}` | Current minute (00-59) |
| `{{second}}` | Current second (00-59) |

Example parameter mapping:

```json
{
  "message": "Daily report for {{date}}",
  "context": {
    "triggeredAt": "{{now}}",
    "period": "{{year}}-{{month}}"
  }
}
```

### Example `config.json`

```json
{
  "port": 9054,
  "rules": [
    {
      "id": "daily-summary",
      "name": "Daily Summary",
      "schedule": "0 9 * * 1-5",
      "enabled": true,
      "target": {
        "transport": "stdio",
        "command": "node",
        "args": ["/path/to/mcp-server/dist/index.js"]
      },
      "tool": "generate_summary",
      "params": {
        "date": "{{date}}",
        "type": "daily"
      }
    },
    {
      "id": "hourly-check",
      "name": "Hourly Health Check",
      "schedule": "0 * * * *",
      "enabled": true,
      "target": {
        "transport": "http",
        "url": "http://localhost:3100/mcp"
      },
      "tool": "health_check",
      "params": {
        "timestamp": "{{timestamp}}"
      }
    }
  ]
}
```

## Project Structure

```
chronos-mcp/
├── src/
│   ├── index.ts           # Application entry point
│   ├── api.ts             # REST API for Web UI + MCP server mount
│   ├── mcp-server.ts      # MCP server interface (tools for managing rules)
│   ├── scheduler.ts       # Cron engine and rule management
│   ├── mcp-client.ts      # MCP client for calling target servers
│   ├── config.ts          # Configuration management
│   ├── logger.ts          # Execution log storage and persistence
│   ├── template.ts        # Parameter template variable resolution
│   └── types.ts           # Zod schemas and TypeScript types
├── web/
│   ├── index.html         # Rule management UI
│   └── app.js             # UI logic
├── config.example.json    # Example configuration
├── config.json            # Runtime configuration (gitignored)
├── Dockerfile
├── docker-compose.yml     # Dev stack (see Development section)
└── package.json
```

## Development

The `docker-compose.yml` **is the dev stack**. It bind-mounts `src/`, `web/`, `tsconfig.json`, and `config.json` into the container so that local edits are reflected without a full image rebuild. All development and testing should be done through this stack.

> **Note:** The compose file uses an external Docker network called `mcp-network`. Create it once before first use: `docker network create mcp-network`

```bash
# First time / after dependency changes — full rebuild
docker compose up --build -d

# After source or web changes — rebuild TypeScript inside the running container and restart
docker compose exec chronos-mcp sh -c "npx tsc && kill 1"
# The container will restart automatically (restart: unless-stopped)

# View logs
docker logs -f chronos-mcp

# Stop
docker compose down
```

| Endpoint | URL |
|----------|-----|
| Web UI | `http://localhost:9054` |
| REST API | `http://localhost:9054/api/` |
| MCP Server (HTTP) | `http://localhost:9054/mcp` |

For production, the CI pipeline (`.github/workflows/docker-publish.yml`) builds and pushes the image to `ghcr.io` on pushes to `main` or version tags.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Web UI / API port | `9054` |
| `CONFIG_PATH` | Path to config file | `./config.json` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `TZ` | Timezone for cron evaluation | `UTC` |

## API

The REST API powers the Web UI and can be used directly:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/rules` | List all cron rules |
| `POST` | `/api/rules` | Create a new rule |
| `PUT` | `/api/rules/:id` | Update a rule |
| `DELETE` | `/api/rules/:id` | Delete a rule |
| `POST` | `/api/rules/:id/toggle` | Toggle a rule's enabled state |
| `POST` | `/api/rules/:id/trigger` | Manually trigger a rule immediately |
| `GET` | `/api/rules/:id/logs` | Get execution logs for a rule |
| `DELETE` | `/api/rules/:id/logs` | Clear execution logs for a rule |
| `GET` | `/api/logs` | Get all execution logs |
| `GET` | `/api/status` | Get scheduler status |
| `POST` | `/api/restart` | Reload and restart all rules |
| `GET` | `/api/mcp-server-info` | Get MCP server endpoints, tools, and Claude config |

### MCP Server Endpoints

Chronos also exposes an MCP server interface so LLMs can manage cron rules directly via MCP:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | Stateless HTTP (Streamable) MCP endpoint |

**MCP Tools:** `list_rules`, `create_rule`, `update_rule`, `delete_rule`, `toggle_rule`, `trigger_rule`, `get_logs`, `clear_logs`, `get_status`

## License

MIT
