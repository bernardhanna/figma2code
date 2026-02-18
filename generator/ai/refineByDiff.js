// generator/ai/refineByDiff.js
import fs from "node:fs";
import path from "node:path";

const ALLOWED_PATCH_KEYS = new Set(["classAdd", "classRemove", "classReplace", "style"]);
const DANGEROUS_STYLE_KEYS = new Set([
  "position",
  "z-index",
  "zIndex",
  "behavior",
  "content",
  "filter",
  "backdrop-filter",
  "backdropFilter",
]);
const SAFE_TOKEN_RE = /^[^\s<>"'`]+$/;

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function normalizeToken(token) {
  return String(token || "").trim();
}

function isSafeToken(token) {
  const t = normalizeToken(token);
  return !!t && SAFE_TOKEN_RE.test(t);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]);
    } catch {
      return {};
    }
  }
}

export function buildRefinePrompt({
  bucket,
  offenders,
  passDiffRatio,
  currentDiffRatio,
}) {
  const safeBucket = String(bucket || "desktop").toLowerCase();
  const top = Array.isArray(offenders) ? offenders : [];
  const offenderPayload = top.map((o) => ({
    nodeId: String(o?.nodeId || ""),
    diffRatio: Number(o?.ratio || 0),
    diffPixels: Number(o?.pixels || 0),
    bbox: o?.bbox || null,
    className: String(o?.className || ""),
    parentClassName: String(o?.parentClassName || ""),
  }));

  const system = [
    "You are a surgical frontend diff-refinement assistant.",
    "STRICT RULES:",
    "- Do NOT output HTML.",
    "- Do NOT change DOM structure, tags, attributes outside patch schema, or text.",
    "- Output JSON object only, keyed by nodeId.",
    "- Allowed patch keys only: classAdd, classRemove, classReplace, style.",
    "- classAdd/classRemove must be arrays of single class tokens (no spaces inside one token).",
    "- classReplace must map one exact class token to one exact class token.",
    "- style should be minimal and used only if utility classes cannot express the fix.",
    "- Do not remove accessibility classes (focus-visible rings etc.).",
    "- Avoid absolute/fixed positioning unless clearly overlay-layer.",
  ].join("\n");

  const user = {
    task: "Refine visual diffs with patches only.",
    bucket: safeBucket,
    target: {
      currentDiffRatio: Number(currentDiffRatio || 0),
      passDiffRatio: Number(passDiffRatio || 0.01),
    },
    offenders: offenderPayload,
    outputSchema: {
      "<nodeId>": {
        classAdd: ["token"],
        classRemove: ["token"],
        classReplace: { fromToken: "toToken" },
        style: { propertyName: "value" },
      },
    },
    outputConstraints: {
      jsonOnly: true,
      noCommentary: true,
      omitUnchangedNodes: true,
    },
  };

  return {
    system,
    user: JSON.stringify(user),
  };
}

export function validateAndNormalizePatchMap(rawPatchMap, { allowDangerousStyle = false } = {}) {
  const patchMap = asObj(rawPatchMap);
  const accepted = {};
  const rejected = [];

  if (!patchMap) {
    return { accepted, rejected: [{ reason: "patch payload is not an object" }] };
  }

  for (const nodeId of Object.keys(patchMap)) {
    const patch = asObj(patchMap[nodeId]);
    if (!patch) {
      rejected.push({ nodeId, reason: "patch entry is not an object" });
      continue;
    }

    const unknownKeys = Object.keys(patch).filter((k) => !ALLOWED_PATCH_KEYS.has(k));
    if (unknownKeys.length) {
      rejected.push({ nodeId, reason: `unknown patch keys: ${unknownKeys.join(",")}` });
      continue;
    }

    const out = {};

    const classAdd = Array.isArray(patch.classAdd) ? patch.classAdd : [];
    const classRemove = Array.isArray(patch.classRemove) ? patch.classRemove : [];
    const classReplace = asObj(patch.classReplace) || {};
    const style = asObj(patch.style) || {};

    const normAdd = [];
    for (const token of classAdd) {
      if (!isSafeToken(token)) {
        rejected.push({ nodeId, reason: `invalid classAdd token: ${String(token || "")}` });
        continue;
      }
      normAdd.push(normalizeToken(token));
    }
    const normRemove = [];
    for (const token of classRemove) {
      if (!isSafeToken(token)) {
        rejected.push({ nodeId, reason: `invalid classRemove token: ${String(token || "")}` });
        continue;
      }
      normRemove.push(normalizeToken(token));
    }

    const normReplace = {};
    for (const from of Object.keys(classReplace)) {
      const to = classReplace[from];
      if (!isSafeToken(from) || !isSafeToken(to)) {
        rejected.push({ nodeId, reason: `invalid classReplace pair: ${from} -> ${String(to || "")}` });
        continue;
      }
      normReplace[normalizeToken(from)] = normalizeToken(to);
    }

    const normStyle = {};
    for (const key of Object.keys(style)) {
      const k = String(key || "").trim();
      const v = String(style[key] || "").trim();
      if (!k || !v) {
        rejected.push({ nodeId, reason: `empty style key/value: ${k}` });
        continue;
      }
      if (!allowDangerousStyle && DANGEROUS_STYLE_KEYS.has(k)) {
        rejected.push({ nodeId, reason: `dangerous style key blocked: ${k}` });
        continue;
      }
      if (/[<>{}]/.test(v) || /javascript:/i.test(v)) {
        rejected.push({ nodeId, reason: `unsafe style value for ${k}` });
        continue;
      }
      normStyle[k] = v;
    }

    if (normAdd.length) out.classAdd = uniq(normAdd);
    if (normRemove.length) out.classRemove = uniq(normRemove);
    if (Object.keys(normReplace).length) out.classReplace = normReplace;
    if (Object.keys(normStyle).length) out.style = normStyle;

    if (Object.keys(out).length) {
      accepted[nodeId] = out;
    }
  }

  return { accepted, rejected };
}

export function mergePatchMaps(baseMap, overrideMap) {
  const base = asObj(baseMap) || {};
  const over = asObj(overrideMap) || {};
  const out = JSON.parse(JSON.stringify(base));

  for (const nodeId of Object.keys(over)) {
    const src = asObj(over[nodeId]) || {};
    const dst = asObj(out[nodeId]) || {};
    const merged = { ...dst };

    const add = uniq([...(Array.isArray(dst.classAdd) ? dst.classAdd : []), ...(Array.isArray(src.classAdd) ? src.classAdd : [])]);
    const remove = uniq([...(Array.isArray(dst.classRemove) ? dst.classRemove : []), ...(Array.isArray(src.classRemove) ? src.classRemove : [])]);
    const replace = { ...(asObj(dst.classReplace) || {}), ...(asObj(src.classReplace) || {}) };
    const style = { ...(asObj(dst.style) || {}), ...(asObj(src.style) || {}) };

    if (add.length) merged.classAdd = add;
    if (remove.length) merged.classRemove = remove;
    if (Object.keys(replace).length) merged.classReplace = replace;
    if (Object.keys(style).length) merged.style = style;

    out[nodeId] = merged;
  }
  return out;
}

export function patchesFilePath(outDir, bucket) {
  const b = String(bucket || "").trim().toLowerCase();
  if (!b || b === "all") return path.join(outDir, "patches.json");
  return path.join(outDir, `patches.${b}.json`);
}

export function readPatchMap(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return asObj(raw) || {};
  } catch {
    return {};
  }
}

export function writePatchMap(filePath, map) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(asObj(map) || {}, null, 2), "utf8");
}

export async function proposeRefinePatchMap({
  aiClient,
  bucket,
  offenders,
  passDiffRatio,
  currentDiffRatio,
}) {
  const { system, user } = buildRefinePrompt({
    bucket,
    offenders,
    passDiffRatio,
    currentDiffRatio,
  });
  const result = await aiClient.complete({
    system,
    user,
    maxOutputTokens: 2200,
    temperature: 0,
  });
  const parsed = parseJsonObject(result?.text || "");
  const { accepted, rejected } = validateAndNormalizePatchMap(parsed);
  return { accepted, rejected, rawText: result?.text || "" };
}
