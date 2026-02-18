import fs from "node:fs";
import path from "node:path";

import { computeElementDiff } from "../auto/elementDiff.js";
import { evaluateImprovement } from "../server/refineGate.js";
import {
  mergePatchMaps,
  patchesFilePath,
  readPatchMap,
  writePatchMap,
} from "./refineByDiff.js";

const MEDIA_TAGS = new Set(["img", "video", "picture", "source", "svg", "canvas", "iframe"]);

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function classTokens(className) {
  return String(className || "")
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function fromTokenArray(tokens) {
  return Array.from(new Set(asArr(tokens).filter(Boolean)));
}

function hasBoundedOps(ops) {
  const o = ops && typeof ops === "object" ? ops : {};
  return (
    (Array.isArray(o.classAdd) && o.classAdd.length > 0) ||
    (Array.isArray(o.classRemove) && o.classRemove.length > 0) ||
    (o.classReplace && Object.keys(o.classReplace).length > 0) ||
    (o.style && Object.keys(o.style).length > 0)
  );
}

function withPrefix(token, core) {
  const parts = String(token || "").split(":");
  if (parts.length <= 1) return core;
  parts.pop();
  return `${parts.join(":")}:${core}`;
}

function parseArbitraryRem(token, families) {
  const parts = String(token || "").split(":");
  const core = parts[parts.length - 1] || "";
  for (const family of families) {
    const m = core.match(new RegExp(`^${family}-\\[([0-9.]+)rem\\]$`));
    if (m) {
      return { family, value: Number(m[1]), token: String(token || "") };
    }
  }
  return null;
}

function formatRem(value) {
  const n = Math.max(0, Number(value || 0));
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function containsBox(outer, inner) {
  if (!outer || !inner) return false;
  return (
    Number(inner.x || 0) >= Number(outer.x || 0) &&
    Number(inner.y || 0) >= Number(outer.y || 0) &&
    Number(inner.x || 0) + Number(inner.w || 0) <= Number(outer.x || 0) + Number(outer.w || 0) &&
    Number(inner.y || 0) + Number(inner.h || 0) <= Number(outer.y || 0) + Number(outer.h || 0)
  );
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(Number(a.x || 0), Number(b.x || 0));
  const y1 = Math.max(Number(a.y || 0), Number(b.y || 0));
  const x2 = Math.min(Number(a.x || 0) + Number(a.w || 0), Number(b.x || 0) + Number(b.w || 0));
  const y2 = Math.min(Number(a.y || 0) + Number(a.h || 0), Number(b.y || 0) + Number(b.h || 0));
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return w * h;
}

function centroidForOffenders(offenders) {
  const rows = asArr(offenders);
  let wx = 0;
  let wy = 0;
  let total = 0;
  for (const o of rows) {
    const b = o?.bbox;
    if (!b) continue;
    const weight = Math.max(1, Number(o?.pixels || 0));
    wx += (Number(b.x || 0) + Number(b.w || 0) / 2) * weight;
    wy += (Number(b.y || 0) + Number(b.h || 0) / 2) * weight;
    total += weight;
  }
  if (!total) return null;
  return { x: wx / total, y: wy / total };
}

function distanceScore(nodeBox, centroid) {
  if (!nodeBox || !centroid) return 0;
  const cx = Number(nodeBox.x || 0) + Number(nodeBox.w || 0) / 2;
  const cy = Number(nodeBox.y || 0) + Number(nodeBox.h || 0) / 2;
  const dx = cx - Number(centroid.x || 0);
  const dy = cy - Number(centroid.y || 0);
  const dist = Math.sqrt(dx * dx + dy * dy);
  const diag = Math.max(1, Math.sqrt(Number(nodeBox.w || 0) ** 2 + Number(nodeBox.h || 0) ** 2));
  return Math.max(0, 1 - dist / (diag * 2));
}

function tokenHasAny(tokens, patterns) {
  const arr = asArr(tokens);
  return arr.some((t) => patterns.some((re) => re.test(String(t).split(":").pop())));
}

export function isRealVisualDiff(score) {
  const ratio = Number(score?.diffRatio);
  return Number.isFinite(ratio);
}

export function shouldAcceptImprovement({ beforeDiff, afterDiff, epsilon = 0.0005 }) {
  const gate = evaluateImprovement({ beforeDiff, afterDiff, epsilon });
  return {
    ...gate,
    accept: gate.improvedBy > Math.max(0, Number(epsilon || 0.0005)),
  };
}

export function rankOffendersByPixels({
  diffPath,
  layout,
  outPath,
  minBboxArea = 200,
  topOffenders = 12,
} = {}) {
  const rows = asArr(layout);
  const outputPath =
    outPath || path.join(path.dirname(String(diffPath || ".")), "element-diff.visual-opt.json");
  computeElementDiff(String(diffPath || ""), rows, outputPath, { minBboxArea });
  const offendersRaw = JSON.parse(fs.readFileSync(outputPath, "utf8") || "[]");
  const byNode = new Map(rows.map((r) => [String(r?.nodeId || ""), r]));
  const offenders = asArr(offendersRaw)
    .map((o) => {
      const meta = byNode.get(String(o?.nodeId || "")) || {};
      return {
        nodeId: String(o?.nodeId || ""),
        pixels: Number(o?.pixels || 0),
        ratio: Number(o?.ratio || 0),
        bbox: meta?.bbox || null,
        className: String(meta?.className || ""),
        parentClassName: String(meta?.parentClassName || ""),
        dataKey: String(meta?.dataKey || ""),
        decorative: Boolean(meta?.decorative),
        tag: String(meta?.tag || "").toLowerCase(),
      };
    })
    .filter((o) => o.nodeId && o.pixels > 0)
    .sort((a, b) => (Number(b.pixels) - Number(a.pixels)) || (Number(b.ratio) - Number(a.ratio)));
  return offenders.slice(0, Math.max(1, Number(topOffenders || 12)));
}

function sumOffenderPixels(offenders) {
  return asArr(offenders).reduce((acc, o) => acc + Math.max(0, Number(o?.pixels || 0)), 0);
}

function widthConflictInTokens(tokens) {
  const byScopeFamily = new Map();
  for (const token of asArr(tokens)) {
    const parts = String(token || "").split(":");
    const core = String(parts[parts.length - 1] || "");
    const scope = parts.length > 1 ? parts.slice(0, -1).join(":") : "";
    if (!/^w-|^max-w-|^min-w-/.test(core)) continue;
    const family = core.startsWith("max-w-") ? "max-w" : core.startsWith("min-w-") ? "min-w" : "w";
    const key = `${scope}|${family}`;
    if (!byScopeFamily.has(key)) byScopeFamily.set(key, []);
    byScopeFamily.get(key).push(core);
  }
  for (const [, group] of byScopeFamily) {
    if (group.length > 1) return true;
  }
  return false;
}

function detectConstraintConflict({ layout, offenders }) {
  const rows = asArr(layout);
  const byId = new Map(rows.map((r) => [String(r?.nodeId || ""), r]));
  const offenderIds = asArr(offenders).map((o) => String(o?.nodeId || "")).filter(Boolean);
  for (const offenderId of offenderIds.slice(0, 8)) {
    let cur = byId.get(offenderId);
    let depth = 0;
    let chainWithWidth = 0;
    let chainConflict = false;
    while (cur && depth < 6) {
      const tokens = classTokens(cur.className);
      const hasWidth = tokenHasAny(tokens, [/^w-/, /^max-w-/, /^min-w-/]);
      if (hasWidth) chainWithWidth += 1;
      if (widthConflictInTokens(tokens)) chainConflict = true;
      const parentId = String(cur?.parentNodeId || "");
      cur = parentId ? byId.get(parentId) : null;
      depth += 1;
    }
    if (chainConflict || chainWithWidth >= 3) return true;
  }
  return false;
}

function detectWrongLayoutModel({ layout, hotZones }) {
  const rows = asArr(layout);
  const zones = asArr(hotZones);
  const byId = new Map(rows.map((r) => [String(r?.nodeId || ""), r]));
  const childrenByParent = new Map();
  for (const n of rows) {
    const p = String(n?.parentNodeId || "");
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p).push(n);
  }
  for (const zone of zones) {
    const rootId = String(zone?.nodeId || "");
    const root = byId.get(rootId);
    if (!root) continue;
    const rootTokens = classTokens(root.className);
    const children = asArr(childrenByParent.get(rootId)).filter((c) => c?.bbox);
    if (children.length < 2) continue;
    const centers = children.map((c) => ({
      x: Number(c.bbox.x || 0) + Number(c.bbox.w || 0) / 2,
      y: Number(c.bbox.y || 0) + Number(c.bbox.h || 0) / 2,
    }));
    const xs = centers.map((c) => c.x);
    const ys = centers.map((c) => c.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    const isCol = rootTokens.some((t) => String(t).split(":").pop() === "flex-col");
    const isRow = rootTokens.some((t) => String(t).split(":").pop() === "flex-row");
    if (isCol && spreadX > spreadY * 1.4) return true;
    if (isRow && spreadY > spreadX * 1.4) return true;
  }
  return false;
}

function detectDecorInFlow({ offenders }) {
  const rows = asArr(offenders);
  if (rows.length < 4) return false;
  const decorativeCount = rows.filter((o) => {
    const key = String(o?.dataKey || "").toLowerCase();
    const cls = String(o?.className || "").toLowerCase();
    const tag = String(o?.tag || "").toLowerCase();
    return (
      Boolean(o?.decorative) ||
      /decorative|decorativebar|rectangle|underline|divider/.test(key) ||
      /decorative|divider|underline/.test(cls) ||
      tag === "svg"
    );
  }).length;
  return decorativeCount / Math.max(1, rows.length) >= 0.4;
}

export function classifyFailureModes({
  alignments = [],
  textAABlockedCount = 0,
  constraintConflict = false,
  wrongLayoutModel = false,
  decorInFlow = false,
} = {}) {
  const largeOffsets = asArr(alignments).filter((a) => {
    const dx = Math.abs(Number(a?.dx || 0));
    const dy = Math.abs(Number(a?.dy || 0));
    return Math.max(dx, dy) >= 6;
  }).length;
  const offsetDominated = largeOffsets >= 1;
  const textAADominated = Number(textAABlockedCount || 0) >= 1;
  const out = {
    offsetDominated,
    textAADominated,
    constraintConflict: Boolean(constraintConflict),
    wrongLayoutModel: Boolean(wrongLayoutModel),
    decorInFlow: Boolean(decorInFlow),
  };
  let recommendedRoute = "none";
  if (out.wrongLayoutModel || out.constraintConflict || out.decorInFlow) {
    recommendedRoute = "structure-repair";
  } else if (out.offsetDominated) {
    recommendedRoute = "alignment-calibration";
  } else if (out.textAADominated) {
    recommendedRoute = "text-aa-tolerance";
  }
  return {
    ...out,
    recommendedRoute,
  };
}

export function clusterHotZones({ offenders, layout, maxZones = 3 } = {}) {
  const rows = asArr(offenders);
  const nodes = asArr(layout);
  const centroid = centroidForOffenders(rows);
  const candidates = [];
  for (const node of nodes) {
    const nodeId = String(node?.nodeId || "");
    if (!nodeId || !node?.bbox) continue;
    const nodeTokens = classTokens(node.className);
    let coveredPixels = 0;
    let overlap = 0;
    for (const offender of rows) {
      const ob = offender?.bbox;
      if (!ob) continue;
      if (!containsBox(node.bbox, ob)) continue;
      const p = Number(offender?.pixels || 0);
      coveredPixels += p;
      overlap += overlapArea(node.bbox, ob);
    }
    if (!coveredPixels) continue;
    const isContainer =
      tokenHasAny(nodeTokens, [/^flex$/, /^grid$/]) ||
      /^(flex|grid)$/.test(String(node?.styles?.display || ""));
    const hasGap = tokenHasAny(nodeTokens, [/^gap-/]);
    const hasPadding = tokenHasAny(nodeTokens, [/^p[trblxy]?-/]);
    const hasWidth = tokenHasAny(nodeTokens, [/^w-/, /^max-w-/, /^min-w-/]);
    const childCount = Number(node?.childCount || 0);
    const centerBias = distanceScore(node.bbox, centroid);
    const featureScore =
      (isContainer ? 1 : 0) +
      (childCount > 1 ? 1 : 0) +
      (hasGap ? 1 : 0) +
      (hasPadding ? 1 : 0) +
      (hasWidth ? 1 : 0) +
      centerBias;
    const score = coveredPixels * (1 + 0.06 * featureScore);
    candidates.push({ nodeId, coveredPixels, score, featureScore });
  }

  return candidates
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.max(1, Math.min(3, Number(maxZones || 3))))
    .map((x) => ({
      nodeId: x.nodeId,
      coveredPixels: Number(x.coveredPixels || 0),
      score: Number(x.score || 0),
      featureScore: Number(x.featureScore || 0),
    }));
}

function buildPatchOpsFromDiff({ classAdd = [], classRemove = [], classReplace = {}, style = {} } = {}) {
  const ops = {
    classAdd: fromTokenArray(classAdd),
    classRemove: fromTokenArray(classRemove),
    classReplace: classReplace && typeof classReplace === "object" ? classReplace : {},
    style: style && typeof style === "object" ? style : {},
  };
  if (!hasBoundedOps(ops)) return null;
  return ops;
}

function makePatchMap(nodeId, ops) {
  if (!nodeId || !ops || !hasBoundedOps(ops)) return {};
  return { [String(nodeId)]: ops };
}

function pushCandidate(list, candidate) {
  if (!candidate?.patchMap || !Object.keys(candidate.patchMap).length) return;
  const sig = JSON.stringify(candidate.patchMap);
  const exists = list.some((c) => JSON.stringify(c.patchMap) === sig);
  if (!exists) list.push(candidate);
}

export function generateDeterministicCandidates({
  bucket,
  layout,
  offenders,
  hotZones,
  maxCandidates = 16,
} = {}) {
  const nodes = asArr(layout);
  const byId = new Map(nodes.map((n) => [String(n?.nodeId || ""), n]));
  const childrenByParent = new Map();
  for (const n of nodes) {
    const parentId = String(n?.parentNodeId || "");
    const nodeId = String(n?.nodeId || "");
    if (!parentId || !nodeId) continue;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(n);
  }
  const zoneIds = asArr(hotZones).map((z) => String(z?.nodeId || "")).filter(Boolean);
  const fallbackZone = asArr(offenders).slice(0, 2).map((o) => String(o?.nodeId || ""));
  const targets = [...new Set([...zoneIds, ...fallbackZone])].slice(0, 3);
  const candidates = [];

  for (const nodeId of targets) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const tag = String(node?.tag || "").toLowerCase();
    const tokens = classTokens(node.className);

    // Padding tuning (+/- 0.25 rem).
    const padTok = tokens.map((t) => parseArbitraryRem(t, ["px", "py", "pt", "pb", "pl", "pr"])).find(Boolean);
    if (padTok && Number.isFinite(padTok.value)) {
      for (const delta of [-0.25, 0.25]) {
        const next = Math.max(0, padTok.value + delta);
        const nextCore = `${padTok.family}-[${formatRem(next)}rem]`;
        const replace = { [padTok.token]: withPrefix(padTok.token, nextCore) };
        const ops = buildPatchOpsFromDiff({ classReplace: replace });
        pushCandidate(candidates, {
          candidateType: "padding-tune",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    }

    // Gap tuning (+/- 0.25 rem).
    const gapTok = tokens.map((t) => parseArbitraryRem(t, ["gap"])).find(Boolean);
    if (gapTok && Number.isFinite(gapTok.value)) {
      for (const delta of [-0.25, 0.25]) {
        const next = Math.max(0, gapTok.value + delta);
        const nextCore = `gap-[${formatRem(next)}rem]`;
        const replace = { [gapTok.token]: withPrefix(gapTok.token, nextCore) };
        const ops = buildPatchOpsFromDiff({ classReplace: replace });
        pushCandidate(candidates, {
          candidateType: "gap-tune",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    }

    // Alignment switching.
    const alignPairs = [
      ["justify-start", "justify-center"],
      ["justify-center", "justify-between"],
      ["items-start", "items-center"],
      ["items-center", "items-start"],
    ];
    for (const [from, to] of alignPairs) {
      const token = tokens.find((t) => String(t).split(":").pop() === from);
      if (!token) continue;
      const replace = { [token]: withPrefix(token, to) };
      const ops = buildPatchOpsFromDiff({ classReplace: replace });
      pushCandidate(candidates, {
        candidateType: "alignment-switch",
        changedNodeIds: [nodeId],
        patchMap: makePatchMap(nodeId, ops),
      });
    }

    // Layout model swap candidate (flex-col/row mismatches).
    const children = asArr(childrenByParent.get(nodeId)).filter((c) => c?.bbox);
    if (children.length >= 2) {
      const centers = children.map((c) => ({
        x: Number(c.bbox.x || 0) + Number(c.bbox.w || 0) / 2,
        y: Number(c.bbox.y || 0) + Number(c.bbox.h || 0) / 2,
      }));
      const xs = centers.map((c) => c.x);
      const ys = centers.map((c) => c.y);
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const spreadY = Math.max(...ys) - Math.min(...ys);
      const hasFlexCol = tokens.some((t) => String(t).split(":").pop() === "flex-col");
      const hasFlexRow = tokens.some((t) => String(t).split(":").pop() === "flex-row");
      if (hasFlexCol && spreadX > spreadY * 1.35) {
        const ops = buildPatchOpsFromDiff({
          classReplace: Object.fromEntries(
            tokens
              .filter((t) => String(t).split(":").pop() === "flex-col")
              .map((t) => [t, withPrefix(t, "flex-row")])
          ),
        });
        pushCandidate(candidates, {
          candidateType: "layout-model-swap",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      } else if (hasFlexRow && spreadY > spreadX * 1.35) {
        const ops = buildPatchOpsFromDiff({
          classReplace: Object.fromEntries(
            tokens
              .filter((t) => String(t).split(":").pop() === "flex-row")
              .map((t) => [t, withPrefix(t, "flex-col")])
          ),
        });
        pushCandidate(candidates, {
          candidateType: "layout-model-swap",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    }

    // Width conflict dedupe in same scope.
    const byScope = new Map();
    for (const token of tokens) {
      const parts = String(token).split(":");
      const core = String(parts[parts.length - 1] || "");
      const scope = parts.length > 1 ? parts.slice(0, -1).join(":") : "";
      if (!/^w-|^max-w-|^min-w-/.test(core)) continue;
      const family = core.startsWith("max-w-") ? "max-w" : core.startsWith("min-w-") ? "min-w" : "w";
      const key = `${scope}|${family}`;
      if (!byScope.has(key)) byScope.set(key, []);
      byScope.get(key).push({ token, core });
    }
    for (const [, group] of byScope) {
      if (group.length < 2) continue;
      const arbitrary = group.find((x) => /\[[^\]]+\]/.test(x.core));
      const winner = arbitrary || group.find((x) => x.core !== "w-full") || group[0];
      const remove = group.filter((x) => x.token !== winner.token).map((x) => x.token);
      const ops = buildPatchOpsFromDiff({ classRemove: remove });
      pushCandidate(candidates, {
        candidateType: "width-dedupe",
        changedNodeIds: [nodeId],
        patchMap: makePatchMap(nodeId, ops),
      });
    }

    // Nested width constraint unwind.
    const childrenForWidths = asArr(childrenByParent.get(nodeId));
    if (childrenForWidths.length > 0) {
      const outerTokens = classTokens(node.className);
      const outerHasConstraint = tokenHasAny(outerTokens, [/^max-w-/, /^w-\[[^\]]+\]/, /^w-full$/]);
      if (outerHasConstraint) {
        const patchMap = {};
        const changedNodeIds = [];
        for (const child of childrenForWidths.slice(0, 4)) {
          const childId = String(child?.nodeId || "");
          if (!childId) continue;
          const childTokens = classTokens(child.className);
          const remove = childTokens.filter((t) => /^w-\[[^\]]+\]$/.test(String(t).split(":").pop()));
          const hasAnyW = childTokens.some((t) => /^w-/.test(String(t).split(":").pop()));
          const ops = buildPatchOpsFromDiff({
            classRemove: remove,
            classAdd: !remove.length && !hasAnyW ? ["w-full"] : [],
          });
          if (!ops) continue;
          patchMap[childId] = ops;
          changedNodeIds.push(childId);
        }
        if (changedNodeIds.length) {
          pushCandidate(candidates, {
            candidateType: "nested-width-unwind",
            changedNodeIds,
            patchMap,
          });
        }
      }
    }

    // Overflow fixes on non-media wrappers.
    if (!MEDIA_TAGS.has(tag)) {
      const removeOverflow = tokens.filter((t) => String(t).split(":").pop() === "overflow-hidden");
      if (removeOverflow.length) {
        const ops = buildPatchOpsFromDiff({ classRemove: removeOverflow });
        pushCandidate(candidates, {
          candidateType: "overflow-fix",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    }

    // Bucket-specific responsive fixes.
    if (bucket === "mobile") {
      const fixedWidths = tokens.filter((t) => /^w-\[[^\]]+\]$/.test(String(t).split(":").pop()));
      if (fixedWidths.length) {
        const ops = buildPatchOpsFromDiff({
          classRemove: fixedWidths,
          classAdd: ["max-md:w-full"],
        });
        pushCandidate(candidates, {
          candidateType: "responsive-mobile-width",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
      const hasRow = tokens.some((t) => /(md:|lg:)?flex-row$/.test(String(t)));
      if (hasRow) {
        const ops = buildPatchOpsFromDiff({ classAdd: ["max-md:flex-col"] });
        pushCandidate(candidates, {
          candidateType: "responsive-mobile-stack",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }

      // Mobile rescale profile: reduce large paddings/gaps in one bounded set.
      const profileReplace = {};
      for (const t of tokens) {
        const pad = parseArbitraryRem(t, ["px", "py", "pt", "pb", "pl", "pr", "gap"]);
        if (!pad || !Number.isFinite(pad.value)) continue;
        if (pad.value < 1) continue;
        const next = Math.max(0, pad.value - 0.5);
        const core = `${pad.family}-[${formatRem(next)}rem]`;
        profileReplace[t] = withPrefix(t, core);
      }
      if (Object.keys(profileReplace).length) {
        const ops = buildPatchOpsFromDiff({
          classReplace: profileReplace,
          classAdd: ["max-md:w-full"],
        });
        pushCandidate(candidates, {
          candidateType: "mobile-rescale-profile",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    } else if (bucket === "tablet") {
      const baseOnlyJustify = tokens.find((t) => String(t).split(":").pop() === "justify-between");
      if (baseOnlyJustify && !tokens.some((t) => String(t).startsWith("md:justify-"))) {
        const ops = buildPatchOpsFromDiff({ classAdd: ["md:justify-between"] });
        pushCandidate(candidates, {
          candidateType: "responsive-tablet-promote",
          changedNodeIds: [nodeId],
          patchMap: makePatchMap(nodeId, ops),
        });
      }
    }

    // Shrink-to-content for buttons/cards.
    const nodeLabel = `${tag} ${node.className || ""}`.toLowerCase();
    if (/button|btn|card/.test(nodeLabel) && tokens.includes("w-full")) {
      const replace = { "w-full": "w-auto" };
      const ops = buildPatchOpsFromDiff({ classReplace: replace });
      pushCandidate(candidates, {
        candidateType: "width-shrink-content",
        changedNodeIds: [nodeId],
        patchMap: makePatchMap(nodeId, ops),
      });
    }
  }

  return candidates.slice(0, Math.max(1, Math.min(20, Number(maxCandidates || 16))));
}

function flattenChangedNodeIds(patchMap) {
  return Object.keys(patchMap || {});
}

function proxyCandidateScore(candidate, { offenders = [], hotZones = [], bucket = "desktop", failureMode = "none" } = {}) {
  const changed = flattenChangedNodeIds(candidate?.patchMap || {});
  const changedSet = new Set(changed);
  const hotIds = new Set(asArr(hotZones).map((h) => String(h?.nodeId || "")));
  const offenderIds = new Set(asArr(offenders).map((o) => String(o?.nodeId || "")));
  const typeWeight = {
    "layout-model-swap": 6,
    "nested-width-unwind": 6,
    "mobile-rescale-profile": bucket === "mobile" ? 6 : 2,
    "responsive-mobile-width": 5,
    "responsive-mobile-stack": 5,
    "width-dedupe": 5,
    "padding-tune": 4,
    "gap-tune": 4,
    "alignment-switch": 3,
    "overflow-fix": 3,
    "width-shrink-content": 2,
  }[String(candidate?.candidateType || "")] || 1;
  let failureBoost = 0;
  const type = String(candidate?.candidateType || "");
  if (
    (failureMode === "highConstraintConflict" || failureMode === "constraintConflict") &&
    (type === "width-dedupe" || type === "nested-width-unwind")
  ) {
    failureBoost = 4;
  } else if (failureMode === "likelyWrongLayoutModel" && (type === "layout-model-swap" || type === "responsive-mobile-stack")) {
    failureBoost = 4;
  }
  let overlapScore = 0;
  for (const id of changedSet) {
    if (hotIds.has(id)) overlapScore += 2;
    if (offenderIds.has(id)) overlapScore += 1.5;
  }
  return typeWeight + failureBoost + overlapScore;
}

function metricFromScore(score, metricName) {
  const s = score || {};
  const diff = Number(s?.diffRatio);
  const layout = Number(s?.layoutDiffRatio);
  if (metricName === "layoutDiffRatio" && Number.isFinite(layout)) return layout;
  if (Number.isFinite(diff)) return diff;
  if (Number.isFinite(layout)) return layout;
  return 1;
}

function chooseMetricName(score, failureMode) {
  const s = score || {};
  const layout = Number(s?.layoutDiffRatio);
  if (failureMode === "aaDominated" && Number.isFinite(layout)) return "layoutDiffRatio";
  if (Number.isFinite(layout) && layout >= 0.08) return "layoutDiffRatio";
  return "diffRatio";
}

export async function runVisualOptimizer({
  slug,
  publicSlug,
  outDir,
  bucket = "desktop",
  maxIters = 3,
  passDiffRatio = 0.02,
  topOffenders = 12,
  epsilon = 0.0005,
  dryRun = false,
  compareFn,
  readScoreFn,
  captureLayoutFn,
  snapshotArtifactsFn,
  shouldStop = () => false,
  onIteration = () => {},
} = {}) {
  const targetBuckets =
    String(bucket || "desktop").toLowerCase() === "all"
      ? ["desktop", "tablet", "mobile"]
      : [String(bucket || "desktop").toLowerCase()];

  const report = {
    ok: true,
    slug: String(publicSlug || slug || ""),
    provider: "visual-optimizer",
    bucket: String(bucket || "desktop").toLowerCase(),
    dryRun: Boolean(dryRun),
    passDiffRatio: Number(passDiffRatio || 0.02),
    maxIters: Number(maxIters || 3),
    topOffenders: Number(topOffenders || 12),
    epsilon: Number(epsilon || 0.0005),
    iterations: [],
    bucketReports: {},
    stoppedReason: "",
    escalationSuggestion: null,
  };

  for (const b of targetBuckets) {
    const patchPath = patchesFilePath(outDir, b);
    const perBucket = {
      bucket: b,
      stoppedReason: "",
      iterations: [],
      reportFile: `/fixtures.out/${encodeURIComponent(report.slug)}/visual-opt-report.${b}.json`,
      failureClassification: null,
      failureSignals: {
        alignments: [],
        textAABlockedCount: 0,
        constraintConflict: false,
        wrongLayoutModel: false,
        decorInFlow: false,
      },
    };
    let plateauCount = 0;

    for (let iter = 1; iter <= Number(maxIters || 3); iter += 1) {
      if (shouldStop()) {
        perBucket.stoppedReason = "cancelled";
        break;
      }

      await compareFn();
      let scoreBefore = readScoreFn(b);
      if (!isRealVisualDiff(scoreBefore)) {
        await compareFn();
        scoreBefore = readScoreFn(b);
      }
      if (!isRealVisualDiff(scoreBefore)) {
        const skipped = {
          iteration: iter,
          bucket: b,
          skipped: true,
          reason: "no-visual-diff",
          warning: `No real visual diff available for ${b}; skipped optimization iteration.`,
        };
        perBucket.iterations.push(skipped);
        report.iterations.push(skipped);
        onIteration(skipped);
        perBucket.stoppedReason = "no-visual-diff";
        break;
      }

      const failureMode = String(scoreBefore?.failureMode || "none");
      if (failureMode === "offsetDominated") {
        const skippedOffset = {
          iteration: iter,
          bucket: b,
          skipped: true,
          reason: "alignment-offset",
          warning: "Alignment offset too large; fix crop/registration upstream before refine.",
          before: { [b]: scoreBefore },
          failureMode,
          failureSignals: scoreBefore?.failureSignals || {},
        };
        perBucket.iterations.push(skippedOffset);
        report.iterations.push(skippedOffset);
        onIteration(skippedOffset);
        perBucket.stoppedReason = "alignment-offset";
        break;
      }
      const activeMetricName = chooseMetricName(scoreBefore, failureMode);
      const scoreBeforeMetric = metricFromScore(scoreBefore, activeMetricName);

      const layout = await captureLayoutFn(b, scoreBefore);
      const diffPath = path.join(outDir, `diff.${b}.png`);
      const elementDiffPath = path.join(outDir, `element-diff.${b}.json`);
      const offenders = rankOffendersByPixels({
        diffPath,
        layout,
        outPath: elementDiffPath,
        topOffenders,
        minBboxArea: 200,
      });

      if (!offenders.length) {
        perBucket.stoppedReason = "no-offenders";
        break;
      }

      perBucket.failureSignals.alignments.push({
        stage: "before",
        iter,
        dx: Number(scoreBefore?.alignment?.dx || 0),
        dy: Number(scoreBefore?.alignment?.dy || 0),
      });

      const hotZones = clusterHotZones({ offenders, layout, maxZones: 3 });
      perBucket.failureSignals.constraintConflict =
        perBucket.failureSignals.constraintConflict ||
        detectConstraintConflict({ layout, offenders });
      perBucket.failureSignals.wrongLayoutModel =
        perBucket.failureSignals.wrongLayoutModel ||
        detectWrongLayoutModel({ layout, hotZones });
      perBucket.failureSignals.decorInFlow =
        perBucket.failureSignals.decorInFlow ||
        detectDecorInFlow({ offenders });
      const candidates = generateDeterministicCandidates({
        bucket: b,
        layout,
        offenders,
        hotZones,
        maxCandidates: 20,
      });
      if (!candidates.length) {
        plateauCount += 1;
        if (plateauCount >= 2) {
          perBucket.stoppedReason = "plateau";
          break;
        }
        continue;
      }

      const beforeArtifacts = snapshotArtifactsFn
        ? snapshotArtifactsFn(iter, "before", [b])
        : {};
      const previousPatchMap = readPatchMap(patchPath);
      let acceptedCandidate = null;
      const candidatesTried = [];
      const beforeLayoutProxyPixels = sumOffenderPixels(offenders);
      const withProxy = candidates.map((candidate) => ({
        ...candidate,
        proxyScore: proxyCandidateScore(candidate, {
          offenders,
          hotZones,
          bucket: b,
          failureMode,
        }),
      }));
      withProxy.sort((a, b2) => Number(b2.proxyScore || 0) - Number(a.proxyScore || 0));
      const beam = withProxy.slice(0, 3);
      const beamSig = new Set(beam.map((c) => JSON.stringify(c.patchMap || {})));
      for (const candidate of withProxy) {
        if (!beamSig.has(JSON.stringify(candidate.patchMap || {}))) {
          candidatesTried.push({
            candidateType: candidate.candidateType,
            changedNodeIds: flattenChangedNodeIds(candidate.patchMap),
            proxyScore: Number(candidate.proxyScore || 0),
            accepted: false,
            reason: "not-in-beam",
          });
        }
      }

      for (const candidate of beam) {
        if (!candidate?.patchMap || !Object.keys(candidate.patchMap).length) continue;
        const merged = mergePatchMaps(previousPatchMap, candidate.patchMap);
        if (!dryRun) writePatchMap(patchPath, merged);

        await compareFn();
        const scoreAfterCandidate = readScoreFn(b);
        const afterMetricName = chooseMetricName(scoreAfterCandidate, failureMode);
        const beforeDiff = scoreBeforeMetric;
        const afterDiff = metricFromScore(scoreAfterCandidate, afterMetricName);
        const changedNodeIds = flattenChangedNodeIds(candidate.patchMap);
        if (!isRealVisualDiff(scoreAfterCandidate)) {
          candidatesTried.push({
            candidateType: candidate.candidateType,
            changedNodeIds,
            proxyScore: Number(candidate.proxyScore || 0),
            diffRatioBefore: beforeDiff,
            diffRatioAfter: null,
            accepted: false,
            improvedBy: 0,
            reason: "no-visual-diff",
          });
          if (!dryRun) writePatchMap(patchPath, previousPatchMap);
          await compareFn();
          continue;
        }
        const gate = shouldAcceptImprovement({
          beforeDiff,
          afterDiff,
          epsilon,
        });
        const afterProxy = rankOffendersByPixels({
          diffPath,
          layout,
          outPath: path.join(outDir, `element-diff.${b}.cand-${iter}.json`),
          topOffenders,
          minBboxArea: 200,
        });
        const afterLayoutProxyPixels = sumOffenderPixels(afterProxy);
        const layoutProxyImprovedBy = beforeLayoutProxyPixels - afterLayoutProxyPixels;
        const layoutProxyImproved =
          layoutProxyImprovedBy > Math.max(10, beforeLayoutProxyPixels * 0.05);
        const reason =
          gate.accept
            ? "accepted"
            : gate.improvedBy < 0
              ? "worsened"
              : "no-improvement";
        if (!gate.accept && layoutProxyImproved) {
          perBucket.failureSignals.textAABlockedCount += 1;
        }
        candidatesTried.push({
          candidateType: candidate.candidateType,
          changedNodeIds,
          proxyScore: Number(candidate.proxyScore || 0),
          diffRatioBefore: beforeDiff,
          diffRatioAfter: afterDiff,
          metric: afterMetricName,
          layoutProxyBefore: beforeLayoutProxyPixels,
          layoutProxyAfter: afterLayoutProxyPixels,
          layoutProxyImprovedBy,
          accepted: Boolean(gate.accept),
          improvedBy: Number(gate.improvedBy || 0),
          reason,
        });

        if (gate.accept) {
          if (!acceptedCandidate || Number(gate.improvedBy || 0) > Number(acceptedCandidate.improvedBy || 0)) {
            acceptedCandidate = {
              ...candidate,
              scoreAfter: scoreAfterCandidate,
              improvedBy: gate.improvedBy,
              changedNodeIds,
            };
          }
        }
        if (!dryRun) writePatchMap(patchPath, previousPatchMap);
        await compareFn();
      }

      if (!acceptedCandidate) {
        plateauCount += 1;
        const plateauIter = {
          iteration: iter,
          bucket: b,
          accepted: false,
          candidatesTried,
          reason: "no-improvement",
          before: { [b]: scoreBefore },
          after: { [b]: readScoreFn(b) },
          diffRatioBefore: Number(scoreBefore?.diffRatio ?? 1),
          diffRatioAfter: Number(readScoreFn(b)?.diffRatio ?? 1),
          layoutDiffRatioBefore: Number(scoreBefore?.layoutDiffRatio ?? scoreBefore?.diffRatio ?? 1),
          layoutDiffRatioAfter: Number(readScoreFn(b)?.layoutDiffRatio ?? readScoreFn(b)?.diffRatio ?? 1),
          activeMetric: activeMetricName,
          failureMode,
          failureSignals: scoreBefore?.failureSignals || {},
          offenders: { [b]: offenders },
        };
        perBucket.iterations.push(plateauIter);
        report.iterations.push(plateauIter);
        onIteration(plateauIter);
        if (plateauCount >= 2) {
          perBucket.stoppedReason = "plateau";
          break;
        }
        continue;
      }

      // Apply the best candidate from beam as state.
      if (!dryRun) {
        const mergedAccepted = mergePatchMaps(previousPatchMap, acceptedCandidate.patchMap || {});
        writePatchMap(patchPath, mergedAccepted);
      }
      await compareFn();
      plateauCount = 0;
      const scoreAfter = readScoreFn(b) || acceptedCandidate.scoreAfter;
      perBucket.failureSignals.alignments.push({
        stage: "after",
        iter,
        dx: Number(scoreAfter?.alignment?.dx || 0),
        dy: Number(scoreAfter?.alignment?.dy || 0),
      });
      const afterDiff = Number(scoreAfter?.diffRatio ?? 1);
      const passNow = afterDiff <= Number(passDiffRatio || 0.02);
      const afterArtifacts = snapshotArtifactsFn
        ? snapshotArtifactsFn(iter, "after", [b])
        : {};

      const acceptedIteration = {
        iteration: iter,
        bucket: b,
        before: { [b]: scoreBefore },
        after: { [b]: scoreAfter },
        diffRatioBefore: Number(scoreBefore?.diffRatio ?? 1),
        diffRatioAfter: Number(scoreAfter?.diffRatio ?? 1),
        layoutDiffRatioBefore: Number(scoreBefore?.layoutDiffRatio ?? scoreBefore?.diffRatio ?? 1),
        layoutDiffRatioAfter: Number(scoreAfter?.layoutDiffRatio ?? scoreAfter?.diffRatio ?? 1),
        artifacts: {
          before: beforeArtifacts,
          after: afterArtifacts,
        },
        offenders: { [b]: offenders },
        acceptedPatches: { [b]: acceptedCandidate.patchMap || {} },
        rejectedPatches: { [b]: [] },
        patchFiles: [`/fixtures.out/${encodeURIComponent(report.slug)}/${path.basename(patchPath)}`],
        improvedBy: Number(acceptedCandidate.improvedBy || 0),
        metricUsed: activeMetricName,
        activeMetric: activeMetricName,
        metricBefore: scoreBeforeMetric,
        metricAfter: metricFromScore(scoreAfter, activeMetricName),
        accepted: true,
        rolledBack: false,
        pass: passNow,
        candidateType: acceptedCandidate.candidateType,
        changedNodeIds: acceptedCandidate.changedNodeIds || [],
        candidatesTried,
        failureMode,
        failureSignals: scoreBefore?.failureSignals || {},
      };
      perBucket.iterations.push(acceptedIteration);
      report.iterations.push(acceptedIteration);
      onIteration(acceptedIteration);

      if (passNow) {
        perBucket.stoppedReason = "pass";
        break;
      }
      if (iter === Number(maxIters || 3)) {
        perBucket.stoppedReason = "max-iters";
      }
    }

    if (!perBucket.stoppedReason) perBucket.stoppedReason = "completed";
    perBucket.failureClassification = classifyFailureModes(perBucket.failureSignals);
    report.bucketReports[b] = perBucket;
    const finalIter = perBucket.iterations.length
      ? perBucket.iterations[perBucket.iterations.length - 1]
      : null;
    const finalScore = finalIter?.after?.[b] || finalIter?.before?.[b] || {};
    perBucket.bestDx = Number(finalScore?.bestDx || 0);
    perBucket.bestDy = Number(finalScore?.bestDy || 0);
    perBucket.diffRatio = Number(finalScore?.diffRatio ?? 1);
    perBucket.layoutDiffRatio = Number(finalScore?.layoutDiffRatio ?? perBucket.diffRatio);
    perBucket.failureMode = String(finalScore?.failureMode || "none");
    const finalDiff = Number(finalIter?.after?.[b]?.diffRatio ?? 1);
    const shouldEscalate =
      (perBucket.iterations.length >= 2 && finalDiff > 0.25) ||
      String(perBucket.stoppedReason || "") === "plateau" ||
      plateauCount >= 2 ||
      String(perBucket.failureMode || "") === "likelyWrongLayoutModel";
    const classifyRoute = String(perBucket.failureClassification?.recommendedRoute || "");
    if ((shouldEscalate || classifyRoute === "structure-repair") && !report.escalationSuggestion) {
      report.escalationSuggestion = {
        lane: "ai-recode",
        bucket: b,
        reason:
          String(perBucket.failureMode || "") === "likelyWrongLayoutModel"
            ? "likely-wrong-layout-model"
            : classifyRoute === "structure-repair"
              ? "failure-classification:structure-repair"
              : finalDiff > 0.25
              ? "high-diff-after-iterations"
              : "plateau",
        finalDiffRatio: finalDiff,
        failureClassification: perBucket.failureClassification,
      };
    }
    const perBucketPath = path.join(outDir, `visual-opt-report.${b}.json`);
    fs.writeFileSync(perBucketPath, JSON.stringify(perBucket, null, 2), "utf8");
  }

  if (!report.stoppedReason) {
    const reasons = Object.values(report.bucketReports).map((r) => String(r?.stoppedReason || ""));
    report.stoppedReason = reasons[0] || "completed";
  }
  report.files = {
    reports: targetBuckets.reduce((acc, b) => {
      acc[b] = `/fixtures.out/${encodeURIComponent(report.slug)}/visual-opt-report.${b}.json`;
      return acc;
    }, {}),
  };
  return report;
}
