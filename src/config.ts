import fs from "fs";
import path from "path";
import { AppConfig, AppConfigSchema } from "./types";

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), "data", "config.json");

let _config: AppConfig = AppConfigSchema.parse({});

export function getConfig(): AppConfig {
  return _config;
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`Config file not found at ${CONFIG_PATH}, using defaults`);
    _config = AppConfigSchema.parse({});
    return _config;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    _config = AppConfigSchema.parse(parsed);
    console.log(`Config loaded from ${CONFIG_PATH} (${_config.rules.length} rules)`);
    return _config;
  } catch (err) {
    console.error("Failed to load config:", err);
    throw err;
  }
}

export function saveConfig(config: AppConfig): void {
  _config = config;
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  console.log(`Config saved to ${CONFIG_PATH}`);
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const updated = AppConfigSchema.parse({ ..._config, ...partial });
  saveConfig(updated);
  return updated;
}
