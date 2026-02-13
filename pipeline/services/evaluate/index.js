const fs = require("fs");
const path = require("path");

const {
  getAttrValue,
  getClassTokens,
  getNodeIdentifier,
  parseHtmlNodes,
} = require("../../stage.codeit/contracts/utils/html");

const MEDIA_TAGS = new Set([
  "img",
  "video",
  "picture",
  "source",
  "svg",
  "canvas",
  "iframe",
  "embed",
  "object",
]);

const INTERACTIVE_TAGS = new Set(["a", "button"]);

const HEIGHT_TOKEN = /^h-\[[0-9.]+rem\]$/;

const WRAP_ANOMALY_TOKENS = [
  "truncate",
  "whitespace-nowrap",
  "text-ellipsis",
];

const BREAKPOINTS = ["mobile", "tablet", "desktop"];

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const decodeSrcdocAttr = (value) =>
  String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const extractFragmentHtml = (previewHtml) => {
  const html = String(previewHtml || "");
  if (!html) return "";

  const iframeMatch =
    html.match(/<iframe[^>]*\bsrcdoc="([\s\S]*?)"/i) ||
    html.match(/<iframe[^>]*\bsrcdoc='([\s\S]*?)'/i);

  if (iframeMatch) {
    const srcdoc = decodeSrcdocAttr(iframeMatch[1] || "");
    const bodyMatch = srcdoc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? String(bodyMatch[1] || "").trim() : srcdoc.trim();
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? String(bodyMatch[1] || "").trim() : html.trim();
};

const buildChildrenMap = (nodes) => {
  const map = new Map();
  nodes.forEach((node, index) => {
    const parent = node.parentIndex;
    if (parent === null || parent === undefined) return;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(index);
  });
  return map;
};

const DATA_KEY_PROTECTED_HEIGHT = /hero|image|media|banner|bg/i;

const hasMediaDescendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node) continue;
    if (MEDIA_TAGS.has(node.tag)) return true;
    const kids = childrenMap.get(idx) || [];
    queue.push(...kids);
  }
  return false;
};

const hasAbsoluteInset0Descendant = (nodes, childrenMap, nodeIndex) => {
  const queue = [...(childrenMap.get(nodeIndex) || [])];
  while (queue.length) {
    const idx = queue.shift();
    const node = nodes[idx];
    if (!node?.attrs) {
      queue.push(...(childrenMap.get(idx) || []));
      continue;
    }
    const tokens = getClassTokens(node.attrs);
    const norm = tokens.map((t) => String(t).split(":").pop());
    const hasAbsolute = norm.some((t) => t === "absolute" || t === "fixed");
    const hasInset0 = norm.some((t) => /^inset-0$/.test(t) || /^inset-\[0\]$/.test(t));
    if (hasAbsolute && hasInset0) return true;
    queue.push(...(childrenMap.get(idx) || []));
  }
  return false;
};

/** True if node is protected (hero/media/container); do not report as fixed-height offender. */
const isProtectedForHeight = (node, nodes, childrenMap, nodeIndex) => {
  if (getAttrValue(node.attrs, "data-h-intent") === "fixed") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "");
  if (DATA_KEY_PROTECTED_HEIGHT.test(dataKey)) return true;
  const tokens = getClassTokens(node.attrs);
  const normalized = tokens.map((t) => String(t).split(":").pop());
  const overflowHidden = normalized.some((t) => t === "overflow-hidden");
  const rounded = normalized.some((t) => /^rounded/.test(t));
  if (overflowHidden && rounded) return true;
  const hasRelative = normalized.some((t) => t === "relative");
  if (hasRelative && hasAbsoluteInset0Descendant(nodes, childrenMap, nodeIndex)) return true;
  const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
  if (role === "img" || role === "presentation" || role === "figure") return true;
  return false;
};

const normalizeToken = (token) => String(token || "").split(":").pop();

const isHeightToken = (token) => HEIGHT_TOKEN.test(normalizeToken(token));

const isWidthToken = (token) => {
  const core = normalizeToken(token);
  return core.startsWith("w-") || core.startsWith("max-w-");
};

const hasOverflowX = (tokens, styleValue) => {
  if (tokens.some((token) => normalizeToken(token).startsWith("overflow-x-"))) {
    return true;
  }
  return /overflow-x\s*:\s*[^;]+/i.test(String(styleValue || ""));
};

const hasWrapAnomaly = (tokens) =>
  tokens.some((token) => WRAP_ANOMALY_TOKENS.includes(normalizeToken(token)));

const extractInnerText = (html, node) => {
  if (!node || node.closeStart === null) return "";
  const raw = html.slice(node.openEnd, node.closeStart);
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getSelectorHint = (node) => {
  const dataNodeId = getAttrValue(node.attrs, "data-node-id");
  if (dataNodeId) {
    return `[data-node-id="${String(dataNodeId).replace(/"/g, '\\"')}"]`;
  }
  const dataKey = getAttrValue(node.attrs, "data-key");
  if (dataKey) {
    return `[data-key="${String(dataKey).replace(/"/g, '\\"')}"]`;
  }
  return node?.tag || "node";
};

const readScoreFile = (slug, breakpoint) => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const dir = path.join(repoRoot, "fixtures.out", slug);
  if (!fs.existsSync(dir)) return null;

  const candidates = [];
  if (breakpoint) {
    candidates.push(path.join(dir, `score.${breakpoint}.json`));
  }
  if (breakpoint === "desktop") {
    candidates.push(path.join(dir, "score.json"));
  }
  candidates.push(path.join(dir, "score.all.json"));

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  return null;
};

const buildPixelDiffMetric = (slug, breakpoint) => {
  const score = readScoreFile(slug, breakpoint);
  if (score && typeof score.diffRatio === "number") {
    return {
      value: score.diffRatio,
      source: "visual-diff",
      diffPixels: Number(score.diffPixels || 0),
      totalPixels: Number(score.totalPixels || 0),
      at: score.at || null,
    };
  }
  if (score && score.results && breakpoint && score.results[breakpoint]?.score) {
    const bpScore = score.results[breakpoint].score;
    return {
      value: typeof bpScore.diffRatio === "number" ? bpScore.diffRatio : null,
      source: "visual-diff",
      diffPixels: Number(bpScore.diffPixels || 0),
      totalPixels: Number(bpScore.totalPixels || 0),
      at: bpScore.at || null,
    };
  }

  return { value: null, source: "placeholder", diffPixels: 0, totalPixels: 0, at: null };
};

const buildOffender = ({
  node,
  category,
  hint,
  impact,
  suggestedStage,
  suggestedContract,
  breakpoint = "all",
}) => ({
  nodeId: getAttrValue(node.attrs, "data-node-id") ||
    getAttrValue(node.attrs, "data-key") ||
    getNodeIdentifier(node),
  selector: getSelectorHint(node),
  breakpoint,
  category,
  impact,
  suggestedStage,
  suggestedContract,
  hint,
});

const evaluate = ({ slug, html }) => {
  const previewHtml = String(html || "");
  const fragmentHtml = extractFragmentHtml(previewHtml);
  const source = fragmentHtml || previewHtml;
  const nodes = parseHtmlNodes(source);
  const childrenMap = buildChildrenMap(nodes);

  let fixedHeightWrapperCount = 0;
  let overflowXCount = 0;
  let conflictingWidthCount = 0;
  let wrapAnomalyCount = 0;
  let imgMissingAltCount = 0;
  let interactiveNameMissingCount = 0;

  const offenders = [];

  nodes.forEach((node, nodeIndex) => {
    if (!node?.attrs) return;

    const tokens = getClassTokens(node.attrs);
    const style = getAttrValue(node.attrs, "style");

    if (
      tokens.some((token) => isHeightToken(token)) &&
      !MEDIA_TAGS.has(node.tag) &&
      !hasMediaDescendant(nodes, childrenMap, nodeIndex) &&
      !isProtectedForHeight(node, nodes, childrenMap, nodeIndex)
    ) {
      fixedHeightWrapperCount += 1;
      offenders.push(
        buildOffender({
          node,
          category: "layout",
          hint: "Fixed height on non-media wrapper",
          impact: 70,
          suggestedStage: "codeit",
          suggestedContract: "layout/height/removeFixedHeights",
        })
      );
    }

    if (hasOverflowX(tokens, style)) {
      overflowXCount += 1;
      offenders.push(
        buildOffender({
          node,
          category: "layout",
          hint: "Potential overflow-x containment",
          impact: 50,
          suggestedStage: "codeit",
          suggestedContract: null,
        })
      );
    }

    const widthTokens = tokens.filter((token) => isWidthToken(token));
    if (widthTokens.length > 1) {
      conflictingWidthCount += 1;
      offenders.push(
        buildOffender({
          node,
          category: "layout",
          hint: "Conflicting width utilities",
          impact: 60,
          suggestedStage: "codeit",
          suggestedContract: "layout/width/dedupeWidths",
        })
      );
    }

    if (hasWrapAnomaly(tokens)) {
      wrapAnomalyCount += 1;
      offenders.push(
        buildOffender({
          node,
          category: "type",
          hint: "Potential text wrap anomaly",
          impact: 40,
          suggestedStage: "improve",
          suggestedContract: null,
        })
      );
    }

    if (node.tag === "img") {
      const alt = getAttrValue(node.attrs, "alt");
      const ariaHidden = getAttrValue(node.attrs, "aria-hidden");
      const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
      if (
        ariaHidden !== "true" &&
        role !== "presentation" &&
        role !== "none" &&
        (!alt || !String(alt).trim())
      ) {
        imgMissingAltCount += 1;
        offenders.push(
          buildOffender({
            node,
            category: "a11y",
            hint: "Image missing alt text",
            impact: 80,
            suggestedStage: "improve",
            suggestedContract: null,
          })
        );
      }
    }

    if (INTERACTIVE_TAGS.has(node.tag)) {
      const ariaLabel = getAttrValue(node.attrs, "aria-label");
      const ariaLabelledBy = getAttrValue(node.attrs, "aria-labelledby");
      const title = getAttrValue(node.attrs, "title");
      const innerText = extractInnerText(source, node);
      if (!ariaLabel && !ariaLabelledBy && !title && !innerText) {
        interactiveNameMissingCount += 1;
        offenders.push(
          buildOffender({
            node,
            category: "a11y",
            hint: "Interactive element missing accessible name",
            impact: 90,
            suggestedStage: "improve",
            suggestedContract: null,
          })
        );
      }
    }
  });

  offenders.sort((a, b) => {
    if (b.impact !== a.impact) return b.impact - a.impact;
    if (a.nodeId < b.nodeId) return -1;
    if (a.nodeId > b.nodeId) return 1;
    return 0;
  });

  const baseLayout = {
    fixedHeightWrapperCount,
    overflowXCount,
    conflictingWidthCount,
  };

  const baseType = { wrapAnomalyCount };

  const baseA11y = {
    imgMissingAltCount,
    interactiveNameMissingCount,
    total: imgMissingAltCount + interactiveNameMissingCount,
  };

  const breakpoints = {};
  BREAKPOINTS.forEach((bp) => {
    breakpoints[bp] = {
      visual: {
        pixelDiffRatio: buildPixelDiffMetric(slug, bp),
      },
      layout: { ...baseLayout },
      type: { ...baseType },
      a11y: { ...baseA11y },
    };
  });

  return {
    metrics: {
      breakpoints,
      offenders,
    },
    diagnostics: {
      offendersCount: offenders.length,
      source: fragmentHtml ? "fragment" : "preview",
    },
  };
};

module.exports = {
  evaluate,
};
