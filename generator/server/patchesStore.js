// generator/server/patchesStore.js

import fs from "node:fs";
import path from "node:path";

export function ensurePatchesFile(outDir) {
  const p = path.join(outDir, "patches.json");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify({}, null, 2), "utf8");
  }
  return p;
}
