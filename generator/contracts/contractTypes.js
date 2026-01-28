const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const ATTR_REGEX = /([^\s=]+)\s*=\s*(["'])(.*?)\2/g;

export function parseAttributes(attrString) {
  const attrs = {};
  const order = [];
  const consumed = [];
  let match;
  while ((match = ATTR_REGEX.exec(attrString))) {
    const key = match[1];
    const value = match[3];
    if (!(key in attrs)) order.push(key);
    attrs[key] = value;
    consumed.push(match[0]);
  }

  const cleaned = String(attrString || "").replace(ATTR_REGEX, " ").trim();
  if (cleaned) {
    const parts = cleaned.split(/\s+/g).filter(Boolean);
    for (const key of parts) {
      if (!(key in attrs)) {
        attrs[key] = null;
        order.push(key);
      }
    }
  }

  return { attrs, order };
}

export function serializeAttributes(attrs, order) {
  const parts = [];
  for (const key of order) {
    if (!(key in attrs)) continue;
    const value = attrs[key];
    if (value === null || typeof value === "undefined") {
      parts.push(` ${key}`);
    } else {
      parts.push(` ${key}="${String(value)}"`);
    }
  }
  return parts.join("");
}

export function buildOpenTag(tag, attrs, order, isSelfClosing = false) {
  const attrStr = serializeAttributes(attrs, order);
  return isSelfClosing ? `<${tag}${attrStr} />` : `<${tag}${attrStr}>`;
}

export function getAttrValue(attrs, key) {
  return attrs && key in attrs ? attrs[key] : null;
}

export function setAttrValue(attrs, order, key, value) {
  if (!(key in attrs)) order.push(key);
  attrs[key] = value;
}

export function removeAttr(attrs, order, key) {
  if (!(key in attrs)) return;
  delete attrs[key];
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
}

export function parseHtmlNodes(html) {
  const nodes = [];
  const stack = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?>/g;
  let match;

  while ((match = tagRegex.exec(html))) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    const attrPart = match[2] || "";
    const isClosing = raw.startsWith("</");
    const isSelfClosing = raw.endsWith("/>") || VOID_TAGS.has(tag);
    const start = match.index;
    const end = start + raw.length;

    if (isClosing) {
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          idx = i;
          break;
        }
      }
      if (idx === -1) continue;
      const open = stack[idx];
      stack.splice(idx, stack.length - idx);
      const node = nodes[open.nodeIndex];
      node.closeStart = start;
      node.closeEnd = end;
      node.end = end;
      continue;
    }

    const { attrs, order } = parseAttributes(attrPart);
    const parentIndex = stack.length ? stack[stack.length - 1].nodeIndex : null;
    const nodeIndex = nodes.length;
    const node = {
      tag,
      openStart: start,
      openEnd: end,
      closeStart: null,
      closeEnd: null,
      start,
      end,
      attrs,
      attrOrder: order,
      parentIndex,
      isSelfClosing,
      rawOpenTag: raw,
    };
    nodes.push(node);

    if (!isSelfClosing) {
      stack.push({ tag, nodeIndex });
    }
  }

  return nodes;
}

export function getClassTokens(attrs) {
  const value = getAttrValue(attrs, "class");
  if (!value) return [];
  return String(value || "")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function setClassTokens(attrs, order, tokens) {
  const next = tokens.filter(Boolean).join(" ");
  if (!next) {
    removeAttr(attrs, order, "class");
  } else {
    setAttrValue(attrs, order, "class", next);
  }
}

export function applyPatches(html, patches) {
  if (!patches.length) return html;
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let out = String(html || "");
  for (const patch of ordered) {
    out = out.slice(0, patch.start) + patch.replacement + out.slice(patch.end);
  }
  return out;
}

export function createPatch(start, end, replacement) {
  return { start, end, replacement };
}

export function getNodeIdentifier(node) {
  const key = getAttrValue(node.attrs, "data-key");
  if (key) return `data-key=${key}`;
  const id = getAttrValue(node.attrs, "data-node-id");
  if (id) return `data-node-id=${id}`;
  return `${node.tag}@${node.openStart}`;
}

export function getInnerHtml(html, node) {
  if (!node || node.closeStart === null) return "";
  return html.slice(node.openEnd, node.closeStart);
}

export function hasAncestor(nodes, node, predicate) {
  let current = node.parentIndex;
  while (current !== null && current !== undefined) {
    const parent = nodes[current];
    if (predicate(parent)) return true;
    current = parent.parentIndex;
  }
  return false;
}
