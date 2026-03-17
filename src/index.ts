import { loadConfig, getConfig } from "./config";
import { reloadRules } from "./scheduler";
import { loadLogs, setLogRetention } from "./logger";
import { createApp } from "./api";
import { MCPServer } from "./mcp-server";

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
