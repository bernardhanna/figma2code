// generator/auto/interactiveStatesPass.js
//
// Derives Tailwind interactive variants (hover/active/focus-visible/disabled)
// from Figma-exported state snapshots (node.__states).
//
// Expectations:
// - Plugin attaches, on interactive-looking nodes (buttons/links/cards),
//   a `__states` object:
//     {
//       default: <Node>,
//       hover?: <Node>,
//       active?: <Node>,
//       focus?: <Node>,
//       disabled?: <Node>,
//     }
// - Shapes of these nodes match the main AST node schema sufficiently for
//   boxDeco() to compute background/border/shadow/opacity utilities.
//
// Strategy:
// - Walk AST tree once, building an index by id/key for future group-hover support.
// - For each node with __states:
//   - Compute base boxDeco classes for default snapshot.
//   - For each available state, compute boxDeco classes and take the set-diff.
//   - Wrap the diff classes in the appropriate Tailwind prefix:
//       hover: -> "hover:...", active: -> "active:...",
//       focus: -> "focus-visible:...", disabled: -> "disabled:..."
//   - Attach the merged string onto node.tw so autoLayoutify/render can inject
//     them into the final class attribute.
// - For now we only decorate the wrapper node; group-hover is wired but will
//   only apply once child snapshots + matching live nodes are present.
//
// NOTE: We deliberately ignore layout changes between states; only decoration.

import { boxDeco } from "./autoLayoutify/styles.js";
import { cls } from "./autoLayoutify/precision.js";
import { visibleStroke } from "./autoLayoutify/stroke.js";

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function debugLog(...args) {
  try {
    if (process?.env?.AI_DEBUG_STATES === "1") {
      // eslint-disable-next-line no-console
      console.log("[interactiveStates]", ...args);
    }
  } catch {
    // ignore
  }
}

function collectNodeIndex(root) {
  const byId = new Map();
  const byKey = new Map();
  const seen = new Set();
  const maxNodes = Number(process.env.STATE_PASS_MAX_NODES) || 10000;
  let visited = 0;

  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!isObj(n) || seen.has(n)) continue;
    seen.add(n);
    visited += 1;
    if (visited > maxNodes) break;
    const id = n.id && String(n.id);
    const key = n.key && String(n.key);

    if (id) byId.set(id, n);
    if (key) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(n);
    }
    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }

  return { byId, byKey };
}

function decoClasses(nodeSnapshot) {
  if (!isObj(nodeSnapshot)) return [];
  const deco = boxDeco(nodeSnapshot, /*isText=*/ false, /*omitBg=*/ false) || "";
  return String(deco)
    .split(/\s+/)
    .filter(Boolean);
}

function diffDecoClasses(defaultSnap, stateSnap) {
  const base = decoClasses(defaultSnap);
  const state = decoClasses(stateSnap);

  if (!state.length) return [];
  if (!base.length) return state.slice();

  const baseSet = new Set(base);
  return state.filter((c) => !baseSet.has(c));
}

function prefixForStateKey(stateKey) {
  switch (stateKey) {
    case "hover":
      return "hover:";
    case "active":
      return "active:";
    case "focus":
      // Prefer focus-visible for better a11y semantics
      return "focus-visible:";
    case "disabled":
      return "disabled:";
    default:
      return "";
  }
}

function ensureBaselineFocusClasses(node, classesForFocus) {
  const hasRing = classesForFocus.some((c) =>
    c.startsWith("focus-visible:ring-")
  );
  if (!hasRing) {
    classesForFocus.push("focus:outline-none");
    classesForFocus.push("focus-visible:ring-2");
    classesForFocus.push("focus-visible:ring-offset-2");
  }
}

function isInteractiveWrapper(node) {
  const name = String(node?.name || "").toLowerCase();
  if (
    name.includes("button") ||
    name.includes("btn") ||
    name.includes("cta") ||
    name.includes("link") ||
    name.includes("card") ||
    name.includes("arrow") ||
    name.includes("chevron")
  ) {
    return true;
  }
  if (node?.actions?.isClickable || node?.actions?.openUrl) return true;
  if (node?.attrs && (node.attrs["data-slick-prev"] || node.attrs["data-slick-next"])) {
    return true;
  }
  return false;
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function rgba01ToHex(rgba) {
  if (!rgba || typeof rgba !== "object") return null;
  const r = rgba.r;
  const g = rgba.g;
  const b = rgba.b;
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return null;
  const to = (v01) => Math.round(clamp01(v01) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function firstSolidFill(node) {
  const fills = Array.isArray(node?.fills) ? node.fills : Array.isArray(node?.fill) ? node.fill : [];
  for (const f of fills) {
    const kind = String(f?.kind || f?.type || f?.fillType || "").toLowerCase();
    if (kind === "solid" || kind === "color") {
      return f;
    }
  }
  return null;
}

function colorHexFromNode(node) {
  const stroke = visibleStroke(node);
  if (stroke?.color) return rgba01ToHex(stroke.color);
  const fill = firstSolidFill(node);
  if (fill && typeof fill.r === "number") {
    return rgba01ToHex({ r: fill.r, g: fill.g, b: fill.b, a: fill.a });
  }
  return null;
}

function isSvgOrVector(node) {
  return !!(
    node?.svg ||
    node?.vector ||
    String(node?.type || "").toUpperCase() === "VECTOR" ||
    String(node?.type || "").toUpperCase() === "BOOLEAN_OPERATION"
  );
}

function hasTextDescendant(node) {
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (n.text || String(n.type || "").toUpperCase() === "TEXT") return true;
    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return false;
}

function findFirstVector(node) {
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (isSvgOrVector(n)) return n;
    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return null;
}

function markVectorDescendants(node) {
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (isSvgOrVector(n)) n.__inheritColor = true;
    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
}

function computeStateClassesForNode(node, states) {
  const out = [];

  if (!isObj(states) || !isObj(states.default)) return out;
  const def = states.default;

  const supportedKeys = ["hover", "active", "focus", "disabled"];
  const isSvg = isSvgOrVector(node);
  const isWrapper = isInteractiveWrapper(node) && !isSvg;
  const allowIconColor = isWrapper && !hasTextDescendant(node);

  if (allowIconColor) {
    const defIcon = findFirstVector(def);
    const defIconColor = defIcon ? colorHexFromNode(defIcon) : null;
    if (defIconColor) out.push(`text-[${defIconColor}]`);
    for (const key of supportedKeys) {
      const stateSnap = states[key];
      if (!isObj(stateSnap)) continue;
      const stateIcon = findFirstVector(stateSnap);
      const stateColor = stateIcon ? colorHexFromNode(stateIcon) : null;
      if (stateColor && stateColor !== defIconColor) {
        const prefix = prefixForStateKey(key);
        if (prefix) out.push(`${prefix}text-[${stateColor}]`);
      }
    }
    if (defIconColor) markVectorDescendants(node);
  }

  for (const key of supportedKeys) {
    if (!isObj(states[key])) continue;
    const prefix = prefixForStateKey(key);
    if (!prefix) continue;

    const diff = diffDecoClasses(def, states[key]);

    if (isSvg) {
      const defColor = colorHexFromNode(def);
      const stateColor = colorHexFromNode(states[key]);
      if (stateColor && stateColor !== defColor) {
        out.push(`${prefix}text-[${stateColor}]`);
      }
    }

    if (!diff.length && !isSvg) continue;

    const prefixed = diff.map((c) => prefix + c);

    if (key === "focus" && isInteractiveWrapper(node)) {
      ensureBaselineFocusClasses(node, prefixed);
    }

    out.push(...prefixed);
  }

  return out;
}

export function interactiveStatesPass(ast) {
  if (!isObj(ast) || !isObj(ast.tree)) return ast;

  const root = ast.tree;
  const index = collectNodeIndex(root);

  const debugSummary = [];

  const seen = new Set();
  const maxNodes = Number(process.env.STATE_PASS_MAX_NODES) || 10000;
  let visited = 0;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!isObj(n) || seen.has(n)) continue;
    seen.add(n);
    visited += 1;
    if (visited > maxNodes) break;

    if (isObj(n.__states) && isObj(n.__states.default)) {
      const stateKeys = Object.keys(n.__states).filter((k) => k !== "default");
      if (stateKeys.length) {
        const classes = computeStateClassesForNode(n, n.__states);
        if (classes.length) {
          const prev = Array.isArray(n.tw)
            ? n.tw.join(" ")
            : String(n.tw || "");
          n.tw = cls(prev, classes.join(" "));

          debugSummary.push({
            id: n.id,
            name: n.name,
            states: stateKeys,
            classes,
          });
        }
      }
    }

    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }

  if (debugSummary.length) {
    debugLog("applied state utilities", debugSummary);
  }

  return ast;
}


