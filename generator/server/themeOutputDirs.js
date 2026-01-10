// generator/server/themeOutputDirs.js

import fs from "node:fs";
import path from "node:path";

export function ensureThemeOutputDirs(themeRoot) {
  const OUT_ACF = path.join(themeRoot, "acf-fields/partials/blocks");
  const OUT_FLEXI = path.join(themeRoot, "template-parts/flexi");
  const OUT_NAVBAR = path.join(themeRoot, "template-parts/navbar");
  const OUT_FOOTER = path.join(themeRoot, "template-parts/footer");

  for (const d of [OUT_ACF, OUT_FLEXI, OUT_NAVBAR, OUT_FOOTER]) {
    fs.mkdirSync(d, { recursive: true });
  }

  return { OUT_ACF, OUT_FLEXI, OUT_NAVBAR, OUT_FOOTER };
}
