// generator/qa/aiTieBreaker.js — Optional AI tie-breaker when >=2 plausible fix bundles; class-only, strict schema

/** Valid ops for class-only patches */
const VALID_OPS = new Set(["classAdd", "classRemove", "classReplace"]);

/** Max keys AI may touch: target + at most 2 related (parent + sibling) */
const MAX_PATCH_KEYS = 3;

/** Max patches in a single AI response */
const MAX_PATCHES_PER_CALL = 5;

/** Token budget for AI response */
const AI_MAX_OUTPUT_TOKENS = 512;

/**
 * Validate a single patch against the schema.
 * @param {unknown} patch
 * @returns {{ ok: true, patch: { targetKey: string, op: string, classes: string[] } } | { ok: false, error: string }}
 */
export function validatePatchSchema(patch) {
  if (patch == null || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "patch must be an object" };
  }
  const p = /** @type {Record<string, unknown>} */ (patch);
  const targetKey = p.targetKey;
  const op = p.op;
  const classes = p.classes;

  if (typeof targetKey !== "string" || !targetKey.trim()) {
    return { ok: false, error: "patch.targetKey must be a non-empty string" };
  }
  if (typeof op !== "string" || !VALID_OPS.has(op)) {
    return { ok: false, error: "patch.op must be classAdd, classRemove, or classReplace" };
  }
  if (!Array.isArray(classes)) {
    return { ok: false, error: "patch.classes must be an array" };
  }
  const classList = classes.filter((c) => typeof c === "string").map((c) => String(c).trim()).filter(Boolean);
  if (op === "classReplace" && classList.length % 2 !== 0) {
    return { ok: false, error: "classReplace requires even number of class pairs" };
  }

  return {
    ok: true,
    patch: { targetKey: String(targetKey).trim(), op, classes: classList },
  };
}

/**
 * Validate that patch only contains class-related fields (no tag, structure, etc.).
 */
export function validateClassOnly(patch) {
  if (!patch || typeof patch !== "object") return false;
  const allowed = new Set(["targetKey", "op", "classes"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

/**
 * Enforce: at most MAX_PATCH_KEYS unique targetKeys, and each must be in allowedKeys.
 * @param {Array<{ targetKey: string, op: string, classes: string[] }>} patches
 * @param {Set<string>} allowedKeys
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validatePatchKeyCount(patches, allowedKeys) {
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: "patches must be a non-empty array" };
  }
  if (patches.length > MAX_PATCHES_PER_CALL) {
    return { ok: false, error: `at most ${MAX_PATCHES_PER_CALL} patches per call` };
  }
  const uniqueKeys = new Set(patches.map((p) => p.targetKey));
  if (uniqueKeys.size > MAX_PATCH_KEYS) {
    return { ok: false, error: `at most ${MAX_PATCH_KEYS} target keys (target + 2 related)` };
  }
  for (const key of uniqueKeys) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `targetKey "${key}" not in allowed keys` };
    }
  }
  return { ok: true };
}

/**
 * Build allowed keys for AI: targetKeys from candidates + parent + one sibling per target from layout.
 * @param {Array<{ issue: { targetKey: string }, suggestedFix: object }>} candidateFixBundles
 * @param {Array<{ nodeId: string, dataKey?: string, parentNodeId?: string }>} layout
 * @returns {Set<string>}
 */
export function buildAllowedKeys(candidateFixBundles, layout) {
  const keys = new Set();
  const byNodeId = new Map((layout || []).map((el) => [String(el?.nodeId ?? ""), el]));
  const byDataKey = new Map((layout || []).map((el) => [String((el?.dataKey || el?.nodeId) ?? "").trim(), el]));

  for (const { issue } of candidateFixBundles) {
    const targetKey = issue?.targetKey;
    if (targetKey) keys.add(String(targetKey).trim());
    const el = byDataKey.get(String(targetKey).trim()) || byNodeId.get(String(targetKey).trim());
    if (el?.parentNodeId) {
      const parent = byNodeId.get(String(el.parentNodeId));
      if (parent) {
        const pk = (parent?.dataKey || parent?.nodeId || "").trim();
        if (pk) keys.add(pk);
      }
    }
    if (el?.parentNodeId) {
      const siblings = (layout || []).filter((n) => n?.parentNodeId === el.parentNodeId && n?.nodeId !== el?.nodeId);
      if (siblings[0]) {
        const sk = (siblings[0]?.dataKey || siblings[0]?.nodeId || "").trim();
        if (sk) keys.add(sk);
      }
    }
  }
  return keys;
}

/**
 * Select fix using AI when multiple plausible bundles exist. Returns patches in existing patch format.
 * Guardrails: schema validation, class-only, key count; on invalid output falls back to first candidate.
 * @param {Array<{ issue: object, suggestedFix: { op: string, classes: string[] } }>} candidateFixBundles
 * @param {{ expectedRects: object, outputRects: object, offenders: object[], layout: object[], breakpoint: string }} evidence
 * @param {{ complete: (opts: { system: string, user: string, maxOutputTokens?: number, temperature?: number }) => Promise<{ text: string }> }} aiClient
 * @param {{ allowedKeys: Set<string> }} options
 * @returns {Promise<{ patches: Array<{ targetKey: string, op: string, classes: string[] }>, reasoning?: string, usedAI: boolean }>}
 */
export async function selectFixWithAI(candidateFixBundles, evidence, aiClient, options = {}) {
  const allowedKeys = options.allowedKeys || new Set();
  const fallbackPatches = [];
  for (const { issue, suggestedFix } of candidateFixBundles) {
    if (!suggestedFix?.classes?.length) continue;
    fallbackPatches.push({
      targetKey: String(issue?.targetKey ?? "").trim(),
      op: String(suggestedFix.op || "classAdd").trim(),
      classes: [...suggestedFix.classes],
    });
  }
  if (fallbackPatches.length === 0) {
    return { patches: [], usedAI: false };
  }

  const system = [
    "You are a tie-breaker for a visual QA system. Output JSON only, no markdown.",
    "Schema: { patches: [{ targetKey: string, op: \"classAdd\"|\"classRemove\"|\"classReplace\", classes: string[] }], reasoning?: string }",
    "Rules: only Tailwind class names; only targetKey, op, classes; no tags, no structure, no new libraries.",
    `You may touch at most ${MAX_PATCH_KEYS} keys (one target + up to 2 related). At most ${MAX_PATCHES_PER_CALL} patches.`,
  ].join("\n");

  const currentClasses = {};
  for (const el of evidence.layout || []) {
    const k = (el?.dataKey || el?.nodeId || "").trim();
    if (k) currentClasses[k] = String(el?.className ?? "").trim().split(/\s+/).filter(Boolean);
  }

  const user = JSON.stringify({
    breakpoint: evidence.breakpoint,
    expectedRects: evidence.expectedRects,
    outputRects: evidence.outputRects,
    offenders: (evidence.offenders || []).slice(0, 15),
    currentClasses,
    candidateFixBundles: candidateFixBundles.map((b) => ({
      targetKey: b.issue?.targetKey,
      suggestedFix: b.suggestedFix,
      confidence: b.issue?.confidence,
    })),
    allowedKeys: Array.from(allowedKeys),
  });

  let text = "";
  try {
    const out = await aiClient.complete({
      system,
      user,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      temperature: 0.1,
    });
    text = String(out?.text ?? "").trim();
  } catch {
    return { patches: fallbackPatches.slice(0, MAX_PATCHES_PER_CALL), usedAI: false };
  }

  const parsed = parseJsonPatches(text);
  if (!parsed?.patches?.length) {
    return { patches: fallbackPatches.slice(0, MAX_PATCHES_PER_CALL), reasoning: "invalid or empty AI response", usedAI: false };
  }

  const validated = [];
  for (const p of parsed.patches.slice(0, MAX_PATCHES_PER_CALL)) {
    const schema = validatePatchSchema(p);
    if (!schema.ok) continue;
    if (!validateClassOnly(schema.patch)) continue;
    validated.push(schema.patch);
  }

  const keyCheck = validatePatchKeyCount(validated, allowedKeys);
  if (!keyCheck.ok) {
    return { patches: fallbackPatches.slice(0, MAX_PATCHES_PER_CALL), reasoning: keyCheck.error, usedAI: false };
  }

  return {
    patches: validated,
    reasoning: parsed.reasoning ? String(parsed.reasoning).slice(0, 200) : undefined,
    usedAI: true,
  };
}

function parseJsonPatches(text) {
  const raw = String(text || "").trim();
  const strip = raw.replace(/^```\w*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try {
    return JSON.parse(strip);
  } catch {
    const m = strip.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}
