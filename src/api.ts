import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getConfig, saveConfig, updateConfig } from "./config";
import { startRule, stopRule, reloadRules, triggerNow, getActiveCount } from "./scheduler";
import { getByRule, getAll, clearByRule } from "./logger";
import { CronRule, CreateRuleSchema, UpdateRuleSchema } from "./types";
import { MCPServer } from "./mcp-server";

export function createApp(mcpServer: MCPServer): express.Application {
  const app = express();

  // Mount MCP router BEFORE express.json() — it handles its own body parsing
  app.use("/mcp", mcpServer.createRouter());

  app.use(express.json());

  // Serve static web UI
  const webDir = path.join(__dirname, "..", "web");
  app.use(express.static(webDir));

  // ── Rules ────────────────────────────────────────────────────────────────

  // GET /api/rules
  app.get("/api/rules", (_req: Request, res: Response) => {
    res.json(getConfig().rules);
  });

  // POST /api/rules
  app.post("/api/rules", (req: Request, res: Response) => {
    try {
      const body = CreateRuleSchema.parse(req.body);
      const rule: CronRule = { ...body, id: uuidv4() };

      const config = getConfig();
      config.rules.push(rule);
      saveConfig(config);

      if (rule.enabled) {
        startRule(rule);
      }

      res.status(201).json(rule);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors });
      } else {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  // PUT /api/rules/:id
  app.put("/api/rules/:id", (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const body = UpdateRuleSchema.parse(req.body);

      const config = getConfig();
      const idx = config.rules.findIndex((r) => r.id === id);
      if (idx === -1) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }

      const updated: CronRule = { ...config.rules[idx], ...body };
      config.rules[idx] = updated;
      saveConfig(config);

      // Restart the task with new config
      stopRule(id);
      if (updated.enabled) {
        startRule(updated);
      }

      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors });
      } else {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  // DELETE /api/rules/:id
  app.delete("/api/rules/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const config = getConfig();
    const idx = config.rules.findIndex((r) => r.id === id);
    if (idx === -1) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    config.rules.splice(idx, 1);
    saveConfig(config);
    stopRule(id);

    res.json({ ok: true });
  });

  // POST /api/rules/:id/toggle
  app.post("/api/rules/:id/toggle", (req: Request, res: Response) => {
    const { id } = req.params;
    const config = getConfig();
    const rule = config.rules.find((r) => r.id === id);
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    rule.enabled = !rule.enabled;
    saveConfig(config);

    if (rule.enabled) {
      startRule(rule);
    } else {
      stopRule(id);
    }

    res.json(rule);
  });

  // POST /api/rules/:id/trigger
  app.post("/api/rules/:id/trigger", (req: Request, res: Response) => {
    const { id } = req.params;
    const config = getConfig();
    const rule = config.rules.find((r) => r.id === id);
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    triggerNow(rule)
      .then(() => res.json({ ok: true }))
      .catch((err) => res.status(500).json({ error: String(err) }));
  });

  // ── Logs ─────────────────────────────────────────────────────────────────

  // GET /api/rules/:id/logs
  app.get("/api/rules/:id/logs", (req: Request, res: Response) => {
    const { id } = req.params;
    const limit = Number(req.query.limit) || 50;
    res.json(getByRule(id, limit));
  });

  // DELETE /api/rules/:id/logs
  app.delete("/api/rules/:id/logs", (req: Request, res: Response) => {
    clearByRule(req.params.id);
    res.json({ ok: true });
  });

  // GET /api/logs
  app.get("/api/logs", (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 200;
    res.json(getAll(limit));
  });

  // ── Status & Control ──────────────────────────────────────────────────────

  // GET /api/status
  app.get("/api/status", (_req: Request, res: Response) => {
    const config = getConfig();
    const allLogs = getAll(1);
    res.json({
      activeRules: getActiveCount(),
      totalRules: config.rules.length,
      lastExecution: allLogs[0] ?? null,
    });
  });

  // GET /api/mcp-server-info
  app.get("/api/mcp-server-info", (req: Request, res: Response) => {
    const host = req.headers.host || `localhost:${getConfig().port}`;
    const baseUrl = `http://${host}/mcp`;
    const tools = mcpServer.getToolDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
    }));
    res.json({
      sseUrl: `${baseUrl}/sse`,
      httpUrl: baseUrl,
      tools,
      claudeConfig: {
        mcpServers: {
          "chronos-mcp": {
            url: baseUrl,
          },
        },
      },
    });
  });

  // POST /api/restart
  app.post("/api/restart", (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      reloadRules(config.rules);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Fallback: serve index.html for any non-API route
  app.get("*", (req: Request, res: Response) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(webDir, "index.html"));
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  // Error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app;
}
