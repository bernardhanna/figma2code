import { evaluateImprovement } from "../server/refineGate.js";

function normalizeSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function parseAiRecodeJsonStrict(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return { ok: false, error: "empty-output", value: null };
  if (!(txt.startsWith("{") && txt.endsWith("}"))) {
    return { ok: false, error: "non-json-output", value: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    return { ok: false, error: "invalid-json", value: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "json-not-object", value: null };
  }
  const html = String(parsed.html || "").trim();
  if (!html) return { ok: false, error: "missing-html", value: null };
  return { ok: true, error: null, value: parsed };
}

export function extractTextTokens(html) {
  const src = String(html || "");
  const noScript = src
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = noScript.replace(/<[^>]+>/g, "\n");
  return text
    .split(/\n+/g)
    .map((t) => normalizeSpace(t))
    .filter(Boolean);
}

export function extractUrlTokens(html) {
  const src = String(html || "");
  const out = [];
  const re = /\b(?:src|href)\s*=\s*(['"])(.*?)\1/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push(String(m[2] || "").trim());
  }
  return out.filter(Boolean).sort();
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

export function validateAiRecodeCandidate({ baselineHtml, candidateHtml }) {
  const base = String(baselineHtml || "");
  const cand = String(candidateHtml || "").trim();
  const reasons = [];

  if (!cand) reasons.push("empty-html");
  if (/<script\b/i.test(cand) || /<style\b/i.test(cand)) reasons.push("disallowed-script-or-style-tag");
  if (/\son[a-z]+\s*=/i.test(cand)) reasons.push("disallowed-inline-js-attr");
  if (/\sstyle\s*=/i.test(cand)) reasons.push("disallowed-style-attr");
  if (/<link\b[^>]*rel\s*=\s*['"]stylesheet['"]/i.test(cand)) reasons.push("disallowed-external-css");

  const rootMatch = cand.match(/^\s*<([a-z][a-z0-9-]*)\b[\s\S]*<\/\1>\s*$/i);
  if (!rootMatch) reasons.push("not-single-root-wrapper");
  const rootTag = String(rootMatch?.[1] || "").toLowerCase();
  if (rootTag && !["section", "div", "main", "article"].includes(rootTag)) {
    reasons.push("invalid-root-tag");
  }

  const baseText = extractTextTokens(base);
  const candText = extractTextTokens(cand);
  if (!sameMultiset(baseText, candText)) reasons.push("changed-text-content");

  const baseUrls = extractUrlTokens(base);
  const candUrls = extractUrlTokens(cand);
  if (!sameMultiset(baseUrls, candUrls)) reasons.push("changed-src-href-urls");

  return {
    ok: reasons.length === 0,
    reasons,
    checks: {
      keptText: !reasons.includes("changed-text-content"),
      keptLinks: !reasons.includes("changed-src-href-urls"),
      keptAssetUrls: !reasons.includes("changed-src-href-urls"),
      tailwindOnly:
        !reasons.includes("disallowed-script-or-style-tag") &&
        !reasons.includes("disallowed-inline-js-attr") &&
        !reasons.includes("disallowed-style-attr") &&
        !reasons.includes("disallowed-external-css"),
      singleRootWrapper:
        !reasons.includes("not-single-root-wrapper") &&
        !reasons.includes("invalid-root-tag"),
    },
  };
}

export function shouldAcceptAiRecode({
  beforeDiff,
  afterDiff,
  epsilon = 0.0005,
  meaningfulDelta = 0.001,
}) {
  const gate = evaluateImprovement({ beforeDiff, afterDiff, epsilon });
  const improvedBy = Number(gate?.improvedBy || 0);
  const accept = improvedBy > Math.max(Number(epsilon || 0.0005), Number(meaningfulDelta || 0.001));
  return {
    accept,
    improvedBy,
    reason: accept ? "accepted" : improvedBy < 0 ? "worsened" : "no-meaningful-improvement",
  };
}

export function summarizeLayoutForPrompt(layout = []) {
  const rows = Array.isArray(layout) ? layout : [];
  const nodes = rows.slice(0, 220).map((n) => ({
    nodeId: String(n?.nodeId || ""),
    tag: String(n?.tag || ""),
    className: String(n?.className || ""),
    bbox: n?.bbox || null,
    styles: {
      fontSize: String(n?.styles?.fontSize || ""),
      fontWeight: String(n?.styles?.fontWeight || ""),
      lineHeight: String(n?.styles?.lineHeight || ""),
      letterSpacing: String(n?.styles?.letterSpacing || ""),
    },
  }));
  const flexCount = rows.filter((n) => /\bflex\b/.test(String(n?.className || ""))).length;
  const gridCount = rows.filter((n) => /\bgrid\b/.test(String(n?.className || ""))).length;
  const typography = rows
    .filter((n) => n?.styles?.fontSize || n?.styles?.fontWeight)
    .slice(0, 80)
    .map((n) => ({
      nodeId: String(n?.nodeId || ""),
      fontSize: String(n?.styles?.fontSize || ""),
      fontWeight: String(n?.styles?.fontWeight || ""),
      lineHeight: String(n?.styles?.lineHeight || ""),
      letterSpacing: String(n?.styles?.letterSpacing || ""),
    }));
  return {
    nodes,
    typography,
    layoutModelHints: { flexCount, gridCount },
  };
}

