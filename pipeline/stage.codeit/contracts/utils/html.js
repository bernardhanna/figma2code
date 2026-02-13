const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ATTR_REGEX = /([^\s=]+)\s*=\s*(["'])(.*?)\2/g;

const parseAttributes = (attrString) => {
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
};

const escapeAttr = (value) =>
  String(value || "")
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const serializeAttributes = (attrs, order) => {
  const parts = [];
  for (const key of order) {
    if (!(key in attrs)) continue;
    const value = attrs[key];
    if (value === null || typeof value === "undefined") {
      parts.push(` ${key}`);
    } else {
      parts.push(` ${key}="${escapeAttr(value)}"`);
    }
  }
  return parts.join("");
};

const buildOpenTag = (tag, attrs, order, isSelfClosing = false) => {
  const attrStr = serializeAttributes(attrs, order);
  return isSelfClosing ? `<${tag}${attrStr} />` : `<${tag}${attrStr}>`;
};

const getAttrValue = (attrs, key) => (attrs && key in attrs ? attrs[key] : null);

const setAttrValue = (attrs, order, key, value) => {
  if (!(key in attrs)) order.push(key);
  attrs[key] = value;
};

const removeAttr = (attrs, order, key) => {
  if (!(key in attrs)) return;
  delete attrs[key];
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
};

const parseHtmlNodes = (html) => {
  const nodes = [];
  const stack = [];
  const tagRegex =
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s+(?:[^"'<>]+|"[^"]*"|'[^']*')*)?\s*\/?>/g;
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
};

const getClassTokens = (attrs) => {
  const value = getAttrValue(attrs, "class");
  if (!value) return [];
  return String(value || "")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
};

const setClassTokens = (attrs, order, tokens) => {
  const next = tokens.filter(Boolean).join(" ");
  if (!next) {
    removeAttr(attrs, order, "class");
  } else {
    setAttrValue(attrs, order, "class", next);
  }
};

const applyPatches = (html, patches) => {
  if (!patches.length) return html;
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let out = String(html || "");
  for (const patch of ordered) {
    out = out.slice(0, patch.start) + patch.replacement + out.slice(patch.end);
  }
  return out;
};

const createPatch = (start, end, replacement) => ({ start, end, replacement });

const getNodeIdentifier = (node) => {
  const key = getAttrValue(node.attrs, "data-key");
  if (key) return `data-key=${key}`;
  const id = getAttrValue(node.attrs, "data-node-id");
  if (id) return `data-node-id=${id}`;
  return `${node.tag}@${node.openStart}`;
};

module.exports = {
  buildOpenTag,
  applyPatches,
  createPatch,
  getAttrValue,
  getClassTokens,
  getNodeIdentifier,
  parseHtmlNodes,
  removeAttr,
  setAttrValue,
  setClassTokens,
};
