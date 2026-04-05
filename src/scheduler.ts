import cron from "node-cron";
import { v4 as uuidv4 } from "uuid";
import { CronRule } from "./types";
import { callTool } from "./mcp-client";
import { resolveParams } from "./template";
import { addLog } from "./logger";

interface ScheduledTask {
  task: cron.ScheduledTask;
  rule: CronRule;
}

const tasks = new Map<string, ScheduledTask>();

async function executeTool(rule: CronRule): Promise<void> {
  const triggeredAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const resolvedParams = resolveParams(rule.params);
    const timeoutMs = rule.timeout ? rule.timeout * 1000 : undefined;
    const result = await callTool(rule.target, rule.tool, resolvedParams, timeoutMs);

    addLog({
      id: uuidv4(),
      ruleId: rule.id,
      ruleName: rule.name,
      triggeredAt,
      status: "success",
      result,
      durationMs: Date.now() - startMs,
    });

    console.log(`[${rule.name}] executed successfully (${Date.now() - startMs}ms)`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    addLog({
      id: uuidv4(),
      ruleId: rule.id,
      ruleName: rule.name,
      triggeredAt,
      status: "error",
      error,
      durationMs: Date.now() - startMs,
    });

    console.error(`[${rule.name}] execution failed: ${error}`);
  }
}

export function startRule(rule: CronRule): void {
  if (!rule.enabled) return;

  if (!cron.validate(rule.schedule)) {
    console.error(`[${rule.name}] invalid cron expression: ${rule.schedule}`);
    return;
  }

  const task = cron.schedule(rule.schedule, () => {
    executeTool(rule).catch((err) => {
      console.error(`[${rule.name}] unhandled error:`, err);
    });
  });

  tasks.set(rule.id, { task, rule });
  console.log(`Scheduled rule "${rule.name}" (${rule.schedule})`);
}

export function stopRule(ruleId: string): void {
  const entry = tasks.get(ruleId);
  if (entry) {
    entry.task.stop();
    tasks.delete(ruleId);
    console.log(`Stopped rule "${entry.rule.name}"`);
  }
}

export function reloadRules(rules: CronRule[]): void {
  // Stop all existing tasks
  for (const id of tasks.keys()) {
    stopRule(id);
  }

  // Start enabled rules
  for (const rule of rules) {
    if (rule.enabled) {
      startRule(rule);
    }
  }
}

export function triggerNow(rule: CronRule): Promise<void> {
  return executeTool(rule);
}

export function getActiveCount(): number {
  return tasks.size;
}

export function getActiveRuleIds(): string[] {
  return [...tasks.keys()];
}
