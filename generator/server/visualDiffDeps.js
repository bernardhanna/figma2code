// generator/server/visualDiffDeps.js

export async function loadCompareDeps() {
  try {
    const [{ PNG }, pixelmatchMod, playwrightMod] = await Promise.all([
      import("pngjs"),
      import("pixelmatch"),
      import("playwright"),
    ]);
    const pixelmatch = pixelmatchMod.default || pixelmatchMod;
    const chromium = playwrightMod.chromium;
    if (!PNG || !pixelmatch || !chromium) throw new Error("Missing compare deps exports");
    return { PNG, pixelmatch, chromium };
  } catch (e) {
    const msg =
      "Visual diff deps missing. Install from generator/:\n" +
      "  npm i -D playwright pixelmatch pngjs\n" +
      "  npx playwright install\n" +
      "Error: " +
      String(e?.message || e);
    throw new Error(msg);
  }
}
