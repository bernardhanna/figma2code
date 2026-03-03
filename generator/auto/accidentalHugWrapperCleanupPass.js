function asObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nodeBox(node) {
  if (!asObj(node)) return null;
  const bb = asObj(node.bb) ? node.bb : asObj(node.bbox) ? node.bbox : null;
  if (bb) {
    const x = asNum(bb.x);
    const y = asNum(bb.y);
    const w = asNum(bb.w);
    const h = asNum(bb.h);
    if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const x = asNum(node.x);
  const y = asNum(node.y);
  const w = asNum(node.w);
  const h = asNum(node.h);
  if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) {
    return { x, y, w, h };
  }
  return null;
}

function collectClassTokens(node) {
  const out = [];
  const pushTokens = (v) => {
    if (typeof v === "string") {
      out.push(...v.split(/\s+/g).filter(Boolean));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) pushTokens(item);
    }
  };
  pushTokens(node?.tw);
  pushTokens(node?.className);
  pushTokens(node?.attrs?.class);
  pushTokens(node?.dataAttrs?.class);
  return out;
}

function hasClassToken(node, token) {
  return collectClassTokens(node).includes(String(token || "").trim());
}

function hasMeaningfulStyle(node) {
  if (!asObj(node)) return false;

  if (node?.img?.src) return true;

  const fills = asArr(node.fills);
  if (
    fills.some((f) => {
      const kind = String(f?.kind || f?.type || "").toLowerCase();
      return !!kind && kind !== "none";
    })
  ) {
    return true;
  }

  if (asArr(node.strokes).length > 0) return true;
  if (asArr(node.effects).length > 0) return true;
  if (asArr(node.shadows).length > 0) return true;
  if (asObj(node.blur)) return true;
  if (node.isMask || node.mask || node.maskPath || node.clipPath || node.maskType) return true;
  if (node.clipsContent === true) return true;

  if (Number.isFinite(Number(node.opacity)) && Math.abs(Number(node.opacity) - 1) > 0.001) return true;
  if (node.blendMode && String(node.blendMode).toUpperCase() !== "NORMAL") return true;

  const cr = Number(node.cornerRadius);
  if (Number.isFinite(cr) && cr > 0) return true;

  const styleString = String(node?.attrs?.style || node?.dataAttrs?.style || "");
  if (
    /\b(background|border|shadow|clip-path|mask|overflow|backdrop-filter)\b/i.test(styleString)
  ) {
    return true;
  }

  const cls = collectClassTokens(node).join(" ");
  if (
    /\b(bg-|from-|via-|to-|border|outline|ring-|shadow|overflow-hidden|clip-|mask-|opacity-|backdrop-|mix-blend|rounded-)\b/i.test(
      cls
    )
  ) {
    return true;
  }

  return false;
}

function hasStructuralLayoutRole(node) {
  const auto = asObj(node?.auto) ? node.auto : null;
  if (auto) {
    const layout = String(auto.layout || "").toUpperCase();
    if (layout && layout !== "NONE") return true;
    if (
      auto.itemSpacing != null ||
      auto.padT != null ||
      auto.padR != null ||
      auto.padB != null ||
      auto.padL != null ||
      auto.primaryAlign != null ||
      auto.counterAlign != null ||
      auto.primarySizing != null ||
      auto.counterSizing != null
    ) {
      return true;
    }
  }
  if (node?.layoutGuide) return true;
  return false;
}

function isInteractiveNode(node) {
  if (!asObj(node)) return false;
  const tag = String(node?.tag || "").toLowerCase();
  if (["a", "button", "input", "select", "textarea", "label"].includes(tag)) return true;
  if (node?.actions?.isClickable === true) return true;
  if (node?.actions?.openUrl) return true;
  const iType = String(node?.intent?.interactiveType || "").toLowerCase();
  if (iType && iType !== "none") return true;
  return false;
}

const SEMANTIC_BOUNDARY_TAGS = new Set([
  "section",
  "article",
  "nav",
  "form",
  "ul",
  "ol",
  "header",
  "footer",
]);

function isExplicitlyRemovable(node) {
  return (
    node?.removableWrapper === true ||
    node?.__removableWrapper === true ||
    node?.meta?.removableWrapper === true ||
    node?.attrs?.["data-removable-wrapper"] === "1" ||
    node?.attrs?.["data-wrapper-removable"] === "1"
  );
}

function isSemanticBoundary(node) {
  const tag = String(node?.tag || node?.semanticTag || "").toLowerCase();
  if (SEMANTIC_BOUNDARY_TAGS.has(tag)) return true;
  const role = String(node?.attrs?.role || "").toLowerCase();
  if (["banner", "navigation", "main", "contentinfo", "form", "list"].includes(role)) return true;
  return false;
}

function boundsNearlyEqual(wrapper, children, toleranceRatio = 0.02, toleranceMinPx = 2) {
  const wb = nodeBox(wrapper);
  if (!wb) return false;
  const boxes = asArr(children).map(nodeBox).filter(Boolean);
  if (!boxes.length) return false;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const cb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const tol = Math.max(toleranceMinPx, Math.max(wb.w, wb.h) * toleranceRatio);
  return (
    Math.abs(cb.x - wb.x) <= tol &&
    Math.abs(cb.y - wb.y) <= tol &&
    Math.abs(cb.w - wb.w) <= tol &&
    Math.abs(cb.h - wb.h) <= tol
  );
}

function descendantHasAbsoluteSignal(node, seen = new Set()) {
  if (!asObj(node) || seen.has(node)) return false;
  seen.add(node);

  const posRaw = String(
    node?.position || node?.layoutPositioning || node?.layout?.positioning || ""
  ).toUpperCase();
  if (posRaw === "ABSOLUTE" || posRaw === "FIXED") return true;
  if (hasClassToken(node, "absolute") || hasClassToken(node, "fixed")) return true;

  for (const child of asArr(node.children)) {
    if (descendantHasAbsoluteSignal(child, seen)) return true;
  }
  return false;
}

function providesRelativeContext(node) {
  if (!asObj(node)) return false;
  const posRaw = String(
    node?.position || node?.layoutPositioning || node?.layout?.positioning || ""
  ).toUpperCase();
  if (posRaw === "RELATIVE") return true;
  if (hasClassToken(node, "relative")) return true;
  const styleString = String(node?.attrs?.style || node?.dataAttrs?.style || "");
  if (/position\s*:\s*relative/i.test(styleString)) return true;
  return false;
}

function mergeClassLike(a, b) {
  const toTokens = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.flatMap((x) => toTokens(x));
    if (typeof v === "string") return v.split(/\s+/g).filter(Boolean);
    return [];
  };
  const out = [...toTokens(a), ...toTokens(b)];
  const dedup = [...new Set(out)];
  return dedup.join(" ").trim();
}

function hoistWrapperClasses(wrapper, child) {
  if (!asObj(wrapper) || !asObj(child)) return;
  const mergedTw = mergeClassLike(wrapper.tw, child.tw);
  if (mergedTw) child.tw = mergedTw;

  const mergedClass = mergeClassLike(wrapper.className, child.className);
  if (mergedClass) child.className = mergedClass;
}

function shouldRemoveWrapper(wrapper, parent) {
  const children = asArr(wrapper?.children);
  if (!children.length) return false;

  const wrapperType = String(wrapper?.type || "").toUpperCase();
  if (wrapperType === "TEXT") return false;
  if (wrapper?.text || wrapper?.img) return false;
  if (isInteractiveNode(wrapper)) return false;
  if (hasMeaningfulStyle(wrapper)) return false;
  if (hasStructuralLayoutRole(wrapper)) return false;
  if (isSemanticBoundary(wrapper) && !isExplicitlyRemovable(wrapper)) return false;

  if (children.length === 1) {
    // Single-child wrappers are likely accidental "hug" wrappers if otherwise neutral.
  } else {
    if (!boundsNearlyEqual(wrapper, children)) return false;
    const parentAuto = String(parent?.auto?.layout || "").toUpperCase();
    if (parentAuto && parentAuto !== "NONE") return false;
  }

  if (descendantHasAbsoluteSignal(wrapper)) {
    const wrapperIsAnchor = providesRelativeContext(wrapper);
    const parentIsAnchor = providesRelativeContext(parent);
    if (wrapperIsAnchor && !parentIsAnchor) return false;
  }

  return true;
}

function collapsePass(node, parent, stats) {
  if (!asObj(node)) return;
  const kids = asArr(node.children);
  for (const child of kids) collapsePass(child, node, stats);

  if (!Array.isArray(node.children) || !node.children.length) return;
  const next = [];
  for (const child of node.children) {
    if (!asObj(child) || !shouldRemoveWrapper(child, node)) {
      next.push(child);
      continue;
    }
    const grandChildren = asArr(child.children);
    if (grandChildren.length === 1) {
      const only = grandChildren[0];
      hoistWrapperClasses(child, only);
      if (!only.key && child.key) only.key = child.key;
      next.push(only);
      stats.collapsed += 1;
      continue;
    }
    next.push(...grandChildren);
    stats.collapsed += 1;
  }
  node.children = next;
}

export function accidentalHugWrapperCleanupPass(ast) {
  if (!asObj(ast) || !asObj(ast.tree)) return ast;
  const stats = { collapsed: 0 };
  collapsePass(ast.tree, null, stats);
  if (stats.collapsed > 0) {
    ast.meta = asObj(ast.meta) ? ast.meta : {};
    ast.meta.accidentalHugCleanup = { collapsed: stats.collapsed };
  }
  return ast;
}

export default accidentalHugWrapperCleanupPass;
