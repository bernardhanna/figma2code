/**
 * Normalize MCP responses into the exact plugin AST shape consumed by
 * /api/preview-only and /api/generate. Does NOT use MCP React+Tailwind code
 * as source of truth; uses structured scenegraph/layout only.
 */

/** Plugin AST shape (must match plugin/code.ts and API contract). */
export interface AST {
  slug: string;
  type: "flexi_block" | "navbar" | "footer";
  frame: { w: number; h: number };
  tree: NodeBase;
  slots: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** Node shape expected by normalizeAst and pipeline. */
export interface NodeBase {
  id: string;
  name: string;
  type: string;
  w: number;
  h: number;
  children?: NodeBase[];
  bb?: { x: number; y: number; w: number; h: number };
  relX?: number;
  relY?: number;
  auto?: AutoLayout;
  fills?: Fill[];
  text?: TextPayload;
  img?: { src: string; w: number; h: number };
  svg?: { markup?: string; html?: string };
  /** Layout guide from Figma (e.g. "Grid 10px"). When pattern is GRID, generator prefers CSS grid. */
  layoutGuide?: { pattern: "GRID"; sectionSize: number } | { pattern: "ROWS" | "COLUMNS"; gutterSize: number };
  [key: string]: unknown;
}

export interface AutoLayout {
  layout: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  padT?: number;
  padR?: number;
  padB?: number;
  padL?: number;
  primaryAlign?: string;
  counterAlign?: string;
  primarySizing?: string;
  counterSizing?: string;
  [key: string]: unknown;
}

export interface Fill {
  kind: string;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  [key: string]: unknown;
}

export interface TextPayload {
  raw: string;
  family?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  align?: string;
  color?: { r: number; g: number; b: number; a: number };
  [key: string]: unknown;
}

/** Data collected from MCP tool calls. */
export interface McpBundle {
  designContext?: string;
  screenshot?: string;
  variableDefs?: string;
  metadata?: string;
}

export interface NormalizeMcpOpts {
  slug: string;
  type?: "flexi_block" | "navbar" | "footer";
  frameName?: string;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Very simple XML parse: extract flat list of nodes with id, name, type, bounds.
 * get_metadata returns sparse XML with basic properties.
 */
function parseMetadataXml(xml: string): Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number; parentId?: string; children?: unknown[] }> {
  const nodes: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number; parentId?: string; children?: unknown[] }> = [];
  // Parse both open/close tags and retain nesting parent id when present.
  const tokenRe = /<\/?(\w+)\b([^>]*)>/g;
  const attrRe = /(\w+)=["']([^"']*)["']/g;
  const stack: Array<{ tag: string; id?: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const full = String(m[0] || "");
    const tag = String(m[1] || "").toLowerCase();
    const isClosing = full.startsWith("</");
    const selfClosing = /\/>\s*$/.test(full);
    if (isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    attrRe.lastIndex = 0;
    let attrM;
    while ((attrM = attrRe.exec(m[2])) !== null) {
      attrs[attrM[1].toLowerCase()] = attrM[2];
    }
    const id = attrs.id ?? attrs.nodeid ?? "";
    const name = attrs.name ?? "";
    const type = (attrs.type ?? tag ?? "FRAME").toUpperCase();
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const width = Number(attrs.width) || 0;
    const height = Number(attrs.height) || 0;
    const parentId = [...stack]
      .reverse()
      .map((s) => s.id)
      .find((pid) => !!pid);
    if (id) {
      nodes.push({ id, name, type, x, y, width, height, ...(parentId ? { parentId } : {}) });
    }
    if (!selfClosing) {
      stack.push({ tag, ...(id ? { id } : {}) });
    }
  }
  return nodes;
}

/**
 * Build a single NodeBase from metadata row and optional parent for relX/relY.
 */
function metadataRowToNode(
  row: { id: string; name: string; type: string; x: number; y: number; width: number; height: number },
  parent?: { x: number; y: number }
): NodeBase {
  const decodeBasicEntities = (s: string): string =>
    String(s || "")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const w = round(row.width) || 0;
  const h = round(row.height) || 0;
  const bb = { x: round(row.x), y: round(row.y), w, h };
  // Some metadata payloads report child x/y already relative to parent.
  // If child is "before" parent in either axis, treat coordinates as already relative.
  const relX =
    parent !== undefined
      ? row.x >= parent.x
        ? round(row.x - parent.x)
        : round(row.x)
      : undefined;
  const relY =
    parent !== undefined
      ? row.y >= parent.y
        ? round(row.y - parent.y)
        : round(row.y)
      : undefined;

  const node: NodeBase = {
    id: row.id,
    name: row.name,
    type: row.type,
    w,
    h,
    children: [],
  };
  if (bb.w > 0 || bb.h > 0) node.bb = bb;
  if (relX !== undefined) node.relX = relX;
  if (relY !== undefined) node.relY = relY;
  if (String(row.type || "").toUpperCase() === "TEXT") {
    const raw = decodeBasicEntities(row.name || "").trim();
    if (raw) node.text = { raw };
  }
  return node;
}

/**
 * Try to extract a structured scenegraph from get_design_context (if it's JSON).
 * Return null if not usable (e.g. React code text).
 */
function tryParseStructuredDesignContext(content: string): { tree?: NodeBase; root?: unknown } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (data && typeof data === "object" && "tree" in data) {
      return { tree: (data as { tree: NodeBase }).tree, root: data };
    }
    if (data && typeof data === "object" && "nodes" in data) {
      const nodes = (data as { nodes: unknown }).nodes;
      if (Array.isArray(nodes) && nodes.length > 0) {
        const root = nodes[0] as NodeBase;
        return { tree: root, root: data };
      }
    }
  } catch {
    // not JSON
  }
  return null;
}

function pathKeyFromNodeId(nodeId: string): string {
  return String(nodeId || "")
    .trim()
    .replace(/^I/, "");
}

/**
 * Parse react-like get_design_context output into a NodeBase tree using data-node-id/data-name.
 * This is a fallback when get_metadata returns only the selected node.
 */
function parseReactLikeDesignContext(content: string, fallbackRootId?: string): NodeBase | null {
  const hexToRgba01 = (hex: string): { r: number; g: number; b: number; a: number } | undefined => {
    const h = String(hex || "").replace(/^#/, "").trim();
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return undefined;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: round(r), g: round(g), b: round(b), a: round(a) };
  };
  const parsePxFromClass = (cls: string, key: "w" | "h"): number | undefined => {
    const re = key === "w" ? /(?:^|\s)w-\[(\d+(?:\.\d+)?)px\]/ : /(?:^|\s)h-\[(\d+(?:\.\d+)?)px\]/;
    const m = cls.match(re);
    if (!m) return undefined;
    return Number(m[1]);
  };
  const parseBracketPx = (cls: string, prop: "gap" | "p" | "pt" | "pr" | "pb" | "pl" | "leading" | "text" | "h"): number | undefined => {
    const extractPx = (body: string): number | undefined => {
      const direct = body.match(/(-?\d+(?:\.\d+)?)px/);
      if (direct) return Number(direct[1]);
      const fallback = body.match(/,\s*(-?\d+(?:\.\d+)?)px\)/);
      if (fallback) return Number(fallback[1]);
      return undefined;
    };
    if (prop === "text") {
      const matches = [...cls.matchAll(/(?:^|\s)text-\[([^\]]+)\]/g)];
      for (const match of matches) {
        const body = String(match[1] || "");
        // Prefer explicit length tokens over color tokens.
        if (/^length:/.test(body) || /^-?\d+(\.\d+)?px$/.test(body) || /,\s*-?\d+(\.\d+)?px\)/.test(body)) {
          const px = extractPx(body);
          if (typeof px === "number") return px;
        }
      }
      return undefined;
    }
    const bracket =
      prop === "gap"
        ? /(?:^|\s)gap-\[([^\]]+)\]/
        : prop === "p"
          ? /(?:^|\s)p-\[([^\]]+)\]/
          : prop === "pt"
            ? /(?:^|\s)pt-\[([^\]]+)\]/
            : prop === "pr"
              ? /(?:^|\s)pr-\[([^\]]+)\]/
              : prop === "pb"
                ? /(?:^|\s)pb-\[([^\]]+)\]/
                : prop === "pl"
                  ? /(?:^|\s)pl-\[([^\]]+)\]/
                  : prop === "leading"
                    ? /(?:^|\s)leading-\[([^\]]+)\]/
                    : prop === "h"
                      ? /(?:^|\s)h-\[([^\]]+)\]/
                      : /(?:^|\s)text-\[([^\]]+)\]/;
    const m = cls.match(bracket);
    if (!m) return undefined;
    const body = String(m[1] || "");
    return extractPx(body);
  };
  const parseColorFromClass = (cls: string): { r: number; g: number; b: number; a: number } | undefined => {
    const m =
      cls.match(/bg-\[#([0-9a-fA-F]{6,8})\]/) ||
      cls.match(/text-\[color:[^\]]*#([0-9a-fA-F]{6,8})\]/) ||
      cls.match(/border-\[#([0-9a-fA-F]{6,8})\]/);
    return m ? hexToRgba01(m[1]) : undefined;
  };
  const parseTextAlign = (cls: string): "left" | "center" | "right" | undefined => {
    if (/\btext-center\b/.test(cls)) return "center";
    if (/\btext-right\b/.test(cls)) return "right";
    if (/\btext-left\b/.test(cls)) return "left";
    return undefined;
  };
  const parseFontWeight = (cls: string): number | undefined => {
    if (/\bfont-bold\b/.test(cls)) return 700;
    if (/\bfont-semibold\b/.test(cls)) return 600;
    if (/\bfont-medium\b/.test(cls)) return 500;
    if (/\bfont-normal\b/.test(cls)) return 400;
    return undefined;
  };
  const sanitizeJsxText = (s: string): string => {
    let out = String(s || "").replace(/<[^>]+>/g, " ");
    out = out.replace(/^\s*\{+/, "").replace(/\}+\s*$/, "");
    out = out.replace(/^\s*`/, "").replace(/`\s*$/, "");
    out = out.replace(/^\s*["']/, "").replace(/["']\s*$/, "");
    out = out.replace(/\s+/g, " ").trim();
    return out;
  };
  const constAssetRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)";/g;
  const assetByVar = new Map<string, string>();
  let assetM: RegExpExecArray | null;
  while ((assetM = constAssetRe.exec(content)) !== null) {
    const varName = String(assetM[1] || "").trim();
    const url = String(assetM[2] || "").trim();
    if (!varName || !url) continue;
    assetByVar.set(varName, url);
  }
  const resolveSrcExpr = (expr: string): string => {
    const raw = String(expr || "").trim();
    if (!raw) return "";
    const quoted = raw.match(/^["']([^"']+)["']$/);
    if (quoted?.[1]) return quoted[1];
    return assetByVar.get(raw) || raw;
  };

  const elementRe = /<([a-zA-Z][\w-]*)\b([^>]*\bdata-node-id="([^"]+)"[^>]*)>/g;
  const nameRe = /\bdata-name="([^"]*)"/;
  const classNameRe = /\bclassName="([^"]*)"/;
  const map = new Map<string, NodeBase>();
  const classByKey = new Map<string, string>();
  const childKeys = new Set<string>();
  const rootCandidates: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = elementRe.exec(content)) !== null) {
    const tag = String(m[1] || "").toLowerCase();
    const attrs = String(m[2] || "");
    const rawId = String(m[3] || "").trim();
    if (!rawId) continue;
    const key = pathKeyFromNodeId(rawId);
    if (!key) continue;
    const nameMatch = attrs.match(nameRe);
    const dataName = (nameMatch?.[1] || "").trim();
    const cls = (attrs.match(classNameRe)?.[1] || "").trim();
    classByKey.set(key, cls);
    const type =
      tag === "p" || tag === "span" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4"
        ? "TEXT"
        : "FRAME";
    const w = parsePxFromClass(cls, "w") ?? 0;
    const h = parsePxFromClass(cls, "h") ?? 0;

    if (!map.has(key)) {
      map.set(key, {
        id: rawId,
        name: dataName || rawId,
        type,
        w,
        h,
        children: [],
      });
    }
    const node = map.get(key);
    if (node) {
      if (!node.w && w) node.w = w;
      if (!node.h && h) node.h = h;
      const rgba = parseColorFromClass(cls);
      if (rgba && node.type !== "TEXT") {
        node.fills = [{ kind: "solid", ...rgba }];
      }
      // Auto-layout inference from flex classes
      if (/\bflex\b/.test(cls)) {
        const auto: AutoLayout = { layout: /\bflex-col\b/.test(cls) ? "VERTICAL" : "HORIZONTAL" };
        const gap = parseBracketPx(cls, "gap");
        if (typeof gap === "number") auto.itemSpacing = gap;
        const p = parseBracketPx(cls, "p");
        const pt = parseBracketPx(cls, "pt");
        const pr = parseBracketPx(cls, "pr");
        const pb = parseBracketPx(cls, "pb");
        const pl = parseBracketPx(cls, "pl");
        auto.padT = typeof pt === "number" ? pt : typeof p === "number" ? p : undefined;
        auto.padR = typeof pr === "number" ? pr : typeof p === "number" ? p : undefined;
        auto.padB = typeof pb === "number" ? pb : typeof p === "number" ? p : undefined;
        auto.padL = typeof pl === "number" ? pl : typeof p === "number" ? p : undefined;
        node.auto = { ...(node.auto || {}), ...auto };
      }
      // Height fallback from class token e.g. h-[5px]
      const hClass = parseBracketPx(cls, "h");
      if (!node.h && typeof hClass === "number") node.h = hClass;
    }
  }

  if (!map.size) return null;

  // Attach naive text payload for text nodes where inner text is plain.
  const textRe = /<([a-zA-Z][\w-]*)\b[^>]*\bdata-node-id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  while ((m = textRe.exec(content)) !== null) {
    const tag = String(m[1] || "").toLowerCase();
    if (!(tag === "p" || tag === "span" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4")) continue;
    const rawId = String(m[2] || "").trim();
    const key = pathKeyFromNodeId(rawId);
    const inner = String(m[3] || "");
    const plain = sanitizeJsxText(inner);
    if (!plain) continue;
    const node = map.get(key);
    if (node) {
      const cls = classByKey.get(key) || "";
      const fontSize = parseBracketPx(cls, "text");
      const lineHeight = parseBracketPx(cls, "leading");
      const color = parseColorFromClass(cls);
      const align = parseTextAlign(cls);
      const weight = parseFontWeight(cls);
      node.text = {
        raw: plain,
        ...(typeof fontSize === "number" ? { fontSize } : {}),
        ...(typeof lineHeight === "number" ? { lineHeightPx: lineHeight } : {}),
        ...(typeof weight === "number" ? { fontWeight: weight } : {}),
        ...(align ? { align } : {}),
        ...(color ? { color } : {}),
      };
    }
  }

  // Fallback text extraction for TEXT nodes that still have no content
  for (const node of map.values()) {
    if (node.type !== "TEXT" || (node.text && String(node.text.raw || "").trim())) continue;
    const escapedId = String(node.id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`data-node-id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/`, "m");
    const match = content.match(re);
    const plain = sanitizeJsxText(match?.[1] || "");
    if (plain) node.text = { raw: plain };
  }

  // Image extraction: attach image src for nodes that wrap/contain <img>.
  const imgBodyRe = /<([a-zA-Z][\w-]*)\b[^>]*\bdata-node-id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  while ((m = imgBodyRe.exec(content)) !== null) {
    const rawId = String(m[2] || "").trim();
    const key = pathKeyFromNodeId(rawId);
    if (!key) continue;
    const node = map.get(key);
    if (!node) continue;
    const body = String(m[3] || "");
    const srcExpr = body.match(/<img\b[^>]*\bsrc=\{([^}]+)\}[^>]*>/)?.[1] || body.match(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/)?.[1];
    const src = resolveSrcExpr(String(srcExpr || ""));
    if (!src) continue;
    const typeUpper = String(node.type || "").toUpperCase();
    const imageLikeName = /\b(image|img|photo|logo|icon|shutterstock|illustration|avatar)\b/i.test(String(node.name || ""));
    const imageLikeType = typeUpper === "ROUNDED" || typeUpper === "RECTANGLE" || typeUpper === "ELLIPSE" || typeUpper === "VECTOR";
    const canCarryImage = imageLikeName || imageLikeType;
    if (!canCarryImage) continue;
    node.img = {
      src,
      w: Number(node.w || 0),
      h: Number(node.h || 0),
    };
  }

  // Build parent-child relationships from JSX nesting, not from node-id prefixes.
  for (const node of map.values()) node.children = [];
  type StackEntry = { tag: string; key?: string };
  const stack: StackEntry[] = [];
  const tokenRe = /<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g;
  while ((m = tokenRe.exec(content)) !== null) {
    const full = String(m[0] || "");
    const tag = String(m[1] || "").toLowerCase();
    const attrs = String(m[2] || "");
    const isClosing = full.startsWith("</");
    const selfClosing = /\/>\s*$/.test(full);

    if (isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const rawId = (attrs.match(/\bdata-node-id="([^"]+)"/)?.[1] || "").trim();
    const key = rawId ? pathKeyFromNodeId(rawId) : "";
    const hasNode = !!key && map.has(key);
    if (hasNode) {
      const parentKey = [...stack]
        .reverse()
        .map((s) => s.key || "")
        .find((k) => !!k && map.has(k));
      if (parentKey && parentKey !== key) {
        const parent = map.get(parentKey)!;
        const child = map.get(key)!;
        if (!Array.isArray(parent.children)) parent.children = [];
        if (!parent.children.some((c) => c.id === child.id)) {
          parent.children.push(child);
        }
        childKeys.add(key);
      } else if (!rootCandidates.includes(key)) {
        rootCandidates.push(key);
      }
    }

    if (!selfClosing) {
      stack.push({ tag, key: hasNode ? key : undefined });
    }
  }

  // Root selection: exact fallbackRootId path key, then a non-child shortest key.
  const preferredRootKey = fallbackRootId ? pathKeyFromNodeId(fallbackRootId) : "";
  const root =
    (preferredRootKey && map.get(preferredRootKey)) ||
    rootCandidates.map((k) => map.get(k)).find((n): n is NodeBase => !!n) ||
    [...map.entries()]
      .filter(([k]) => !childKeys.has(k))
      .sort((a, b) => a[0].length - b[0].length)[0]?.[1] ||
    [...map.values()][0];

  // If an image landed on a container, move it to a visual child so overlay children survive.
  const promoteImageToChild = (n: NodeBase): void => {
    const kids = n.children || [];
    if (n.img && kids.length > 0) {
      const target = kids.find((c) => {
        const t = String(c.type || "").toUpperCase();
        const name = String(c.name || "");
        return /\b(image|img|photo|logo|icon|shutterstock|illustration|avatar)\b/i.test(name) || t === "ROUNDED" || t === "RECTANGLE";
      });
      if (target) {
        target.img = {
          src: String(n.img.src || ""),
          w: Number(target.w || n.img.w || 0),
          h: Number(target.h || n.img.h || 0),
        };
        delete n.img;
      }
    }
    for (const c of kids) promoteImageToChild(c);
  };
  if (root) promoteImageToChild(root);

  return root || null;
}

function collectNodesByPathKey(root: NodeBase): Map<string, NodeBase> {
  const map = new Map<string, NodeBase>();
  const walk = (n: NodeBase): void => {
    const key = pathKeyFromNodeId(n.id);
    if (key) map.set(key, n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return map;
}

function cloneNode(node: NodeBase): NodeBase {
  return {
    ...node,
    children: (node.children || []).map((c) => cloneNode(c)),
    ...(node.text ? { text: { ...node.text } } : {}),
    ...(node.auto ? { auto: { ...node.auto } } : {}),
    ...(node.bb ? { bb: { ...node.bb } } : {}),
    ...(Array.isArray(node.fills) ? { fills: node.fills.map((f) => ({ ...f })) } : {}),
  };
}

function enrichTreeFromDesignContext(tree: NodeBase, designContext?: string): NodeBase {
  if (!designContext) return tree;
  const hintTree = parseReactLikeDesignContext(designContext, tree.id);
  if (!hintTree) return tree;
  const hints = collectNodesByPathKey(hintTree);
  const allHints = [...hints.entries()];

  const attachHintChildrenByPrefix = (node: NodeBase, nodeKey: string): void => {
    if (Array.isArray(node.children) && node.children.length > 0) return;
    const prefix = `${nodeKey};`;
    const byId = new Map<string, NodeBase>();
    for (const [k, hint] of allHints) {
      if (k.startsWith(prefix)) byId.set(k, hint);
    }
    if (!byId.size) return;
    const depthOf = (k: string): number => k.split(";").length;
    const parentDepth = depthOf(nodeKey);
    const immediate = [...byId.entries()]
      .filter(([k]) => depthOf(k) === parentDepth + 1)
      .map(([, v]) => cloneNode(v));
    if (immediate.length) {
      node.children = immediate;
    }
  };

  const walk = (n: NodeBase): void => {
    const key = pathKeyFromNodeId(n.id);
    const hint = hints.get(key);
    if (hint) {
      if ((!n.text || !String(n.text.raw || "").trim()) && hint.text && String(hint.text.raw || "").trim()) {
        n.text = hint.text;
      }
      if (!n.auto && hint.auto) n.auto = hint.auto;
      if (!n.fills && hint.fills) n.fills = hint.fills;
      if (!n.img && hint.img) n.img = hint.img as { src: string; w: number; h: number };
      if (!n.svg && hint.svg) n.svg = hint.svg as { markup?: string; html?: string };
      if (!n.w && hint.w) n.w = hint.w;
      if (!n.h && hint.h) n.h = hint.h;
      if ((!n.name || n.name === n.id) && hint.name) n.name = hint.name;
      const hintChildren = hint.children || [];
      if ((n.children || []).length === 0 && hintChildren.length > 0) {
        n.children = hintChildren.map((c) => cloneNode(c));
      }
    }
    if ((!n.children || n.children.length === 0) && key) {
      // Metadata and design_context IDs often differ under instances (e.g. "993:3173" vs "I993:3172;...").
      // Prefix attach lets empty metadata nodes inherit meaningful subtree content instead of rendering as empty divs.
      attachHintChildrenByPrefix(n, key);
    }
    for (const c of n.children || []) walk(c);
  };
  walk(tree);
  return tree;
}

function slugToHeading(slug: string): string {
  const cleaned = String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function applyCountersSectionSemanticHints(tree: NodeBase, slug: string): NodeBase {
  const walk = (n: NodeBase, fn: (node: NodeBase) => void): void => {
    fn(n);
    for (const c of n.children || []) walk(c, fn);
  };
  const findFirst = (n: NodeBase, pred: (node: NodeBase) => boolean): NodeBase | undefined => {
    if (pred(n)) return n;
    for (const c of n.children || []) {
      const hit = findFirst(c, pred);
      if (hit) return hit;
    }
    return undefined;
  };

  const h2Node = findFirst(tree, (n) => /^h2$/i.test(String(n.name || "").trim()));
  const pointsNode = findFirst(tree, (n) => /^points$/i.test(String(n.name || "").trim()));
  if (!h2Node || !pointsNode) return tree;
  const hasThreeCards = (pointsNode.children || []).length >= 3;
  if (!hasThreeCards) return tree;

  const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const inferRootPadding = (root: NodeBase): { t: number; r: number; b: number; l: number } => {
    const kids = root.children || [];
    if (!kids.length) return { t: 0, r: 0, b: 0, l: 0 };
    const xs = kids.map((k) => asNum(k.relX));
    const ys = kids.map((k) => asNum(k.relY));
    const rightEdges = kids.map((k) => asNum(k.relX) + asNum(k.w));
    const bottomEdges = kids.map((k) => asNum(k.relY) + asNum(k.h));
    const l = Math.max(0, Math.round(Math.min(...xs)));
    const t = Math.max(0, Math.round(Math.min(...ys)));
    const r = Math.max(0, Math.round(asNum(root.w) - Math.max(...rightEdges)));
    const b = Math.max(0, Math.round(asNum(root.h) - Math.max(...bottomEdges)));
    return { t, r, b, l };
  };
  const inferGap = (a?: NodeBase, b?: NodeBase, axis: "x" | "y" = "y"): number | undefined => {
    if (!a || !b) return undefined;
    if (axis === "x") {
      const g = Math.round(asNum(b.relX) - (asNum(a.relX) + asNum(a.w)));
      return g >= 0 ? g : undefined;
    }
    const g = Math.round(asNum(b.relY) - (asNum(a.relY) + asNum(a.h)));
    return g >= 0 ? g : undefined;
  };

  // If the heading instance arrives empty from metadata, synthesize semantic children.
  if ((h2Node.children || []).length === 0) {
    const heading = slugToHeading(slug) || "Creativity delivers results";
    const headingTextId = `${h2Node.id};synthetic:title`;
    const barId = `${h2Node.id};synthetic:decorativebar`;
    const barColors = ["#EF7B10", "#0098D8", "#B6C0CB", "#74AF27"];
    h2Node.auto = {
      ...(h2Node.auto || {}),
      layout: "VERTICAL",
      itemSpacing: 24,
      primaryAlign: "CENTER",
      counterAlign: "CENTER",
    };
    h2Node.children = [
      {
        id: headingTextId,
        name: heading,
        type: "TEXT",
        w: 1120,
        h: 38,
        children: [],
        text: {
          raw: heading,
          align: "center",
          fontWeight: 600,
          fontSize: 34,
          lineHeightPx: 40,
        },
      },
      {
        id: barId,
        name: "DecorativeBarHorizontal",
        type: "FRAME",
        w: 71,
        h: 5,
        children: barColors.map((hex, i) => {
          const rgb = hex
            .replace("#", "")
            .match(/.{1,2}/g)
            ?.map((v) => parseInt(v, 16) / 255) || [0, 0, 0];
          return {
            id: `${barId};part:${i + 1}`,
            name: `bar-${i + 1}`,
            type: "FRAME",
            w: 17,
            h: 5,
            children: [],
            fills: [{ kind: "solid", r: round(rgb[0]), g: round(rgb[1]), b: round(rgb[2]), a: 1 }],
          } as NodeBase;
        }),
        auto: { layout: "HORIZONTAL", itemSpacing: 0, primaryAlign: "CENTER", counterAlign: "CENTER" },
      },
    ];
  }

  // Root section geometry: vertical stack, centered content, inferred outer padding.
  const rootPad = inferRootPadding(tree);
  const rootGap = inferGap(h2Node, pointsNode, "y");
  tree.auto = {
    ...(tree.auto || {}),
    layout: "VERTICAL",
    itemSpacing: typeof rootGap === "number" ? rootGap : 48,
    padT: rootPad.t || 80,
    padR: rootPad.r || 80,
    padB: rootPad.b || 80,
    padL: rootPad.l || 80,
    primaryAlign: "MIN",
    counterAlign: "CENTER",
    primarySizing: "HUG",
    counterSizing: "FIXED",
  };

  // Heading block should center its children.
  h2Node.auto = {
    ...(h2Node.auto || {}),
    layout: "VERTICAL",
    itemSpacing: asNum(h2Node.auto?.itemSpacing) || 24,
    primaryAlign: "MIN",
    counterAlign: "CENTER",
    primarySizing: "HUG",
    counterSizing: "FIXED",
  };

  // Normalize card text alignment and card layout intent for better render fidelity.
  const firstCard = pointsNode.children?.[0];
  const secondCard = pointsNode.children?.[1];
  const inferredCardGap = inferGap(firstCard, secondCard, "x");
  pointsNode.auto = {
    ...(pointsNode.auto || {}),
    layout: "HORIZONTAL",
    itemSpacing: typeof inferredCardGap === "number" ? inferredCardGap : 32,
    primaryAlign: "MIN",
    counterAlign: "MIN",
    primarySizing: "FIXED",
    counterSizing: "FIXED",
  };

  for (const card of pointsNode.children || []) {
    if (!Array.isArray(card.children)) continue;
    card.auto = {
      ...(card.auto || {}),
      layout: "VERTICAL",
      primaryAlign: "MIN",
      counterAlign: "CENTER",
      primarySizing: "HUG",
      counterSizing: "FIXED",
    };
    const content = card.children.find((c) => String(c.type || "").toUpperCase() === "FRAME");
    if (content) {
      const topPad = Math.max(0, Math.round(asNum(content.relY)));
      const leftPad = Math.max(0, Math.round(asNum(content.relX)));
      const rightPad = Math.max(0, Math.round(asNum(card.w) - (asNum(content.relX) + asNum(content.w))));
      const bottomPad = Math.max(0, Math.round(asNum(card.h) - (asNum(content.relY) + asNum(content.h))));
      content.auto = {
        ...(content.auto || {}),
        layout: "VERTICAL",
        itemSpacing: 16,
        padT: topPad || 16,
        padR: rightPad || 16,
        padB: bottomPad || 16,
        padL: leftPad || 16,
        primaryAlign: "CENTER",
        counterAlign: "CENTER",
        primarySizing: "HUG",
        counterSizing: "FIXED",
      };
    }
  }
  walk(pointsNode, (node) => {
    if (String(node.type || "").toUpperCase() !== "TEXT") return;
    const raw = String(node.text?.raw || node.name || "").trim();
    const isBody = /we are a boutique practice/i.test(raw);
    const isNumber = /^>?[\d]+/.test(raw);
    const isTitle = !isBody && !isNumber;
    node.text = {
      ...(node.text || { raw: node.name || "" }),
      align: "center",
      ...(isNumber ? { fontWeight: 700, fontSize: 80, lineHeightPx: 92 } : {}),
      ...(isTitle ? { fontWeight: 600, fontSize: 24, lineHeightPx: 26 } : {}),
      ...(isBody ? { fontWeight: 400, fontSize: 16, lineHeightPx: 26 } : {}),
    };
  });

  return tree;
}

function applyHeroTopSectionSemanticHints(tree: NodeBase): NodeBase {
  const findFirst = (n: NodeBase, pred: (node: NodeBase) => boolean): NodeBase | undefined => {
    if (pred(n)) return n;
    for (const c of n.children || []) {
      const hit = findFirst(c, pred);
      if (hit) return hit;
    }
    return undefined;
  };
  const hasTopRoot = /^top$/i.test(String(tree.name || "").trim());
  const heroContent = findFirst(tree, (n) => /^hero content$/i.test(String(n.name || "").trim()));
  const heroImageFrame = findFirst(tree, (n) => /^hero$/i.test(String(n.name || "").trim()));
  const breadcrumbs = findFirst(tree, (n) => /^breadcrumbs$/i.test(String(n.name || "").trim()));
  if (!hasTopRoot || !heroContent || !heroImageFrame) return tree;

  // Prevent false-positive dropdown widget conversion on hero sections.
  tree.__widgetSkip = true;
  heroContent.__widgetSkip = true;
  if (breadcrumbs) breadcrumbs.__widgetSkip = true;

  // Avoid landmark upgrade into <header role="banner"> triggered by name "top".
  tree.name = "content section";
  heroContent.name = "content row";
  tree.__mcpNoLandmarks = true;

  const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const padL = Math.max(0, Math.round(asNum(heroContent.relX)));
  const padT = Math.max(0, Math.round(asNum(heroContent.relY)));
  const padR = Math.max(0, Math.round(asNum(tree.w) - (asNum(heroContent.relX) + asNum(heroContent.w))));
  tree.auto = {
    ...(tree.auto || {}),
    layout: "VERTICAL",
    itemSpacing: 0,
    padT: padT || 172,
    padR: padR || 0,
    padB: 0,
    padL: padL || 80,
    primaryAlign: "MIN",
    counterAlign: "MIN",
    primarySizing: "HUG",
    counterSizing: "FIXED",
  };

  heroContent.auto = {
    ...(heroContent.auto || {}),
    layout: "HORIZONTAL",
    itemSpacing: Number(heroContent.auto?.itemSpacing || 56),
    primaryAlign: "MIN",
    counterAlign: "MIN",
    primarySizing: "FIXED",
    counterSizing: "FIXED",
  };

  return tree;
}

function inferInteractiveStatesFromTree(tree: NodeBase): NodeBase {
  type StateKey = "default" | "hover" | "active" | "focus" | "disabled";
  const stateKeys: StateKey[] = ["default", "hover", "active", "focus", "disabled"];
  const statePriority: Record<StateKey, number> = {
    default: 0,
    hover: 1,
    active: 2,
    focus: 3,
    disabled: 4,
  };
  const tokenMatchers: Array<{ key: StateKey; re: RegExp }> = [
    { key: "default", re: /\b(default|base|rest|normal|idle|enabled)\b/i },
    { key: "hover", re: /\b(hover|over|mouse[-\s]?over)\b/i },
    { key: "active", re: /\b(active|pressed|down)\b/i },
    { key: "focus", re: /\b(focus|focused|focus[-\s]?visible)\b/i },
    { key: "disabled", re: /\b(disabled|inactive)\b/i },
  ];
  const stateStripRe = /\b(default|base|rest|normal|idle|enabled|hover|over|mouse[-\s]?over|active|pressed|down|focus|focused|focus[-\s]?visible|disabled|inactive)\b/gi;
  const sepTrimRe = /[\s/_|-]+/g;

  const detectState = (name: string): StateKey | undefined => {
    const s = String(name || "");
    for (const { key, re } of tokenMatchers) {
      if (re.test(s)) return key;
    }
    return undefined;
  };
  const normalizeGroupName = (name: string): string => {
    const s = String(name || "")
      .replace(stateStripRe, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[\[\]]/g, " ")
      .replace(sepTrimRe, " ")
      .trim()
      .toLowerCase();
    return s || "interactive";
  };
  const cloneStateSnapshot = (n: NodeBase): NodeBase => {
    const snap = cloneNode(n);
    const scrub = (x: NodeBase): void => {
      delete x.__states;
      delete x.tw;
      for (const c of x.children || []) scrub(c);
    };
    scrub(snap);
    return snap;
  };

  const walk = (parent: NodeBase): void => {
    const kids = parent.children || [];
    if (kids.length > 1) {
      const groups = new Map<string, Partial<Record<StateKey, NodeBase>>>();
      for (const child of kids) {
        const state = detectState(String(child.name || ""));
        if (!state) continue;
        const groupName = normalizeGroupName(String(child.name || ""));
        const groupKey = `${String(child.type || "").toUpperCase()}::${groupName}`;
        const group = groups.get(groupKey) || {};
        if (!group[state]) group[state] = child;
        groups.set(groupKey, group);
      }

      for (const group of groups.values()) {
        const presentKeys = stateKeys.filter((k) => !!group[k]);
        if (!presentKeys.some((k) => k !== "default")) continue;
        const defaultNode = group.default || group.hover || group.active || group.focus || group.disabled;
        if (!defaultNode) continue;

        const states: Partial<Record<StateKey, NodeBase>> = {};
        states.default = cloneStateSnapshot(defaultNode);
        for (const key of stateKeys) {
          const node = group[key];
          if (!node || key === "default") continue;
          states[key] = cloneStateSnapshot(node);
        }

        // Attach snapshots to the representative live node.
        defaultNode.__states = states as unknown as NodeBase["__states"];

        // If explicit default differs from representative, align start visuals with default.
        if (group.default && group.default !== defaultNode) {
          const def = states.default;
          if (def) {
            if (Array.isArray(def.fills)) defaultNode.fills = def.fills.map((f) => ({ ...f }));
            if (def.stroke) defaultNode.stroke = { ...(def.stroke as Record<string, unknown>) };
            if (Array.isArray(def.shadows)) defaultNode.shadows = def.shadows.map((s) => ({ ...s }));
            if (typeof def.opacity === "number") defaultNode.opacity = def.opacity;
            if (def.blendMode) defaultNode.blendMode = def.blendMode;
            if (def.blur) defaultNode.blur = { ...(def.blur as Record<string, unknown>) };
            if (def.r) defaultNode.r = { ...(def.r as Record<string, unknown>) };
          }
        }
      }
    }

    for (const c of kids) walk(c);
  };

  walk(tree);
  return tree;
}

/**
 * Build plugin AST from MCP bundle.
 * - Uses get_metadata XML for structure when available.
 * - Optionally merges structured JSON from get_design_context if present.
 * - Puts screenshot in meta.screenshot or meta.overlay; variables in meta.variables.
 */
export function normalizeMcpToPluginAst(mcp: McpBundle, opts: NormalizeMcpOpts): AST {
  const slug = opts.slug;
  const type = (opts.type ?? "flexi_block") as AST["type"];
  const frameName = opts.frameName ?? slug;

  let tree: NodeBase;

  const fromStructured = mcp.designContext ? tryParseStructuredDesignContext(mcp.designContext) : null;
  if (fromStructured?.tree && fromStructured.tree.id && Array.isArray(fromStructured.tree.children)) {
    tree = fromStructured.tree;
  } else if (mcp.metadata) {
    const rows = parseMetadataXml(mcp.metadata);
    const pickFallbackParentId = (
      child: { id: string; x: number; y: number; width: number; height: number },
      candidates: Array<{ id: string; x: number; y: number; width: number; height: number }>
    ): string | undefined => {
      let best: { id: string; area: number } | undefined;
      for (const p of candidates) {
        if (p.id === child.id) continue;
        if (p.width < child.width || p.height < child.height) continue;
        const containsAbs =
          child.x >= p.x &&
          child.y >= p.y &&
          child.x + child.width <= p.x + p.width &&
          child.y + child.height <= p.y + p.height;
        const containsRel =
          child.x >= 0 &&
          child.y >= 0 &&
          child.x + child.width <= p.width &&
          child.y + child.height <= p.height;
        if (!containsAbs && !containsRel) continue;
        const area = p.width * p.height;
        if (!best || area < best.area) {
          best = { id: p.id, area };
        }
      }
      return best?.id;
    };

    if (rows.length === 0) {
      // No metadata nodes (e.g. component set selected); try building from design context.
      const fromDc = mcp.designContext ? parseReactLikeDesignContext(mcp.designContext) : null;
      if (fromDc && (fromDc.children?.length || (fromDc.w && fromDc.h))) {
        tree = fromDc;
        if (!tree.name) tree.name = frameName;
      } else {
        tree = {
          id: "root",
          name: frameName,
          type: "FRAME",
          w: 0,
          h: 0,
          children: [],
        };
      }
    } else if (rows.length === 1 && mcp.designContext) {
      // Metadata sometimes returns only the selected node; enrich with hierarchy from design_context.
      const enriched = parseReactLikeDesignContext(mcp.designContext, rows[0].id);
      const rootMetaNode = metadataRowToNode(rows[0]);
      if (enriched) {
        tree = {
          ...enriched,
          id: rootMetaNode.id || enriched.id,
          name: rootMetaNode.name || enriched.name,
          type: rootMetaNode.type || enriched.type,
          w: rootMetaNode.w || enriched.w,
          h: rootMetaNode.h || enriched.h,
          bb: rootMetaNode.bb || enriched.bb,
        };
      } else {
        tree = rootMetaNode;
      }
    } else {
      const rootRow = rows.find((r) => !r.parentId) ?? rows[0];
      const rowsById = new Map(rows.map((r) => [r.id, r]));
      const nodeById = new Map<string, NodeBase>();
      // Build all nodes first.
      for (const r of rows) {
        nodeById.set(r.id, metadataRowToNode(r));
      }
      // Link children using metadata parent id; if missing, infer by geometric containment.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.id === rootRow.id) continue;
        const explicitParentId = row.parentId && nodeById.has(row.parentId) ? row.parentId : undefined;
        const inferredParentId =
          explicitParentId ||
          pickFallbackParentId(
            row,
            rows
              .slice(0, i)
              .filter((p) => p.id !== row.id)
          ) ||
          rootRow.id;
        const parentRow = rowsById.get(inferredParentId) ?? rootRow;
        const parentNode = nodeById.get(inferredParentId) ?? nodeById.get(rootRow.id)!;
        const childNode = metadataRowToNode(row, { x: parentRow.x, y: parentRow.y });
        nodeById.set(row.id, childNode);
        if (!Array.isArray(parentNode.children)) parentNode.children = [];
        parentNode.children.push(childNode);
      }
      tree = nodeById.get(rootRow.id)!;
    }
  } else if (mcp.designContext) {
    // design_context is non-JSON (e.g. code); produce a single root placeholder
    tree = {
      id: "root",
      name: frameName,
      type: "FRAME",
      w: 800,
      h: 600,
      children: [],
    };
  } else {
    tree = {
      id: "root",
      name: frameName,
      type: "FRAME",
      w: 0,
      h: 0,
      children: [],
    };
  }

  if (!Array.isArray(tree.children)) {
    tree.children = [];
  }
  tree = enrichTreeFromDesignContext(tree, mcp.designContext);
  tree = applyHeroTopSectionSemanticHints(tree);
  tree = applyCountersSectionSemanticHints(tree, slug);
  tree = inferInteractiveStatesFromTree(tree);

  const frame = { w: tree.w, h: tree.h };

  const meta: Record<string, unknown> = {
    schema: "figma-ast-mcp",
    version: 1,
    exportedAt: new Date().toISOString(),
    figma: { frameName },
  };
  if (tree.__mcpNoLandmarks) {
    meta.semantics = {
      rootHeroFallback: false,
      upgradeTopLevelFrames: false,
    };
  }
  if (mcp.screenshot) {
    if (typeof mcp.screenshot === "string" && (mcp.screenshot.startsWith("data:") || mcp.screenshot.startsWith("http"))) {
      meta.overlay = { src: mcp.screenshot, w: frame.w, h: frame.h };
    } else {
      meta.screenshot = mcp.screenshot;
    }
  }
  if (mcp.variableDefs) {
    meta.variables = mcp.variableDefs;
  }

  return {
    slug,
    type,
    frame,
    tree,
    slots: {},
    meta,
  };
}
