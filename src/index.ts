import { loadConfig, getConfig } from "./config";
import { reloadRules } from "./scheduler";
import { loadLogs, setLogRetention } from "./logger";
import { createApp } from "./api";
import { MCPServer } from "./mcp-server";
// @ts-ignore
const { createDiscoveryResponder } = require("../mcp-announce.js");

async function main(): Promise<void> {
  // Load config
  const config = loadConfig();

  // Configure logger
  setLogRetention(config.logRetention);

  // Load persisted logs
  loadLogs();

  // Start scheduler
  reloadRules(config.rules);

  // Create MCP server
  const mcpServer = new MCPServer();

  // Start HTTP server
  const app = createApp(mcpServer);
  const port = config.port;

  const server = app.listen(port, () => {
    console.log(`chronos-mcp listening on http://localhost:${port}`);
    console.log(`Web UI: http://localhost:${port}`);
    console.log(`MCP endpoint: http://localhost:${port}/mcp`);

    // Beacon discovery
    createDiscoveryResponder({
      name: "chronos-mcp",
      description: "Cron scheduler — create, manage, and trigger scheduled MCP tool calls",
      tools: [
        { name: "list_rules", description: "List all scheduled cron rules", inputSchema: { type: "object", properties: {} } },
        { name: "create_rule", description: "Create a new scheduled cron rule that triggers an MCP tool call on a schedule", inputSchema: { type: "object", properties: { name: { type: "string" }, schedule: { type: "string" }, tool: { type: "string" }, params: { type: "object" }, target: { type: "object" }, enabled: { type: "boolean" } }, required: ["name", "schedule", "tool", "params", "target"] } },
        { name: "update_rule", description: "Update an existing cron rule by ID. Only provided fields are changed.", inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, schedule: { type: "string" }, tool: { type: "string" }, params: { type: "object" }, target: { type: "object" }, enabled: { type: "boolean" } }, required: ["id"] } },
        { name: "delete_rule", description: "Delete a cron rule by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "toggle_rule", description: "Toggle a cron rule's enabled/disabled state", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "trigger_rule", description: "Manually trigger a cron rule immediately, regardless of its schedule", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "get_logs", description: "Get execution logs. Optionally filter by rule ID and limit results.", inputSchema: { type: "object", properties: { ruleId: { type: "string" }, limit: { type: "number" } } } },
        { name: "clear_logs", description: "Clear execution logs for a specific rule", inputSchema: { type: "object", properties: { ruleId: { type: "string" } }, required: ["ruleId"] } },
        { name: "get_status", description: "Get the current scheduler status: active rules count, total rules, and last execution", inputSchema: { type: "object", properties: {} } },
      ],
      port: config.port,
      listenPort: parseInt(process.env.DISCOVERY_PORT || "9099"),
    });
  });

  // Graceful shutdown
  function shutdown(signal: string): void {
    console.log(`\nReceived ${signal}, shutting down...`);
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
