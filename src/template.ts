/**
 * Resolves {{variable}} placeholders in params objects.
 *
 * Supported variables:
 *   {{now}}        ISO 8601 datetime
 *   {{date}}       YYYY-MM-DD
 *   {{time}}       HH:MM:SS
 *   {{timestamp}}  Unix seconds
 *   {{year}}       YYYY
 *   {{month}}      MM
 *   {{day}}        DD
 *   {{hour}}       HH
 *   {{minute}}     MM
 *   {{second}}     SS
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function buildVars(): Record<string, string> {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());

  return {
    now: now.toISOString(),
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
    timestamp: String(Math.floor(now.getTime() / 1000)),
    year,
    month,
    day,
    hour,
    minute,
    second,
  };
}

function resolveString(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in vars ? vars[key] : match;
  });
}

function resolveValue(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") {
    return resolveString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, vars));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveValue(v, vars);
    }
    return result;
  }
  return value;
}

export function resolveParams(params: Record<string, unknown>): Record<string, unknown> {
  const vars = buildVars();
  return resolveValue(params, vars) as Record<string, unknown>;
}
