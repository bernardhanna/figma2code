// generator/auto/mergeResponsiveFragments.js
//
// mergeResponsiveFragments({ mobileHtml, desktopHtml, tabletHtml? }) => mergedHtml
//
// PREVIEW MODE (bucket driven):
// - Base DOM is DESKTOP (if provided).
// - Tablet/mobile differences become bucket-prefixed Tailwind classes:
//   - tablet: [[data-bucket="tablet"]_&]:
//   - mobile: [[data-bucket="mobile"]_&]:
//
// Why bucket-prefix?
// - Tailwind responsive variants (max-md, lg, etc.) depend on the REAL browser viewport width,
//   not the inner "device frame" width you change in preview.
// - Your preview buttons change --vpw, not window.innerWidth.
// - Bucket prefixes follow cmp_root[data-bucket="..."], so the buttons truly emulate breakpoints.
//
// IMPORTANT FIX:
// Your exported frames are not true variants (node IDs differ across frames).
// data-key/data-node often won't match across desktop/mobile.
// We add a secondary matching key for text-bearing elements:
//   tag family + normalized innerText
// Example: h1/h2/h3 -> "text:heading|experience clarity results"
//          p         -> "text:p|driven by values since 1882."
//
// This is best-effort and designed for your generated HTML (not a full HTML parser).

function isStr(x) {
  return typeof x === "string";
}

function uniqKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = String(s || "");
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function splitClassTokens(s) {
  return String(s || "")
    .trim()
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Detect tokens that already encode breakpoint/media/bucket condition; do not double-prefix.
function hasExplicitBreakpointPrefix(token) {
  const t = String(token || "").trim();
  if (!t) return false;

  // Standard breakpoints
  if (/^(sm|md|lg|xl|2xl):/.test(t)) return true;

  // Tailwind max-* syntax
  if (/^max-(sm|md|lg|xl|2xl):/.test(t)) return true;

  // Arbitrary variants / media queries
  if (/^(min|max)-\[[^\]]+\]:/.test(t)) return true;
  if (/^\[[^\]]+\]:/.test(t)) return true;

  // Container queries like @lg:, @[400px]:
  if (/^@\S+:/.test(t)) return true;

  return false;
}

/**
 * Prefix token with possibly multi-variant prefix chain.
 * Example prefix: [[data-bucket="mobile"]_&]
 */
function prefixToken(token, prefixChain) {
  const t = String(token || "").trim();
  const p = String(prefixChain || "").trim();
  if (!t) return "";
  if (!p) return t;
  if (hasExplicitBreakpointPrefix(t)) return t;
  return `${p}:${t}`;
}

// Supports class/id/data-node/data-key attributes with single OR double quotes
function getAttr(attrs, name) {
  const s = String(attrs || "");
  // name="..."
  let m = s.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  if (m && m[1] != null) return m[1];
  // name='...'
  m = s.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  if (m && m[1] != null) return m[1];
  return "";
}

/**
 * Your data-key strings include a root segment like:
 *   frame:hero_v3@desktop/...
 *   frame:hero_v3@mobile/...
 * We remove the first segment to reduce variance.
 *
 * NOTE: Node IDs still differ later in the path, so we ALSO use text-key fallback.
 */
function normalizeDataKey(dataKey) {
  const s = String(dataKey || "").trim();
  if (!s) return "";
  return s.replace(/^[^/]+\/+/, "");
}

function normalizeTextForKey(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTextBearingTag(tag) {
  const t = String(tag || "").toLowerCase();
  return (
    t === "h1" ||
    t === "h2" ||
    t === "h3" ||
    t === "h4" ||
    t === "h5" ||
    t === "h6" ||
    t === "p" ||
    t === "span" ||
    t === "a" ||
    t === "button" ||
    t === "li" ||
    t === "label" ||
    t === "strong" ||
    t === "em"
  );
}

/**
 * Extracts:
 * - primaryKey -> class
 * - textKey (tagFamily|normalizedText) -> primaryKey (only if text-bearing)
 */
function extractMaps(html) {
  const classByKey = new Map();
  const textKeyToPrimary = new Map();

  const tokenRe = /<([a-zA-Z0-9:-]+)([^>]*?)>/g;
  const tagCount = new Map();

  let m;
  while ((m = tokenRe.exec(html))) {
    const tag = m[1];
    const attrs = m[2] || "";
    const fullOpen = m[0];
    const openStart = m.index;
    const openEnd = openStart + fullOpen.length;

    const hasClassAttr = /\bclass\s*=/.test(attrs);
    if (!hasClassAttr) continue;

    const rawDataKey = getAttr(attrs, "data-key");
    const dataKey = normalizeDataKey(rawDataKey);
    const dataNode = getAttr(attrs, "data-node");
    const id = getAttr(attrs, "id");
    const cls = getAttr(attrs, "class");

    let primaryKey = "";
    if (dataKey) primaryKey = `data-key:${dataKey}`;
    else if (dataNode) primaryKey = `data-node:${dataNode}`;
    else if (id) primaryKey = `id:${id}`;
    else {
      const n = (tagCount.get(tag) || 0) + 1;
      tagCount.set(tag, n);
      primaryKey = `tag:${tag}#${n}`;
    }

    classByKey.set(primaryKey, String(cls || "").trim());

    // Secondary key for text-bearing tags
    if (isTextBearingTag(tag)) {
      const closeTag = `</${tag}>`;
      const closeIdx = html.indexOf(closeTag, openEnd);
      if (closeIdx !== -1) {
        const innerRaw = html.slice(openEnd, closeIdx);

        // Strip nested tags; keep text-ish content.
        const innerText = normalizeTextForKey(innerRaw.replace(/<[^>]+>/g, " "));
        if (innerText) {
          const t = String(tag).toLowerCase();
          const isHeading = /^h[1-6]$/.test(t);

          // IMPORTANT: match h1..h6 across variants as "heading"
          const family = isHeading ? "heading" : t;

          const tKey = `text:${family}|${innerText}`;
          if (!textKeyToPrimary.has(tKey)) textKeyToPrimary.set(tKey, primaryKey);
        }
      }
    }
  }

  return { classByKey, textKeyToPrimary };
}

function replaceClassAttr(html, keyToNewClass) {
  const tokenRe = /<([a-zA-Z0-9:-]+)([^>]*?)>/g;

  const tagCount = new Map();
  let out = "";
  let lastIndex = 0;
  let m;

  while ((m = tokenRe.exec(html))) {
    const full = m[0];
    const tag = m[1];
    const attrs = m[2] || "";

    const start = m.index;
    const end = m.index + full.length;

    out += html.slice(lastIndex, start);

    const rawDataKey = getAttr(attrs, "data-key");
    const dataKey = normalizeDataKey(rawDataKey);
    const dataNode = getAttr(attrs, "data-node");
    const id = getAttr(attrs, "id");

    let key = "";
    if (dataKey) key = `data-key:${dataKey}`;
    else if (dataNode) key = `data-node:${dataNode}`;
    else if (id) key = `id:${id}`;
    else {
      const n = (tagCount.get(tag) || 0) + 1;
      tagCount.set(tag, n);
      key = `tag:${tag}#${n}`;
    }

    const nextClass = keyToNewClass.get(key);
    if (!nextClass) {
      out += full;
      lastIndex = end;
      continue;
    }

    const safe = nextClass.replace(/"/g, "&quot;");

    let replaced = full;
    if (/\bclass\s*=\s*"/.test(full)) {
      replaced = full.replace(/\bclass\s*=\s*"([^"]*)"/, `class="${safe}"`);
    } else if (/\bclass\s*=\s*'/.test(full)) {
      replaced = full.replace(/\bclass\s*=\s*'([^']*)'/, `class="${safe}"`);
    } else {
      replaced = full.replace(new RegExp(`^<${tag}`), `<${tag} class="${safe}"`);
    }

    out += replaced;
    lastIndex = end;
  }

  out += html.slice(lastIndex);
  return out;
}

export function mergeResponsiveFragments({
  mobileHtml,
  desktopHtml,
  tabletHtml,

  // Bucket variants (works with #cmp_root[data-bucket="..."])
  mobilePrefix = `[[data-bucket="mobile"]_&]`,
  tabletPrefix = `[[data-bucket="tablet"]_&]`,
} = {}) {
  const hasMobile = isStr(mobileHtml) && mobileHtml.trim().length > 0;
  const hasDesktop = isStr(desktopHtml) && desktopHtml.trim().length > 0;
  const hasTablet = isStr(tabletHtml) && tabletHtml.trim().length > 0;

  // BASE DOM: desktop -> tablet -> mobile
  // (We want desktop as the default so mobile/tablet become bucket overrides)
  const base = hasDesktop ? desktopHtml : hasTablet ? tabletHtml : hasMobile ? mobileHtml : "";
  if (!base) return "";

  // If we only have one variant, return it
  if (!hasMobile && !hasTablet) return base;

  const baseMaps = extractMaps(base);
  const merged = new Map();

  // Seed merged class map with base classes
  for (const [key, cls] of baseMaps.classByKey.entries()) {
    merged.set(key, String(cls || "").trim());
  }

  function applyVariant(variantHtml, prefixChain) {
    if (!variantHtml) return;

    const vMaps = extractMaps(variantHtml);

    // Build lookup: primaryKey -> variant class
    // Also allow text-key matching to map variant elements onto base keys.
    const variantClassByBaseKey = new Map();

    // 1) Direct key matches (data-key/data-node/id/tag fallback)
    for (const [vKey, vCls] of vMaps.classByKey.entries()) {
      if (merged.has(vKey)) {
        variantClassByBaseKey.set(vKey, vCls);
      }
    }

    // 2) Text-key matches
    for (const [tKey, vPrimary] of vMaps.textKeyToPrimary.entries()) {
      const basePrimary = baseMaps.textKeyToPrimary.get(tKey);
      if (!basePrimary) continue;
      if (!merged.has(basePrimary)) continue;

      const vCls = vMaps.classByKey.get(vPrimary);
      if (!vCls) continue;

      // Only fill if not already matched directly; direct match wins.
      if (!variantClassByBaseKey.has(basePrimary)) {
        variantClassByBaseKey.set(basePrimary, vCls);
      }
    }

    // Apply to merged
    for (const [baseKey, vCls] of variantClassByBaseKey.entries()) {
      const baseCls = merged.get(baseKey) || "";
      const baseTokens = splitClassTokens(baseCls);

      // Prefix ONLY tokens that are not already breakpoint/media-prefixed
      const vTokens = splitClassTokens(vCls).map((t) => prefixToken(t, prefixChain));

      const next = uniqKeepOrder([...baseTokens, ...vTokens]).join(" ");
      merged.set(baseKey, next);
    }
  }

  // Apply tablet then mobile (mobile wins if both define same token)
  if (hasTablet) applyVariant(tabletHtml, tabletPrefix);
  if (hasMobile) applyVariant(mobileHtml, mobilePrefix);

  return replaceClassAttr(base, merged);
}
