// generator/auto/variantLinkPass.js
import { applyWidgets } from "./widgets/index.js";
import { parseWidgetDirective } from "./widgets/utils.js";

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function walk(node, fn) {
  if (!node) return;
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    if (cur.__widgetSkip) continue;
    fn(cur);
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      stack.push(kids[i]);
    }
  }
}

export function variantLinkPass(ast, { viewport } = {}) {
  if (!ast || !ast.tree) return ast;

  walk(ast.tree, (node) => {
    const parsed = parseWidgetDirective(node?.name);
    if (!parsed) return;

    const prev = isObj(node.__widget) ? node.__widget : null;
    node.__widget = {
      type: parsed.type || prev?.type || null,
      enhance: parsed.enhance || prev?.enhance || null,
      scope: parsed.scope || prev?.scope || "all",
      sourceName: parsed.sourceName || prev?.sourceName || String(node?.name || "").trim(),
    };
  });

  const ctx = {
    viewport: viewport || "",
    fontMap: ast?.meta?.fontMap || {},
  };

  applyWidgets(ast, ctx);
  return ast;
}
