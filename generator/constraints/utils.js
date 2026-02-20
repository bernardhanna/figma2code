// generator/constraints/utils.js

export function num(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function areaOverlapRatio(a, b) {
  if (!a || !b) return 0;
  const ax2 = num(a.x) + num(a.w);
  const ay2 = num(a.y) + num(a.h);
  const bx2 = num(b.x) + num(b.w);
  const by2 = num(b.y) + num(b.h);

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(num(a.x), num(b.x)));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(num(a.y), num(b.y)));
  const inter = ix * iy;
  const denom = Math.max(1, num(a.w) * num(a.h));
  return inter / denom;
}

export function classTokens(className) {
  return String(className || "")
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasInlineDisplayClass(tokens) {
  const set = new Set(tokens);
  return set.has("inline") || set.has("inline-block") || set.has("inline-flex");
}

export function findFixedWidthTokens(tokens) {
  return tokens.filter((t) => /^(?:\w+:)?(?:w-\[[^\]]+\]|w-\d+)$/.test(t) && !/w-full$/.test(t));
}

export function findFixedHeightTokens(tokens) {
  return tokens.filter((t) => /^(?:\w+:)?h-\[[^\]]+\]|^(?:\w+:)?h-\d+$/.test(t));
}

export function parseHtmlNodeIndex(html) {
  const raw = String(html || "");
  // Some artifact payloads embed the generated markup HTML-escaped.
  // Decode a minimal set so tag/attribute regexes can still index nodes.
  const source = raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  const rows = [];
  const re =
    /<([a-zA-Z0-9:-]+)([^>]*?\sdata-node-id=(["'])(.*?)\3[^>]*|[^>]*?\sdata-node=(["'])(.*?)\5[^>]*)([^>]*)>/g;

  let m;
  while ((m = re.exec(source))) {
    const tag = String(m[1] || "").toLowerCase();
    const attrText = String(m[2] || "") + String(m[7] || "");
    const idMatch = attrText.match(/\sdata-node-id=(["'])(.*?)\1/) || attrText.match(/\sdata-node=(["'])(.*?)\1/);
    const keyMatch = attrText.match(/\sdata-key=(["'])(.*?)\1/);
    const classMatch = attrText.match(/\sclass=(["'])(.*?)\1/);
    const roleMatch = attrText.match(/\srole=(["'])(.*?)\1/);
    const nodeId = idMatch ? String(idMatch[2] || "") : "";
    if (!nodeId) continue;
    rows.push({
      nodeId,
      key: keyMatch ? String(keyMatch[2] || "") : "",
      tag,
      className: classMatch ? String(classMatch[2] || "") : "",
      role: roleMatch ? String(roleMatch[2] || "").toLowerCase() : "",
    });
  }

  const byId = new Map();
  const byKey = new Map();
  for (const row of rows) {
    byId.set(row.nodeId, row);
    if (row.key) byKey.set(row.key, row);
  }
  return { rows, byId, byKey };
}

export function resolveNodeInfo(nodeIndex, targetKey) {
  if (!nodeIndex) return null;
  const key = String(targetKey || "").trim();
  if (!key) return null;
  return nodeIndex.byKey.get(key) || nodeIndex.byId.get(key) || null;
}

export function isInteractiveNode(info) {
  if (!info) return false;
  const tag = String(info.tag || "").toLowerCase();
  const role = String(info.role || "").toLowerCase();
  const cls = String(info.className || "").toLowerCase();
  if (tag === "button" || tag === "a" || tag === "input") return true;
  if (role === "button") return true;
  return /btn|cta|button/.test(cls);
}

export function isMediaNode(info) {
  if (!info) return false;
  const tag = String(info.tag || "").toLowerCase();
  const cls = String(info.className || "").toLowerCase();
  if (tag === "img" || tag === "picture" || tag === "video") return true;
  return /object-cover|object-contain|bg-cover|bg-no-repeat/.test(cls);
}

export function makeIssue({ issueType, bp, confidence, targetKey, candidates, evidence }) {
  return {
    issueType: String(issueType || "").trim(),
    bp: String(bp || "").trim(),
    confidence: clamp01(confidence),
    targetKey: String(targetKey || "").trim(),
    candidates: Array.isArray(candidates) ? candidates : [],
    evidence: evidence && typeof evidence === "object" ? evidence : {},
  };
}

export function makeCandidate(score, patches) {
  return {
    score: clamp01(score),
    patches: Array.isArray(patches) ? patches : [],
  };
}

export function makePatch(targetKey, op, classes) {
  return {
    targetKey: String(targetKey || "").trim(),
    op: String(op || "classAdd").trim(),
    classes: Array.isArray(classes) ? classes.map((c) => String(c || "").trim()).filter(Boolean) : [],
  };
}

export function validatePatchShape(patch) {
  if (!patch || typeof patch !== "object") return false;
  if (!patch.targetKey || !patch.op || !Array.isArray(patch.classes)) return false;
  const op = String(patch.op);
  if (!["classAdd", "classRemove", "classReplace"].includes(op)) return false;
  return patch.classes.every((c) => typeof c === "string" && c.trim().length > 0);
}

export function validateIssueShape(issue) {
  if (!issue || typeof issue !== "object") return false;
  if (!issue.issueType || !issue.bp || !issue.targetKey) return false;
  if (!Array.isArray(issue.candidates)) return false;
  for (const c of issue.candidates) {
    if (!c || typeof c !== "object" || !Array.isArray(c.patches)) return false;
    if (typeof c.score !== "number" || Number.isNaN(c.score)) return false;
    for (const p of c.patches) {
      if (!validatePatchShape(p)) return false;
    }
  }
  return true;
}

