function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasChildren(node) {
  return Array.isArray(node?.children) && node.children.length > 0;
}

export function normalizeSizingIntent(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "FILL" || v === "HUG" || v === "FIXED") return v.toLowerCase();
  return "";
}

function normalizeLayoutRaw(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "HORIZONTAL" || v === "VERTICAL") return v;
  return "NONE";
}

function widthFromNode(node) {
  return asNum(node?.bb?.w) ?? asNum(node?.w) ?? asNum(node?.size?.w) ?? null;
}

function inferLayoutType(node, priors, hints) {
  const explicitLayout = normalizeLayoutRaw(priors?.figma?.layout);
  if (explicitLayout === "HORIZONTAL") return "row";
  if (explicitLayout === "VERTICAL") return "col";

  if (hints?.gridCandidate || hints?.layoutGuideGrid) return "grid";
  if (hints?.axis === "horizontal") return "row";
  if (hints?.axis === "vertical") return "col";

  if (hasChildren(node)) {
    if (hints?.lowConfidence || hints?.fallbackRecommended) return "absolute";
    return "stack";
  }
  return "absolute";
}

function inferResponsivePlan(layoutType, node, hints) {
  const childrenCount = Array.isArray(node?.children) ? node.children.length : 0;
  if ((layoutType === "row" || layoutType === "grid") && childrenCount >= 2) {
    const shouldStackOnMobile = layoutType === "grid" || Number(hints?.confidence || 0) < 0.7;
    return { shouldStackOnMobile };
  }
  return null;
}

export function resolveAxisIntentsFromLayoutModel(node, parentLayout = null) {
  const model = node?.__layoutModel || null;
  const rawParent = String(parentLayout || "").trim().toUpperCase();
  const normalizedParent =
    rawParent === "HORIZONTAL" || rawParent === "ROW" || rawParent === "H"
      ? "horizontal"
      : rawParent === "VERTICAL" || rawParent === "COL" || rawParent === "V"
        ? "vertical"
        : rawParent === "GRID"
          ? "grid"
          : "";
  if (model?.sizingByParent && model.sizingByParent[normalizedParent]) {
    return model.sizingByParent[normalizedParent];
  }
  if (model?.sizing) return model.sizing;
  return { widthIntent: "", heightIntent: "" };
}

export function buildLayoutModelForNode(node, opts = {}) {
  const isRoot = !!opts.isRoot;
  const auto = node?.auto || {};
  const size = node?.size || {};
  const hints = node?.__layoutHints || {};

  const priors = {
    figma: {
      layout: normalizeLayoutRaw(auto.layout),
      wrap: String(auto.layoutWrap || auto.wrapMode || auto.wrap || "").trim().toUpperCase(),
      itemSpacing: asNum(auto.itemSpacing),
      primaryAlign: String(auto.primaryAlign || "").trim().toUpperCase(),
      counterAlign: String(auto.counterAlign || "").trim().toUpperCase(),
      padding: {
        top: asNum(auto.padT),
        right: asNum(auto.padR),
        bottom: asNum(auto.padB),
        left: asNum(auto.padL),
      },
      sizing: {
        primary: normalizeSizingIntent(size.primary || auto.primarySizing),
        counter: normalizeSizingIntent(size.counter || auto.counterSizing),
      },
    },
    geometry: {
      axisHint: String(hints?.axis || "").toLowerCase(),
      spacingHintPx: asNum(hints?.spacingPx) || 0,
      gridCandidate: !!hints?.gridCandidate,
      lowConfidence: !!hints?.lowConfidence,
    },
  };

  const layoutType = inferLayoutType(node, priors, hints);

  const sizingSelf = {
    widthIntent:
      layoutType === "row"
        ? normalizeSizingIntent(size.primary || auto.primarySizing)
        : normalizeSizingIntent(size.counter || auto.counterSizing || size.primary || auto.primarySizing),
    heightIntent:
      layoutType === "col"
        ? normalizeSizingIntent(size.primary || auto.primarySizing)
        : normalizeSizingIntent(size.counter || auto.counterSizing || size.primary || auto.primarySizing),
  };

  const sizingByParent = {
    horizontal: {
      widthIntent: normalizeSizingIntent(size.primary || auto.primarySizing),
      heightIntent: normalizeSizingIntent(size.counter || auto.counterSizing),
    },
    vertical: {
      widthIntent: normalizeSizingIntent(size.counter || auto.counterSizing),
      heightIntent: normalizeSizingIntent(size.primary || auto.primarySizing),
    },
    grid: {
      widthIntent: normalizeSizingIntent(size.primary || auto.primarySizing),
      heightIntent: normalizeSizingIntent(size.counter || auto.counterSizing),
    },
  };

  const maxWidth = isRoot ? widthFromNode(node) : null;
  const containerIntent = {
    isStructuralContainer: hasChildren(node),
    maxWidth: maxWidth && maxWidth > 0 ? maxWidth : null,
  };

  const confidence = {
    layoutType:
      typeof hints?.confidence === "number"
        ? Math.max(0, Math.min(1, hints.confidence))
        : layoutType === "stack"
          ? 0.45
          : 0.7,
  };

  return {
    layoutType,
    sizing: sizingSelf,
    sizingByParent,
    containerIntent,
    responsivePlan: inferResponsivePlan(layoutType, node, hints),
    confidence,
    priors,
  };
}
