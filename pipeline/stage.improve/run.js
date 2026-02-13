const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { PIPELINE_ARTIFACT_SCHEMA_VERSION, assertValidArtifact } = require(
  "../artifacts/validate"
);
const { evaluate: defaultEvaluate } = require("../services/evaluate");
const {
  getArtifactPath,
  readInputArtifact,
  writeArtifact,
  writeHistorySnapshot,
} = require("./io");
const config = require("./stage.config");
const {
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
} = require("../stage.codeit/contracts/utils/html");
const { applyPatchPlan, validatePatch } = require("./utilities/patches");
const {
  isProtectedMediaNode,
  canProveClipping,
  isHeightTokenGuarded,
  guardedHeightPatchFilter,
} = require("./utilities/heightGuard");
const { createReporter, IMPROVE } = require("../progress");

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const HEIGHT_TOKEN = /^(min-h|h)-\[[0-9.]+rem\]$/;
const OVERFLOW_X_TOKEN = /^overflow-x-/;

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
  "figure",
]);

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "textarea", "select", "label"]);

const nodeIdForNode = (node) =>
  getAttrValue(node.attrs, "data-node-id") ||
  getAttrValue(node.attrs, "data-key") ||
  null;

const selectorForNode = (node) => {
  const dataNodeId = getAttrValue(node.attrs, "data-node-id");
  if (dataNodeId) {
    return `[data-node-id="${String(dataNodeId).replace(/"/g, '\\"')}"]`;
  }
  const dataKey = getAttrValue(node.attrs, "data-key");
  if (dataKey) {
    return `[data-key="${String(dataKey).replace(/"/g, '\\"')}"]`;
  }
  return "";
};

const labelFromNode = (node) => {
  const key = getAttrValue(node.attrs, "data-key");
  if (key) {
    const cleaned = String(key)
      .replace(/[:#]/g, " ")
      .replace(/[_-]+/g, " ")
      .trim();
    if (cleaned) return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1);
  }
  if (node.tag === "button") return "Button";
  if (node.tag === "a") return "Link";
  return "Action";
};

const normalizeToken = (token) => String(token || "").split(":").pop();

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

const extractInnerText = (html, node) => {
  if (!node || node.closeStart === null) return "";
  const raw = String(html || "").slice(node.openEnd, node.closeStart);
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const collectNodeMap = (html) => {
  const nodes = parseHtmlNodes(html);
  const childrenMap = buildChildrenMap(nodes);
  const map = new Map();

  nodes.forEach((node, index) => {
    if (!node?.attrs) return;
    const id = nodeIdForNode(node);
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, {
        node,
        nodeIndex: index,
        tokens: getClassTokens(node.attrs),
        innerText: extractInnerText(html, node),
        hasMedia: hasMediaDescendant(nodes, childrenMap, index),
        context: { nodes, childrenMap, nodeIndex: index },
      });
    }
  });
  return { nodeMap: map, nodes, childrenMap };
};

const buildPatch = (nodeId, selector, iteration) => ({
  nodeId,
  selector,
  stage: "improve",
  iteration,
  ops: {
    classAdd: [],
    classRemove: [],
    classReplace: {},
    attrAdd: {},
    attrRemove: [],
  },
});

const recordLedger = (entry, op, value, reason) => {
  const key = `${op}:${value}`;
  if (entry.seenOps.has(key)) return;
  entry.seenOps.add(key);
  entry.ledgerEntries.push({
    contractId: "improve",
    nodeId: entry.patch.nodeId,
    selector: entry.patch.selector,
    op,
    value,
    reason,
  });
};

const addClassRemove = (entry, token, reason) => {
  if (!token) return;
  if (!entry.patch.ops.classRemove.includes(token)) {
    entry.patch.ops.classRemove.push(token);
  }
  recordLedger(entry, "classRemove", token, reason);
};

const addAttrAdd = (entry, key, value, reason) => {
  const k = String(key || "").trim();
  if (!k) return;
  if (!entry.patch.ops.attrAdd[k]) {
    entry.patch.ops.attrAdd[k] = String(value ?? "");
  }
  recordLedger(entry, "attrAdd", `${k}=${entry.patch.ops.attrAdd[k]}`, reason);
};

const addAttrRemove = (entry, key, reason) => {
  const k = String(key || "").trim();
  if (!k) return;
  if (!entry.patch.ops.attrRemove.includes(k)) {
    entry.patch.ops.attrRemove.push(k);
  }
  recordLedger(entry, "attrRemove", k, reason);
};

const generateDeterministicPlan = ({
  html,
  offenders,
  nodeIndex,
  iteration,
  limit,
  getMeasurements = () => ({}),
}) => {
  const { nodeMap, nodes, childrenMap } = collectNodeMap(html);
  const entries = new Map();
  const diagnostics = [];
  const warnings = [];
  let clippingSkipped = false;

  const ensureEntry = (nodeId, selector) => {
    if (!entries.has(nodeId)) {
      entries.set(nodeId, {
        patch: buildPatch(nodeId, selector, iteration),
        ledgerEntries: [],
        seenOps: new Set(),
      });
    }
    const entry = entries.get(nodeId);
    if (selector && !entry.patch.selector) entry.patch.selector = selector;
    return entry;
  };

  const topOffenders = offenders.slice(0, limit);

  topOffenders.forEach((offender) => {
    const nodeId = offender.nodeId;
    if (!nodeId) return;
    const nodeEntry = nodeMap.get(nodeId);
    if (!nodeEntry) {
      warnings.push(`Missing node for offender ${nodeId}.`);
      return;
    }

    const selector =
      offender.selector ||
      (nodeIndex && Array.isArray(nodeIndex[nodeId]) ? nodeIndex[nodeId][0] : "") ||
      selectorForNode(nodeEntry.node);

    const patchEntry = ensureEntry(nodeId, selector);
    const tokens = nodeEntry.tokens;

    let note = "";

    if (offender.category === "layout" && /fixed height/i.test(offender.hint || "")) {
      if (MEDIA_TAGS.has(nodeEntry.node.tag)) return;
      if (nodeEntry.hasMedia) return;
      if (isProtectedMediaNode(nodeEntry.node, nodeEntry.context)) return;

      const measurements = getMeasurements(nodeId);
      if (!canProveClipping(nodeEntry.node, measurements)) {
        if (!clippingSkipped) {
          warnings.push("clipping check unavailable; skipped height removal");
          clippingSkipped = true;
        }
        return;
      }

      const removals = tokens.filter((token) => isHeightTokenGuarded(token) || HEIGHT_TOKEN.test(normalizeToken(token)));
      removals.forEach((token) => {
        addClassRemove(
          patchEntry,
          token,
          `Patch: removed ${token} (proven clipping)`
        );
      });
      if (removals.length) {
        note = `Removed fixed height classes (proven clipping): ${removals.join(", ")}`;
      }
    }

    if (!note && offender.category === "layout" && /overflow-x/i.test(offender.hint || "")) {
      const removals = tokens.filter((token) => OVERFLOW_X_TOKEN.test(normalizeToken(token)));
      removals.forEach((token) => {
        addClassRemove(
          patchEntry,
          token,
          `Patch: removed ${token} (overflow containment)`
        );
      });
      if (removals.length) {
        note = `Removed overflow-x classes: ${removals.join(", ")}`;
      }
    }

    if (
      !note &&
      offender.category === "a11y" &&
      /interactive element/i.test(offender.hint || "")
    ) {
      const ariaLabel = getAttrValue(nodeEntry.node.attrs, "aria-label");
      const ariaLabelledBy = getAttrValue(nodeEntry.node.attrs, "aria-labelledby");
      const title = getAttrValue(nodeEntry.node.attrs, "title");
      const innerText = nodeEntry.innerText || "";
      if (!ariaLabel && !ariaLabelledBy && !title && !innerText) {
        const label = labelFromNode(nodeEntry.node);
        addAttrAdd(
          patchEntry,
          "aria-label",
          label,
          `Patch: added aria-label="${label}" (missing accessible name)`
        );
        note = `Added aria-label="${label}"`;
      }
    }

    if (!note && offender.category === "a11y" && /image missing alt/i.test(offender.hint || "")) {
      const ariaHidden = getAttrValue(nodeEntry.node.attrs, "aria-hidden");
      const alt = getAttrValue(nodeEntry.node.attrs, "alt");
      if (ariaHidden !== "true" && (!alt || !String(alt).trim())) {
        addAttrAdd(
          patchEntry,
          "aria-hidden",
          "true",
          'Patch: added aria-hidden="true" (decorative image)'
        );
        note = 'Added aria-hidden="true"';
      }
    }

    if (note) {
      diagnostics.push({
        iteration,
        nodeId,
        selector: patchEntry.patch.selector,
        offender,
        ops: patchEntry.patch.ops,
        note,
      });
    }
  });

  return {
    entries: Array.from(entries.values()),
    diagnostics,
    warnings,
  };
};

const selectPatchProvider = (stageConfig, generatePatchPlanFn) => {
  if (typeof generatePatchPlanFn === "function") {
    return { id: "custom", generate: generatePatchPlanFn };
  }
  const provider = String(process.env.IMPROVE_PROVIDER || stageConfig.provider || "rules")
    .trim()
    .toLowerCase();
  if (provider === "ai") {
    return {
      id: "ai",
      generate: () => ({
        entries: [],
        diagnostics: [],
        warnings: ["AI provider not configured; no patches generated."],
      }),
    };
  }
  return {
    id: "rules",
    generate: generateDeterministicPlan,
  };
};

const formatProviderLabel = (providerId) => {
  const id = String(providerId || "").trim().toLowerCase();
  if (!id) return "";
  if (id === "ai") return "AI";
  if (id === "rules") return "Rules";
  return id.slice(0, 1).toUpperCase() + id.slice(1);
};

const resolveGateConfig = (gate) => {
  const base = isPlainObject(gate) ? gate : {};
  const maxVisualDeltaRaw = process.env.IMPROVE_VISUAL_TOLERANCE ?? base.maxVisualDelta;
  const maxVisualDelta = Number(maxVisualDeltaRaw);
  const requireImprovementRaw = process.env.IMPROVE_REQUIRE_IMPROVEMENT;
  return {
    enabled: base.enabled !== false,
    maxVisualDelta: Number.isFinite(maxVisualDelta) ? maxVisualDelta : 0,
    requireImprovement:
      typeof requireImprovementRaw === "string"
        ? requireImprovementRaw !== "0"
        : base.requireImprovement !== false,
  };
};

/**
 * Deterministic fallback score when visual diff is missing.
 * 100 - 2*overflowX - 1*conflictingWidth - 2*fixedHeightWrapper (no duplicate/proven counts in metrics).
 */
const buildFallbackScore = (metrics) => {
  if (!metrics?.breakpoints) return 100;
  const bp = metrics.breakpoints.desktop || metrics.breakpoints.mobile || metrics.breakpoints.tablet;
  const layout = bp?.layout || {};
  const overflowX = Number(layout.overflowXCount) || 0;
  const conflictingWidth = Number(layout.conflictingWidthCount) || 0;
  const fixedHeight = Number(layout.fixedHeightWrapperCount) || 0;
  const score = 100 - 2 * overflowX - 1 * conflictingWidth - 2 * fixedHeight;
  return Math.max(0, Math.min(100, score));
};

const assessScoreGate = (before, after, gate) => {
  const breakpoints = ["mobile", "tablet", "desktop"];
  const deltas = [];

  breakpoints.forEach((bp) => {
    const beforeRatio = before?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const afterRatio = after?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    if (typeof beforeRatio !== "number" || typeof afterRatio !== "number") return;
    deltas.push({ bp, delta: afterRatio - beforeRatio, before: beforeRatio, after: afterRatio });
  });

  if (!deltas.length) {
    const fallbackBefore = buildFallbackScore(before);
    const fallbackAfter = buildFallbackScore(after);
    if (fallbackAfter < fallbackBefore) {
      return {
        accept: false,
        reason: `Score gate (fallback): regression score ${fallbackBefore} → ${fallbackAfter}.`,
      };
    }
    if (gate.requireImprovement && fallbackAfter <= fallbackBefore) {
      return { accept: false, reason: "Score gate (fallback): no improvement detected." };
    }
    return { accept: true, reason: "Score gate passed (fallback score)." };
  }

  const regression = deltas.find((entry) => entry.delta > gate.maxVisualDelta);
  if (regression) {
    return {
      accept: false,
      reason: `Score gate: regression on ${regression.bp} by +${regression.delta.toFixed(4)}.`,
    };
  }

  const improved = deltas.some((entry) => entry.delta < -gate.maxVisualDelta);
  if (gate.requireImprovement && !improved) {
    return { accept: false, reason: "Score gate: no visual improvement detected." };
  }

  return { accept: true, reason: "Score gate passed." };
};

const resolveHtmlEnvelope = (previewHtml) => {
  const html = String(previewHtml || "");
  const iframeMatch =
    html.match(/<iframe[^>]*\bsrcdoc="([\s\S]*?)"/i) ||
    html.match(/<iframe[^>]*\bsrcdoc='([\s\S]*?)'/i);
  if (!iframeMatch) {
    const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) {
      return {
        fragment: html,
        apply: (fragment) => String(fragment || ""),
      };
    }
    const bodyAttrs = bodyMatch[1] || "";
    const fragment = bodyMatch[2] || "";
    return {
      fragment,
      apply: (fragmentHtml) =>
        html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, () => {
          return `<body${bodyAttrs}>${String(fragmentHtml || "")}</body>`;
        }),
    };
  }

  const decodeSrcdoc = (value) =>
    String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");

  const encodeSrcdoc = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const srcdocEscaped = iframeMatch[1] || "";
  const srcdoc = decodeSrcdoc(srcdocEscaped);
  const bodyMatch = srcdoc.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  const bodyAttrs = bodyMatch ? bodyMatch[1] || "" : "";
  const fragment = bodyMatch ? bodyMatch[2] || "" : srcdoc;

  return {
    fragment,
    apply: (fragmentHtml) => {
      const next = bodyMatch
        ? srcdoc.replace(/<body[^>]*>[\s\S]*?<\/body>/i, () => {
            return `<body${bodyAttrs}>${String(fragmentHtml || "")}</body>`;
          })
        : String(fragmentHtml || "");
      const encoded = encodeSrcdoc(next);
      return html.replace(/(<iframe[^>]*\bsrcdoc=)(["'])([\s\S]*?)\2/i, (match, pre, quote, value) => {
        const start = match.indexOf(value);
        if (start === -1) return match;
        return match.slice(0, start) + encoded + match.slice(start + value.length);
      });
    },
  };
};

const buildDeltas = (baseline, current) => {
  if (!baseline || !current) return {};
  const deltas = {};

  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const before = baseline?.breakpoints?.[bp];
    const after = current?.breakpoints?.[bp];
    if (!before || !after) return;

    const beforeRatio = before?.visual?.pixelDiffRatio?.value;
    const afterRatio = after?.visual?.pixelDiffRatio?.value;

    deltas[bp] = {
      visual: {
        pixelDiffRatio: {
          before: typeof beforeRatio === "number" ? beforeRatio : null,
          after: typeof afterRatio === "number" ? afterRatio : null,
          delta:
            typeof beforeRatio === "number" && typeof afterRatio === "number"
              ? afterRatio - beforeRatio
              : null,
        },
      },
      layout: {
        fixedHeightWrapperCount:
          (after?.layout?.fixedHeightWrapperCount || 0) -
          (before?.layout?.fixedHeightWrapperCount || 0),
        overflowXCount:
          (after?.layout?.overflowXCount || 0) - (before?.layout?.overflowXCount || 0),
        conflictingWidthCount:
          (after?.layout?.conflictingWidthCount || 0) -
          (before?.layout?.conflictingWidthCount || 0),
      },
      type: {
        wrapAnomalyCount:
          (after?.type?.wrapAnomalyCount || 0) - (before?.type?.wrapAnomalyCount || 0),
      },
      a11y: {
        total: (after?.a11y?.total || 0) - (before?.a11y?.total || 0),
      },
    };
  });

  return deltas;
};

const summarizeLedger = (entries) => {
  const groups = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const reason = String(entry?.reason || "Patch updates").trim() || "Patch updates";
    if (!groups.has(reason)) {
      groups.set(reason, { reason, count: 0, nodes: new Set() });
    }
    const group = groups.get(reason);
    group.count += 1;
    if (entry?.nodeId) group.nodes.add(entry.nodeId);
  });
  return Array.from(groups.values()).map((group) => ({
    reason: group.reason,
    count: group.count,
    nodes: Array.from(group.nodes),
  }));
};

const formatFixLine = (group) => {
  const reason = String(group?.reason || "").trim();
  if (!reason) return "";
  const nodes = Array.isArray(group?.nodes) ? group.nodes : [];
  if (!nodes.length) return reason;
  const list = nodes.slice(0, 4).join(", ");
  const suffix = nodes.length > 4 ? ", …" : "";
  return `${reason} (nodes: ${list}${suffix})`;
};

const formatRatio = (value) =>
  typeof value === "number" ? value.toFixed(4) : "—";

const formatDelta = (value) => {
  if (typeof value !== "number") return "—";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(4)}`;
};

const hashInput = (artifact) => {
  const json = JSON.stringify(artifact || {});
  return crypto.createHash("sha256").update(json).digest("hex");
};

const readExistingArtifact = (slug) => {
  const existingPath = getArtifactPath(slug);
  if (!fs.existsSync(existingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(existingPath, "utf8"));
  } catch {
    return null;
  }
};

const run = async ({
  slug,
  evaluateFn = defaultEvaluate,
  readInputArtifactFn = readInputArtifact,
  readExistingArtifactFn = readExistingArtifact,
  writeArtifactFn = writeArtifact,
  writeHistorySnapshotFn = writeHistorySnapshot,
  generatePatchPlanFn,
  configOverride,
  log = console.log,
} = {}) => {
  const logFn = typeof log === "function" ? log : () => {};
  const reporter = createReporter(logFn);
  const stageConfig = configOverride ? { ...config, ...configOverride } : config;

  reporter.succeed(IMPROVE.LOAD_ARTIFACT);
  const inputArtifact = readInputArtifactFn(slug);
  assertValidArtifact(inputArtifact);

  const existing = readExistingArtifactFn(slug);
  const previousHistory = Array.isArray(existing?.diagnostics?.history)
    ? existing.diagnostics.history
    : [];
  const previousPatches = Array.isArray(existing?.patches) ? existing.patches : [];
  const iteration = Number(existing?.diagnostics?.iteration || 0) + 1;

  const baseHtml = typeof inputArtifact.html === "string" ? inputArtifact.html : "";
  const envelope = resolveHtmlEnvelope(baseHtml);
  const baseFragment = envelope.fragment;
  const currentFragment = applyPatchPlan(baseFragment, previousPatches);
  const currentHtml = envelope.apply(currentFragment);

  reporter.succeed(IMPROVE.EVALUATE_OFFENDERS);
  const evaluationBefore = evaluateFn({ slug, html: currentHtml, artifact: inputArtifact });
  const offenders = Array.isArray(evaluationBefore?.metrics?.offenders)
    ? evaluationBefore.metrics.offenders
    : [];

  const maxOffendersRaw =
    process.env.IMPROVE_MAX_OFFENDERS ?? stageConfig.maxOffenders ?? 25;
  const maxOffenders = Math.max(1, Number(maxOffendersRaw) || 25);

  reporter.succeed(IMPROVE.SELECT_OFFENDERS);
  const topOffenders = offenders.slice(0, maxOffenders);

  reporter.succeed(IMPROVE.GENERATE_PLAN);
  const provider = selectPatchProvider(stageConfig, generatePatchPlanFn);
  const providerLabel = formatProviderLabel(provider.id);
  const planResult = provider.generate({
    html: currentFragment,
    offenders: topOffenders,
    nodeIndex: inputArtifact.nodeIndex,
    iteration,
    limit: maxOffenders,
  });

  const planEntries = Array.isArray(planResult?.entries)
    ? planResult.entries
    : Array.isArray(planResult?.patches)
      ? planResult.patches.map((patch) => ({
          patch,
          ledgerEntries: [],
          seenOps: new Set(),
        }))
      : [];

  const warnings = [];
  const errors = [];

  if (Array.isArray(planResult?.warnings) && planResult.warnings.length) {
    warnings.push(
      ...planResult.warnings.map((message) => ({
        message: String(message),
      }))
    );
  }

  const { nodeMap: guardNodeMap } = collectNodeMap(currentFragment);
  const guardContext = {
    nodeMap: guardNodeMap,
    isProtected: isProtectedMediaNode,
    canProveClipping,
    getMeasurements: () => ({}),
  };
  const { accepted: heightAccepted, rejectedWithReasons: heightRejected } =
    guardedHeightPatchFilter(planEntries, guardContext);

  const acceptedEntries = [];
  const rejectedEntries = [];

  heightRejected.forEach(({ entry, reason, nodeId }) => {
    rejectedEntries.push({
      patch: entry.patch,
      reason,
      nodeId,
    });
  });

  reporter.succeed(IMPROVE.VALIDATE_PLAN);
  heightAccepted.forEach((entry) => {
    const result = validatePatch(entry.patch);
    if (!result.valid) {
      const reason = String(result.reason || "").trim() || "Patch has no bounded ops.";
      rejectedEntries.push({ patch: entry.patch, reason });
      return;
    }
    const sanitizedPatch = result.patch;
    if (!sanitizedPatch.selector) {
      sanitizedPatch.selector = entry.patch.selector || "";
    }
    entry.ledgerEntries.forEach((ledgerEntry) => {
      ledgerEntry.nodeId = sanitizedPatch.nodeId;
      if (!ledgerEntry.selector) ledgerEntry.selector = sanitizedPatch.selector;
    });
    acceptedEntries.push({
      patch: sanitizedPatch,
      ledgerEntries: entry.ledgerEntries,
    });
  });

  rejectedEntries.forEach((entry) => {
    warnings.push({
      message: `Rejected patch for ${entry.patch?.nodeId || entry.nodeId || "unknown"}: ${entry.reason || "unknown"}`,
    });
  });

  reporter.succeed(IMPROVE.APPLY_PATCHES);
  const acceptedPatches = acceptedEntries.map((entry) => entry.patch);
  const patchedFragment = acceptedPatches.length
    ? applyPatchPlan(currentFragment, acceptedPatches)
    : currentFragment;
  const patchedHtml = envelope.apply(patchedFragment);

  reporter.succeed(IMPROVE.EVALUATE_VERIFY);
  const evaluationAfter = acceptedPatches.length
    ? evaluateFn({ slug, html: patchedHtml, artifact: inputArtifact })
    : evaluationBefore;

  reporter.succeed(IMPROVE.ACCEPT_GATE);
  const gate = resolveGateConfig(stageConfig.gate);
  let gateAccepted = true;
  let gateMessage = "";
  if (acceptedPatches.length && gate.enabled) {
    const gateResult = assessScoreGate(
      evaluationBefore?.metrics,
      evaluationAfter?.metrics,
      gate
    );
    if (!gateResult.accept) {
      gateAccepted = false;
      gateMessage = gateResult.reason || "";
      warnings.push({ message: gateResult.reason });
      rejectedEntries.push(
        ...acceptedEntries.map((entry) => ({
          patch: entry.patch,
          reason: gateResult.reason,
        }))
      );
    }
  }

  const finalEvaluation = gateAccepted ? evaluationAfter : evaluationBefore;
  const finalPatches = gateAccepted
    ? [...previousPatches, ...acceptedPatches]
    : [...previousPatches];
  const ledgerEntries = gateAccepted
    ? acceptedEntries.flatMap((entry) => entry.ledgerEntries)
    : [];

  const patchesProposed = planEntries.length;
  const patchesAccepted = gateAccepted ? acceptedEntries.length : 0;
  const patchesRejected = rejectedEntries.length;
  const gateRejected = !gateAccepted && acceptedEntries.length > 0;

  const rejectionReasonGroups = [];
  const reasonToEntries = new Map();
  rejectedEntries.forEach((entry) => {
    const r = String(entry?.reason || "unknown").trim();
    if (!reasonToEntries.has(r)) reasonToEntries.set(r, []);
    reasonToEntries.get(r).push(entry);
  });
  reasonToEntries.forEach((entries, reason) => {
    const nodeIds = [...new Set(entries.map((e) => e.patch?.nodeId || e.nodeId).filter(Boolean))];
    rejectionReasonGroups.push({ reason, count: entries.length, nodeIds });
  });

  reporter.succeed(IMPROVE.WRITE_ARTIFACT);

  const deltas = buildDeltas(evaluationBefore?.metrics, finalEvaluation?.metrics);
  const baseDiagnostics = isPlainObject(inputArtifact.diagnostics)
    ? inputArtifact.diagnostics
    : {};

  const patchPlanSummary = {
    offendersFound: offenders.length,
    selectedOffenders: topOffenders.length,
    generated: planEntries.length,
    accepted: patchesAccepted,
    rejected: patchesRejected,
    provider: provider.id,
    gateAccepted,
    gateMessage: gateMessage || undefined,
  };

  const historyEntry = {
    iteration,
    createdAt: new Date().toISOString(),
    inputHash: hashInput(inputArtifact),
    acceptedPatches: acceptedPatches,
    rejectedPatches: rejectedEntries,
    scoreBefore: evaluationBefore?.metrics || {},
    scoreAfter: finalEvaluation?.metrics || {},
    patchPlan: patchPlanSummary,
  };

  const artifact = {
    schemaVersion: PIPELINE_ARTIFACT_SCHEMA_VERSION,
    slug,
    stage: "improve",
    createdAt: new Date().toISOString(),
    html: baseHtml,
    patches: finalPatches,
    assets: isPlainObject(inputArtifact.assets) ? inputArtifact.assets : {},
    diagnostics: {
      ...baseDiagnostics,
      iteration,
      provider: provider.id,
      warnings,
      errors,
      ledger: ledgerEntries,
      patchPlan: {
        offendersFound: offenders.length,
        selectedOffenders: topOffenders.length,
        generated: planEntries.length,
        accepted: gateAccepted ? acceptedEntries.length : 0,
        rejected: rejectedEntries.length,
        provider: provider.id,
        gateAccepted,
        gateMessage: gateMessage || undefined,
      },
      improveSummary: `Offenders: ${offenders.length} | Proposed: ${patchesProposed} | Accepted: ${patchesAccepted} | Rejected: ${patchesRejected} | Provider: ${provider.id}`,
      offendersFoundButRejected:
        offenders.length > 0 && patchesAccepted === 0,
      offendersFoundButGateRejected: gateRejected,
      noOffendersFound: offenders.length === 0,
      rejectionReasonGroups,
      planDiagnostics: Array.isArray(planResult?.diagnostics) ? planResult.diagnostics : [],
      history: [...previousHistory, historyEntry],
    },
    metrics: (() => {
      const base = isPlainObject(finalEvaluation?.metrics) ? finalEvaluation.metrics : {};
      const fallbackScore = buildFallbackScore(base);
      return {
        ...base,
        deltas,
        iteration,
        fallbackScore,
      };
    })(),
  };

  if (isPlainObject(inputArtifact.nodeIndex)) {
    artifact.nodeIndex = inputArtifact.nodeIndex;
  }

  assertValidArtifact(artifact);
  writeArtifactFn(slug, artifact);
  if (typeof writeHistorySnapshotFn === "function") {
    writeHistorySnapshotFn(slug, iteration, historyEntry);
  }

  reporter.succeed(IMPROVE.DONE);

  const noOffendersMessage = offenders.length === 0 ? "No offenders found." : undefined;
  const noPatchesAcceptedMessage =
    offenders.length > 0 && patchesAccepted === 0
      ? gateRejected
        ? "Offenders found but rejected by score gate."
        : "Offenders found but no patches accepted (validation or guards)."
      : undefined;

  reporter.writeImproveSummary({
    offendersFound: offenders.length,
    patchesProposed,
    patchesAccepted,
    patchesRejected,
    rejectionReasonGroups,
    providerLabel,
    noOffendersMessage,
    noPatchesAcceptedMessage,
  });

  const fixGroups = summarizeLedger(ledgerEntries).sort((a, b) => b.count - a.count);
  const fallbackScoreVal = buildFallbackScore(finalEvaluation?.metrics);
  const scorePerBreakpoint = {};
  ["mobile", "tablet", "desktop"].forEach((bp) => {
    const score = finalEvaluation?.metrics?.breakpoints?.[bp]?.visual?.pixelDiffRatio?.value;
    const delta = deltas?.[bp]?.visual?.pixelDiffRatio?.delta;
    scorePerBreakpoint[bp] =
      typeof score === "number"
        ? `${formatRatio(score)} (delta ${formatDelta(delta)})`
        : "—";
  });

  reporter.writeSummary({
    errors,
    warnings,
    fixCount: ledgerEntries.length,
    fixGroups,
    formatFixLine: (group) => formatFixLine(group),
    artifactsPath: getArtifactPath(slug),
    scorePerBreakpoint,
    fallbackScore:
      typeof finalEvaluation?.metrics?.breakpoints?.desktop?.visual?.pixelDiffRatio?.value !== "number"
        ? fallbackScoreVal
        : undefined,
  });

  return artifact;
};

module.exports = {
  run,
};
