import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response, Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getConfig, saveConfig } from "./config";
import { startRule, stopRule, reloadRules, triggerNow, getActiveCount } from "./scheduler";
import { getByRule, getAll, clearByRule } from "./logger";
import { CronRule, CreateRuleSchema, UpdateRuleSchema } from "./types";

const TOOL_DEFINITIONS = [
  {
    name: "list_rules",
    description: "List all scheduled cron rules",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "create_rule",
    description: "Create a new scheduled cron rule that triggers an MCP tool call on a schedule",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Human-readable name for this rule" },
        schedule: { type: "string", description: "Cron expression (5 fields), e.g. '0 9 * * *' for daily at 9am" },
        tool: { type: "string", description: "Name of the MCP tool to call" },
        params: { type: "object", description: "Parameters to pass to the tool. Supports {{now}}, {{date}}, {{time}} templates" },
        target: {
          type: "object",
          description: "MCP server target configuration",
          properties: {
            transport: { type: "string", enum: ["stdio", "http"] },
            command: { type: "string", description: "Command for stdio transport" },
            args: { type: "array", items: { type: "string" }, description: "Args for stdio transport" },
            url: { type: "string", description: "URL for http transport" },
            authToken: { type: "string", description: "Optional bearer token" },
          },
          required: ["transport"],
        },
        enabled: { type: "boolean", description: "Whether the rule is enabled (default true)" },
        timeout: { type: "number", description: "Timeout in seconds for tool execution (default: 30)" },
      },
      required: ["name", "schedule", "tool", "params", "target"],
    },
  },
  {
    name: "update_rule",
    description: "Update an existing cron rule by ID. Only provided fields are changed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Rule ID to update" },
        name: { type: "string" },
        schedule: { type: "string" },
        tool: { type: "string" },
        params: { type: "object" },
        target: { type: "object" },
        enabled: { type: "boolean" },
        timeout: { type: "number", description: "Timeout in seconds for tool execution" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_rule",
    description: "Delete a cron rule by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Rule ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "toggle_rule",
    description: "Toggle a cron rule's enabled/disabled state",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Rule ID to toggle" },
      },
      required: ["id"],
    },
  },
  {
    name: "trigger_rule",
    description: "Manually trigger a cron rule immediately, regardless of its schedule",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Rule ID to trigger" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_logs",
    description: "Get execution logs. Optionally filter by rule ID and limit results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "Optional rule ID to filter logs" },
        limit: { type: "number", description: "Max number of logs to return (default 50)" },
      },
    },
  },
  {
    name: "clear_logs",
    description: "Clear execution logs for a specific rule",
    inputSchema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "Rule ID whose logs to clear" },
      },
      required: ["ruleId"],
    },
  },
  {
    name: "get_status",
    description: "Get the current scheduler status: active rules count, total rules, and last execution",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export class MCPServer {
  private createServer(): Server {
    const server = new Server(
      { name: "chronos-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers(server);
    return server;
  }

  private setupHandlers(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOL_DEFINITIONS };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.handleToolCall(name, args ?? {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "list_rules": {
        return getConfig().rules;
      }

      case "create_rule": {
        const body = CreateRuleSchema.parse(args);
        const rule: CronRule = { ...body, id: uuidv4() };
        const config = getConfig();
        config.rules.push(rule);
        saveConfig(config);
        if (rule.enabled) startRule(rule);
        return rule;
      }

      case "update_rule": {
        const { id, ...updates } = args as { id: string } & Record<string, unknown>;
        if (!id) throw new Error("Missing required parameter: id");
        const parsed = UpdateRuleSchema.parse(updates);
        const config = getConfig();
        const idx = config.rules.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`Rule not found: ${id}`);
        const updated: CronRule = { ...config.rules[idx], ...parsed };
        config.rules[idx] = updated;
        saveConfig(config);
        stopRule(id);
        if (updated.enabled) startRule(updated);
        return updated;
      }

      case "delete_rule": {
        const { id } = args as { id: string };
        if (!id) throw new Error("Missing required parameter: id");
        const config = getConfig();
        const idx = config.rules.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`Rule not found: ${id}`);
        config.rules.splice(idx, 1);
        saveConfig(config);
        stopRule(id);
        return { ok: true };
      }

      case "toggle_rule": {
        const { id } = args as { id: string };
        if (!id) throw new Error("Missing required parameter: id");
        const config = getConfig();
        const rule = config.rules.find((r) => r.id === id);
        if (!rule) throw new Error(`Rule not found: ${id}`);
        rule.enabled = !rule.enabled;
        saveConfig(config);
        if (rule.enabled) startRule(rule);
        else stopRule(id);
        return rule;
      }

      case "trigger_rule": {
        const { id } = args as { id: string };
        if (!id) throw new Error("Missing required parameter: id");
        const config = getConfig();
        const rule = config.rules.find((r) => r.id === id);
        if (!rule) throw new Error(`Rule not found: ${id}`);
        await triggerNow(rule);
        return { ok: true, ruleName: rule.name };
      }

      case "get_logs": {
        const { ruleId, limit } = args as { ruleId?: string; limit?: number };
        const cap = limit ?? 50;
        if (ruleId) return getByRule(ruleId, cap);
        return getAll(cap);
      }

      case "clear_logs": {
        const { ruleId } = args as { ruleId: string };
        if (!ruleId) throw new Error("Missing required parameter: ruleId");
        clearByRule(ruleId);
        return { ok: true };
      }

      case "get_status": {
        const config = getConfig();
        const allLogs = getAll(1);
        return {
          activeRules: getActiveCount(),
          totalRules: config.rules.length,
          lastExecution: allLogs[0] ?? null,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  getToolDefinitions() {
    return TOOL_DEFINITIONS;
  }

  createRouter(): Router {
    const router = Router();

    // Stateless HTTP POST endpoint
    router.post("/", express.json(), async (req: Request, res: Response) => {
      console.log("MCP HTTP POST request received");
      const server = this.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      res.on("close", () => {
        server.close().catch(console.error);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    return router;
  }

  async stop(): Promise<void> {
    console.log("MCP Server stopped");
  }
}
