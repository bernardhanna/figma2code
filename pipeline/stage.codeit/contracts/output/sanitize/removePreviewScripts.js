const {
  applyPatches,
  createPatch,
  getAttrValue,
  parseHtmlNodes,
} = require("../../utils/html");

const id = "output/sanitize/removePreviewScripts";

/** Substrings that identify preview/runtime helper scripts to remove. */
const PREVIEW_SCRIPT_MARKERS = [
  "cdn.tailwindcss.com",
  "window.tailwind.config",
  "nice-select2",
  "__TAILWIND_READY__",
  "tailwind:ready",
];

/** Script is video injection helper: contains both data-bg-type (or data-fill-type/data-media) and videoPreviewReady. */
const isVideoInjectionHelper = (text) => {
  const hasDataAttr = /data-bg-type|data-fill-type|data-media/.test(text);
  const hasVideoReady = /videoPreviewReady/.test(text);
  return hasDataAttr && hasVideoReady;
};

/** True if script (by src or textContent) matches any known preview helper. */
const isPreviewScript = (node, source) => {
  const src = getAttrValue(node?.attrs, "src");
  if (src != null && String(src).trim() !== "") {
    const s = String(src);
    if (PREVIEW_SCRIPT_MARKERS.some((m) => s.includes(m))) return true;
    if (/cdn\.tailwindcss\.com/.test(s)) return true;
    return false;
  }
  const text =
    node?.closeStart != null && node?.closeEnd != null
      ? source.slice(node.openEnd, node.closeStart)
      : "";
  const combined = String(text || "");
  if (PREVIEW_SCRIPT_MARKERS.some((m) => combined.includes(m))) return true;
  if (isVideoInjectionHelper(combined)) return true;
  return false;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source)
    return { html: source, changes: [], warnings: [], stats: { removed: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let removed = 0;

  nodes.forEach((node) => {
    if (!node || (node.tag || "").toLowerCase() !== "script") return;
    if (!isPreviewScript(node, source)) return;

    const start = node.openStart;
    const end = node.closeEnd != null ? node.closeEnd : node.openEnd;
    patches.push(createPatch(start, end, ""));
    changes.push({
      contractId: id,
      op: "removeScript",
      value: "preview helper script",
      reason: "Removed preview/runtime script (Tailwind CDN, nice-select2, video injection, etc.)",
    });
    removed += 1;
  });

  const output = applyPatches(source, patches);
  return {
    html: output,
    changes,
    warnings,
    stats: { removed },
  };
};

module.exports = {
  id,
  apply,
};
