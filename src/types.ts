import { z } from "zod";

export const TargetConfigSchema = z.object({
  transport: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  authToken: z.string().optional(),
});

export const CronRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  schedule: z.string().min(1),
  enabled: z.boolean(),
  target: TargetConfigSchema,
  tool: z.string().min(1),
  params: z.record(z.unknown()),
});

export const AppConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(9054),
  hostname: z.string().default("localhost"),
  logRetention: z.number().int().min(1).default(100),
  rules: z.array(CronRuleSchema).default([]),
});

export const ExecutionLogSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  ruleName: z.string(),
  triggeredAt: z.string(),
  status: z.enum(["success", "error"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
});

export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type CronRule = z.infer<typeof CronRuleSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;

// Partial rule for create (id generated server-side)
export const CreateRuleSchema = CronRuleSchema.omit({ id: true });
export type CreateRule = z.infer<typeof CreateRuleSchema>;

// Partial rule for update
export const UpdateRuleSchema = CronRuleSchema.partial().omit({ id: true });
export type UpdateRule = z.infer<typeof UpdateRuleSchema>;
