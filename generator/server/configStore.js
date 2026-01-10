// generator/server/configStore.js

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./runtimePaths.js";

const CONFIG_PATH = path.resolve(ROOT, "./config.json");

function defaultConfig() {
  return { themeRoot: path.resolve(ROOT, "../theme") };
}

export function readConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      // fallthrough
    }
  }
  return defaultConfig();
}

export function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

let CONFIG = readConfig();

export function getConfig() {
  return CONFIG;
}

export function setConfig(nextCfg) {
  CONFIG = { ...CONFIG, ...(nextCfg || {}) };
  writeConfig(CONFIG);
  return CONFIG;
}
