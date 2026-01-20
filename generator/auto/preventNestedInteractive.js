// generator/auto/preventNestedInteractive.js
//
// Prevent nested <button>/<a> problems caused by clickability propagation.
// Rule:
// - If a node is "interactive" BUT contains an interactive descendant,
//   demote the node to non-interactive (div semantics), keeping its layout.
//
// This avoids duplicated wrapper buttons and preserves leaf CTAs as the only interactives.

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function isInteractiveNode(n) {
  // Depending on your pipeline, interactivity may be represented differently.
  // We check a few common shapes without assuming too much.
  const a = n?.actions || {};
  const sem = n?.semantics || {};

  if (a && (a.isClickable || a.href)) return true;
  if (sem && (sem.tag === "button" || sem.tag === "a")) return true;
  if (n?.tag === "button" || n?.tag === "a") return true;

  return false;
}

function demoteNode(n) {
  // Remove/neutralize clickability at this level only.
  if (isObj(n.actions)) {
    delete n.actions.isClickable;
    delete n.actions.href;
    delete n.actions.target;
  }
  if (isObj(n.semantics)) {
    // Preserve aria/labels if you want, but ensure tag is not interactive.
    if (n.semantics.tag === "button" || n.semantics.tag === "a") {
      n.semantics.tag = "div";
    }
  }
  if (n.tag === "button" || n.tag === "a") n.tag = "div";
}

function hasInteractiveDescendant(n) {
  const kids = Array.isArray(n?.children) ? n.children : [];
  const stack = kids.slice();
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    if (isInteractiveNode(cur)) return true;
    const next = Array.isArray(cur.children) ? cur.children : [];
    for (let i = next.length - 1; i >= 0; i -= 1) stack.push(next[i]);
  }
  return false;
}

export function preventNestedInteractive(ast) {
  const root = ast?.tree || ast;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);

    const selfInteractive = isInteractiveNode(n);
    if (selfInteractive && hasInteractiveDescendant(n)) {
      // Demote *this* node so only descendants remain interactive.
      demoteNode(n);
    }

    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }

  return ast;
}