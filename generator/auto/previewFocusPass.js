// generator/auto/previewFocusPass.js

function walk(node, fn) {
  if (!node) return;
  const stack = [node];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    fn(cur);
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
}

const PREVIEW_TOKEN_RE = /@preview(?:-only)?\b/i;

function findPreviewNode(root) {
  let found = null;
  walk(root, (node) => {
    if (found) return;
    if (!node || node.__widgetSkip) return;
    const name = String(node?.name || "");
    if (PREVIEW_TOKEN_RE.test(name)) found = node;
  });
  return found;
}

export function previewFocusPass(ast, { previewOnly } = {}) {
  if (!previewOnly || !ast?.tree) return { ast, focused: false };

  const target = findPreviewNode(ast.tree);
  if (!target) return { ast, focused: false };

  const nextFrame = ast.frame
    ? {
        ...ast.frame,
        w: Number(target.w || ast.frame.w || 0) || ast.frame.w,
        h: Number(target.h || ast.frame.h || 0) || ast.frame.h,
      }
    : ast.frame;

  const nextAst = {
    ...ast,
    tree: target,
    frame: nextFrame,
    __previewFocus: {
      id: target?.id || "",
      name: String(target?.name || "").trim(),
    },
  };

  return { ast: nextAst, focused: true };
}
