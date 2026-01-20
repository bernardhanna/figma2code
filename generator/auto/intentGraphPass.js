// generator/auto/intentGraphPass.js
// Phase 3 — Layout Intent Graph
// Purpose:
// - Convert normalized AST into a semantic "intent graph"
// - No HTML / no Tailwind emitted here
//
// Intent Graph contains:
// - sectionType: hero | section | unknown
// - nodes: simplified graph nodes with inferred layout intent
// - collections: detected repeating sibling groups (grid candidates)
// - warnings: ambiguous groupings, risky patterns

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

const ENABLE_INTENT_GRAPH = String(process.env.INTENT_GRAPH || "1").trim() !== "0";
const INTENT_GRAPH_MAX_NODES = Number(process.env.INTENT_GRAPH_MAX_NODES) || 15000;

function approxEqual(a, b, tol = 0.1) {
  if (typeof a !== "number" || typeof b !== "number") return false;
  if (a === 0 && b === 0) return true;
  const denom = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / denom <= tol;
}

function safeChildren(node) {
  return Array.isArray(node?.children) ? node.children : [];
}

function nodeDims(node) {
  const w = typeof node?.w === "number" ? node.w : node?.units?.width?.px ?? null;
  const h = typeof node?.h === "number" ? node.h : node?.units?.height?.px ?? null;
  return { w, h };
}

function structuralSignature(node) {
  // A rough signature of the node's subtree shape (depth + child count pattern)
  // This is deterministic and cheap; refine later if needed.
  const children = safeChildren(node);
  const type = String(node?.type || "");
  const name = String(node?.name || "");
  const hasText = type === "TEXT" ? 1 : 0;
  return {
    type,
    nameHint: name.toLowerCase().replace(/\d+/g, "#").slice(0, 40),
    childCount: children.length,
    hasText,
  };
}

function depth(node, max = 5) {
  let d = 0;
  let cur = node;
  while (d < max) {
    const c = safeChildren(cur);
    if (!c.length) break;
    cur = c[0];
    d++;
  }
  return d;
}

function looksLikeHero(root) {
  // Per your rules: top-level frame + background image/gradient + prominent heading
  // Here: assume root is the section root node.
  const fills = Array.isArray(root?.fills) ? root.fills : [];
  const hasBgImageOrGradient = fills.some((f) => {
    const k = String(f?.kind || "").toLowerCase();
    return k === "image" || k === "gradient";
  });

  // prominent heading heuristic: find a TEXT node with large fontSize >= 40
  let hasProminentHeading = false;

  const stack = [root];
  const seen = new Set();
  let visited = 0;
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n) || hasProminentHeading) continue;
    seen.add(n);
    visited += 1;
    if (visited > INTENT_GRAPH_MAX_NODES) break;
    if (n.type === "TEXT" && n.text && typeof n.text.fontSize === "number") {
      if (n.text.fontSize >= 40) {
        hasProminentHeading = true;
        break;
      }
    }
    const kids = safeChildren(n);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }

  return Boolean(hasBgImageOrGradient && hasProminentHeading);
}

function detectCollections(parent) {
  // A parent is a collection if:
  // - ≥3 children
  // - Children have similar dimensions (±10%)
  // - Children share structure depth
  // - Children share fill types (roughly: wrapperRole + type)
  const children = safeChildren(parent).filter((c) => c && c.wrapperRole !== "decorative");
  if (children.length < 3) return [];

  // Group by rough signature
  const groups = [];
  const used = new Set();

  for (let i = 0; i < children.length; i++) {
    if (used.has(i)) continue;

    const a = children[i];
    const aDims = nodeDims(a);
    const aDepth = depth(a, 6);
    const aSig = structuralSignature(a);

    const idxs = [i];

    for (let j = i + 1; j < children.length; j++) {
      if (used.has(j)) continue;
      const b = children[j];
      const bDims = nodeDims(b);
      const bDepth = depth(b, 6);
      const bSig = structuralSignature(b);

      const dimsOk =
        approxEqual(aDims.w, bDims.w, 0.1) && approxEqual(aDims.h, bDims.h, 0.1);

      const depthOk = aDepth === bDepth;

      const sigOk = aSig.type === bSig.type && aSig.childCount === bSig.childCount;

      // fill type similarity: treat by wrapperRole + whether it has image/gradient fills
      const fillA = (a.fills || []).map((f) => String(f?.kind || "").toLowerCase()).sort().join(",");
      const fillB = (b.fills || []).map((f) => String(f?.kind || "").toLowerCase()).sort().join(",");
      const fillOk = fillA === fillB;

      if (dimsOk && depthOk && sigOk && fillOk) {
        idxs.push(j);
      }
    }

    if (idxs.length >= 3) {
      idxs.forEach((k) => used.add(k));
      groups.push({
        kind: "collection",
        parentId: parent.id,
        childIds: idxs.map((k) => children[k].id),
        count: idxs.length,
        // baseline columns equals count at desktop; later pass will clamp/choose max
        layout: "grid",
        columns: idxs.length,
        itemTypeHint: aSig.nameHint || aSig.type,
      });
    }
  }

  return groups;
}

function inferLayoutForNode(node, collectionsForNode = []) {
  // Deterministic rule:
  // - Repeating siblings => grid (collection)
  // - Linear content flow => flex
  // - Text blocks => flex column
  // - Controls (icon + text) => flex row
  //
  // We only annotate "layoutIntent"; we do not emit classes.

  if (collectionsForNode.length) {
    return { layout: "grid", reason: "collection-detected" };
  }

  const autoLayout = String(node?.auto?.layout || "").toUpperCase();
  if (autoLayout === "HORIZONTAL") return { layout: "flex-row", reason: "auto-layout-horizontal" };
  if (autoLayout === "VERTICAL") return { layout: "flex-col", reason: "auto-layout-vertical" };

  // If most children are TEXT, it's a text stack
  const children = safeChildren(node);
  if (children.length) {
    const textCount = children.filter((c) => c?.type === "TEXT").length;
    const ratio = textCount / children.length;
    if (ratio >= 0.6) return { layout: "flex-col", reason: "text-stack" };
  }

  return { layout: "block", reason: "fallback" };
}

function buildNodeIndex(root) {
  const byId = new Map();
  const stack = [{ node: root, parentId: null }];
  const seen = new Set();
  let visited = 0;
  while (stack.length) {
    const cur = stack.pop();
    const n = cur?.node;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    visited += 1;
    if (visited > INTENT_GRAPH_MAX_NODES) break;
    if (n.id) byId.set(n.id, { node: n, parentId: cur.parentId });
    const kids = safeChildren(n);
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      stack.push({ node: kids[i], parentId: n.id || null });
    }
  }
  return byId;
}

export function buildIntentGraph(ast) {
  if (!ENABLE_INTENT_GRAPH) return null;
  if (!ast?.tree) throw new Error("buildIntentGraph: missing ast.tree");

  const root = ast.tree;
  const sectionType = looksLikeHero(root) ? "hero" : "section";

  const nodeIndex = buildNodeIndex(root);
  if (nodeIndex.size > INTENT_GRAPH_MAX_NODES) return null;

  // Detect collections per parent
  const collections = [];
  const stack = [root];
  const seen = new Set();
  let visited = 0;
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    visited += 1;
    if (visited > INTENT_GRAPH_MAX_NODES) break;
    const found = detectCollections(n);
    for (const g of found) collections.push(g);
    const kids = safeChildren(n);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }

  // Quick lookup: parentId -> collections
  const collectionsByParent = new Map();
  for (const col of collections) {
    if (!collectionsByParent.has(col.parentId)) collectionsByParent.set(col.parentId, []);
    collectionsByParent.get(col.parentId).push(col);
  }

  // Summarize nodes into intent nodes (no deep duplication)
  const intentNodes = [];
  for (const [id, rec] of nodeIndex.entries()) {
    const n = rec.node;
    const cols = collectionsByParent.get(id) || [];
    const layoutIntent = inferLayoutForNode(n, cols);

    intentNodes.push({
      id,
      parentId: rec.parentId,
      name: n.name || "",
      type: n.type || "",
      wrapperRole: n.wrapperRole || "structural",
      dimensionIntent: n.dimensionIntent || null,
      auto: n.auto || null,
      layoutIntent,
      isText: n.type === "TEXT",
      isImage: Boolean(n.img?.src) || n.type === "IMAGE",
    });
  }

  // Warnings: grid-inside-text-stack / overly-decorative nesting etc (lightweight now)
  const warnings = [];
  for (const col of collections) {
    const parent = nodeIndex.get(col.parentId)?.node;
    if (parent) {
      const parentAuto = String(parent?.auto?.layout || "").toUpperCase();
      if (parentAuto === "VERTICAL") {
        warnings.push({
          kind: "collection-in-vertical-stack",
          parentId: col.parentId,
          message: "Collection detected inside a vertical stack; verify this is a true grid section.",
        });
      }
    }
  }

  return {
    meta: {
      schema: "intent-graph",
      version: 1,
      slug: ast.slug,
      sectionType,
      createdAt: new Date().toISOString(),
    },
    sectionType,
    collections,
    nodes: intentNodes,
    warnings,
  };
}

export default buildIntentGraph;
