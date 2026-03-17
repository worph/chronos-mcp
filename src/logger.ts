import fs from "fs";
import path from "path";
import { ExecutionLog } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "logs.json");
const DEBOUNCE_MS = 2000;

// In-memory store: ruleId → ExecutionLog[]
const store = new Map<string, ExecutionLog[]>();

let logRetention = 100;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setLogRetention(n: number): void {
  logRetention = n;
}

export function loadLogs(): void {
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    const parsed: Record<string, ExecutionLog[]> = JSON.parse(raw);
    for (const [ruleId, logs] of Object.entries(parsed)) {
      store.set(ruleId, logs);
    }
    console.log(`Loaded logs from ${LOG_FILE}`);
  } catch (err) {
    console.error("Failed to load logs:", err);
  }
}

function persistLogs(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const obj: Record<string, ExecutionLog[]> = {};
      for (const [ruleId, logs] of store.entries()) {
        obj[ruleId] = logs;
      }
      fs.writeFileSync(LOG_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to persist logs:", err);
    }
  }, DEBOUNCE_MS);
}

export function addLog(log: ExecutionLog): void {
  const logs = store.get(log.ruleId) ?? [];
  logs.unshift(log); // newest first
  if (logs.length > logRetention) {
    logs.splice(logRetention);
  }
  store.set(log.ruleId, logs);
  persistLogs();
}

export function getByRule(ruleId: string, limit = 50): ExecutionLog[] {
  return (store.get(ruleId) ?? []).slice(0, limit);
}

export function getAll(limit = 200): ExecutionLog[] {
  const all: ExecutionLog[] = [];
  for (const logs of store.values()) {
    all.push(...logs);
  }
  // Sort newest first
  all.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  return all.slice(0, limit);
}

export function clearByRule(ruleId: string): void {
  store.delete(ruleId);
  persistLogs();
}
