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

  (function walk(n) {
    if (!isObj(n)) return;
    const id = n.id && String(n.id);
    const key = n.key && String(n.key);

    if (id) byId.set(id, n);
    if (key) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(n);
    }
    for (const c of n.children || []) walk(c);
  })(root);

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
    name.includes("card")
  ) {
    return true;
  }
  if (node?.actions?.isClickable || node?.actions?.openUrl) return true;
  return false;
}

function computeStateClassesForNode(node, states) {
  const out = [];

  if (!isObj(states) || !isObj(states.default)) return out;
  const def = states.default;

  const supportedKeys = ["hover", "active", "focus", "disabled"];

  for (const key of supportedKeys) {
    if (!isObj(states[key])) continue;
    const prefix = prefixForStateKey(key);
    if (!prefix) continue;

    const diff = diffDecoClasses(def, states[key]);
    if (!diff.length) continue;

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

  (function walk(n) {
    if (!isObj(n)) return;

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

    for (const c of n.children || []) walk(c);
  })(root);

  if (debugSummary.length) {
    debugLog("applied state utilities", debugSummary);
  }

  return ast;
}


