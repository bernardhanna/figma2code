// generator/auto/mergeResponsiveFragments.js
//
// Merge strategy (HTML-layer, robust with existing pipeline):
// - Render base fragment (mobile else tablet else desktop).
// - Render tablet + desktop fragments.
// - Match nodes by data-key first. If missing, fallback to positional matching.
// - For each matched node, append md:/lg: prefixed class tokens from that variant.
//
// Notes:
// - This expects your renderer emits either data-key="..." or at least data-node="..." on tags.
// - It modifies ONLY class="" attributes on matched tags; DOM structure stays from baseHtml.
//
// Export: mergeResponsiveFragments({ mobileHtml, tabletHtml, desktopHtml }) => html

function tokenizeClasses(cls) {
  const s = String(cls || "").trim();
  if (!s) return [];
  return s.split(/\s+/g).filter(Boolean);
}

function prefixTokens(tokens, prefix) {
  return tokens
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => {
      // If already responsive/variant prefixed, keep as-is.
      if (/^(sm:|md:|lg:|xl:|2xl:)/.test(t)) return t;
      return `${prefix}:${t}`;
    });
}

function dedupe(tokens) {
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Extract a linear list of elements with:
 * - key: data-key="..." (preferred)
 * - classStr: class="..."
 * - idx: ordinal for stable fallback mapping
 * - classStart/classEnd: indexes into the source HTML string
 */
function extractElements(html) {
  const out = [];
  const re = /<([a-zA-Z0-9-]+)([^>]*?)>/g;
  let m;

  while ((m = re.exec(html))) {
    const full = m[0];
    const attrs = m[2] || "";

    // Only consider nodes with data-node or data-key (your pipeline usually emits data-node)
    if (!/data-node=/.test(attrs) && !/data-key=/.test(attrs)) continue;

    const keyM = attrs.match(/\sdata-key="([^"]+)"/);
    const key = keyM ? keyM[1] : "";

    const clsM = attrs.match(/\sclass="([^"]*)"/);
    const classStr = clsM ? clsM[1] : "";

    let classStart = -1;
    let classEnd = -1;

    if (clsM) {
      // Find within the current tag substring; then translate to full html indexes
      const idxInTag = full.indexOf(clsM[0]);
      if (idxInTag >= 0) {
        classStart = m.index + idxInTag + ` class="`.length;
        classEnd = classStart + clsM[1].length;
      }
    }

    out.push({
      idx: out.length,
      key,
      classStr,
      classStart,
      classEnd,
    });
  }

  return out;
}

function buildMatchIndex(elements) {
  const byKey = new Map();
  const noKey = [];
  for (const el of elements) {
    if (el.key) byKey.set(el.key, el);
    else noKey.push(el);
  }
  return { byKey, noKey };
}

function mergeIntoBaseHtml({ baseHtml, tabletHtml, desktopHtml }) {
  const baseEls = extractElements(baseHtml);
  const tabletEls = tabletHtml ? extractElements(tabletHtml) : [];
  const desktopEls = desktopHtml ? extractElements(desktopHtml) : [];

  const tIndex = buildMatchIndex(tabletEls);
  const dIndex = buildMatchIndex(desktopEls);

  // Build mapping for base no-key positions (for fallback positional match)
  const baseNoKeyPos = new Map();
  let nk = 0;
  for (const el of baseEls) {
    if (!el.key) {
      baseNoKeyPos.set(el.idx, nk);
      nk++;
    }
  }

  function matchVariantEl(baseEl, variantIndex, variantNoKeyList) {
    if (baseEl.key && variantIndex.byKey.has(baseEl.key)) {
      return variantIndex.byKey.get(baseEl.key);
    }

    const i = baseNoKeyPos.get(baseEl.idx);
    if (typeof i === "number" && variantNoKeyList[i]) return variantNoKeyList[i];

    return null;
  }

  // Apply class replacements via string slicing (end -> start)
  const replacements = [];

  for (const baseEl of baseEls) {
    if (baseEl.classStart < 0 || baseEl.classEnd < 0) continue;

    const baseTokens = tokenizeClasses(baseEl.classStr);
    const merged = [...baseTokens];

    const tEl = tabletHtml ? matchVariantEl(baseEl, tIndex, tIndex.noKey) : null;
    const dEl = desktopHtml ? matchVariantEl(baseEl, dIndex, dIndex.noKey) : null;

    if (tEl) {
      const tTokens = tokenizeClasses(tEl.classStr);
      merged.push(...prefixTokens(tTokens, "md"));
    }

    if (dEl) {
      const dTokens = tokenizeClasses(dEl.classStr);
      merged.push(...prefixTokens(dTokens, "lg"));
    }

    const finalClassStr = dedupe(merged).join(" ");

    replacements.push({
      start: baseEl.classStart,
      end: baseEl.classEnd,
      value: finalClassStr,
    });
  }

  replacements.sort((a, b) => b.start - a.start);

  let out = baseHtml;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.value + out.slice(r.end);
  }

  return out;
}

export function mergeResponsiveFragments({ mobileHtml, tabletHtml, desktopHtml }) {
  const baseHtml = mobileHtml || tabletHtml || desktopHtml || "";
  if (!baseHtml) return "";

  return mergeIntoBaseHtml({
    baseHtml,
    tabletHtml: tabletHtml || "",
    desktopHtml: desktopHtml || "",
  });
}
