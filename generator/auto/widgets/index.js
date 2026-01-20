// generator/auto/widgets/index.js
import dropdown from "./dropdown.js";
import slider from "./slider.js";
import { loadStyleHints } from "./styleHints.js";

const RULES = [dropdown, slider];

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function widgetDebugEnabled() {
  return String(process.env.WIDGET_DEBUG || "").trim() === "1";
}

function debugLog(...args) {
  if (!widgetDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log("[widgets]", ...args);
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

function scopeAllows(node, viewport) {
  const scope = node?.__widget?.scope || "all";
  if (!viewport) return scope === "all";
  if (scope === "all") return true;
  return scope === viewport;
}

export function applyWidgets(ast, ctx = {}) {
  if (!ast || !ast.tree) return ast;

  const viewport = String(ctx.viewport || "").trim();
  const styleHints = ctx.styleHints || loadStyleHints();
  const ruleCtx = { ...ctx, viewport, styleHints, ast };

  walk(ast.tree, (node) => {
    for (const rule of RULES) {
      let matched = false;
      try {
        matched = !!rule.match(node, ruleCtx);
      } catch (err) {
        debugLog("match-error", {
          widget: rule.id,
          node: { id: node?.id, name: node?.name },
          error: String(err?.message || err),
        });
        continue;
      }
      if (!matched) continue;

      if (!scopeAllows(node, viewport)) {
        debugLog("scope-skip", {
          widget: rule.id,
          node: { id: node?.id, name: node?.name },
          scope: node?.__widget?.scope || "all",
          viewport: viewport || "none",
        });
        continue;
      }

      if (!isObj(node.__widgetApplied)) node.__widgetApplied = {};
      if (node.__widgetApplied[rule.id]) continue;

      try {
        rule.apply(node, ruleCtx);
        node.__widgetApplied[rule.id] = true;
        debugLog("applied", {
          widget: rule.id,
          node: { id: node?.id, name: node?.name },
          scope: node?.__widget?.scope || "all",
          viewport: viewport || "none",
        });
      } catch (err) {
        debugLog("apply-error", {
          widget: rule.id,
          node: { id: node?.id, name: node?.name },
          error: String(err?.message || err),
        });
      }
    }
  });

  return ast;
}
