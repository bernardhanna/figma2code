// generator/auto/mergeResponsiveFragments.js
//
// mergeResponsiveFragments({ mobileHtml, desktopHtml, tabletHtml? }) => mergedHtml
//
// Goals:
// - Base DOM is mobile (if provided).
// - Desktop-only changes become breakpoint-prefixed classes (default: lg:).
// - Preserve variant chains like hover:, focus:, group-hover:, aria-*, etc.
// - Do NOT prefix tokens that already include an explicit breakpoint or an
//   arbitrary responsive/media variant (e.g. min-[900px]:, max-[...]:, [...]:).
//
// Notes:
// - Best-effort "class token" merger. Assumes DOM structure is mostly stable.
// - If structure diverges materially, prefer variant swapping in preview.

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

// Detect tokens that already encode breakpoint/media condition; do not double-prefix.
function hasExplicitBreakpointPrefix(token) {
  const t = String(token || "").trim();
  if (!t) return false;

  if (/^(sm|md|lg|xl|2xl):/.test(t)) return true;

  if (/^(min|max)-\[[^\]]+\]:/.test(t)) return true;
  if (/^\[[^\]]+\]:/.test(t)) return true;

  // Container queries like @lg:, @[400px]:
  if (/^@\S+:/.test(t)) return true;

  // Tailwind max-* syntax
  if (/^max-(sm|md|lg|xl|2xl):/.test(t)) return true;

  return false;
}

function prefixToken(token, prefix) {
  const t = String(token || "").trim();
  if (!t) return "";
  if (hasExplicitBreakpointPrefix(t)) return t;
  return `${prefix}:${t}`;
}

function extractClassMap(html) {
  const map = new Map();
  const tokenRe = /<([a-zA-Z0-9:-]+)([^>]*?)>/g;
  let m;
  const tagCount = new Map();

  while ((m = tokenRe.exec(html))) {
    const tag = m[1];
    const attrs = m[2] || "";

    const dataNode = (attrs.match(/\bdata-node\s*=\s*"([^"]+)"/) || [])[1];
    const id = (attrs.match(/\bid\s*=\s*"([^"]+)"/) || [])[1];
    const cls = (attrs.match(/\bclass\s*=\s*"([^"]*)"/) || [])[1];

    if (cls == null) continue;

    let key = "";
    if (dataNode) key = `data-node:${dataNode}`;
    else if (id) key = `id:${id}`;
    else {
      const n = (tagCount.get(tag) || 0) + 1;
      tagCount.set(tag, n);
      key = `tag:${tag}#${n}`;
    }

    map.set(key, cls);
  }

  return map;
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

    const dataNode = (attrs.match(/\bdata-node\s*=\s*"([^"]+)"/) || [])[1];
    const id = (attrs.match(/\bid\s*=\s*"([^"]+)"/) || [])[1];

    let key = "";
    if (dataNode) key = `data-node:${dataNode}`;
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

    if (/\bclass\s*=/.test(attrs)) {
      const replaced = full.replace(
        /\bclass\s*=\s*"([^"]*)"/,
        `class="${nextClass.replace(/"/g, "&quot;")}"`
      );
      out += replaced;
    } else {
      const injected = full.replace(
        new RegExp(`^<${tag}`),
        `<${tag} class="${nextClass.replace(/"/g, "&quot;")}"`
      );
      out += injected;
    }

    lastIndex = end;
  }

  out += html.slice(lastIndex);
  return out;
}

export function mergeResponsiveFragments({
  mobileHtml,
  desktopHtml,
  tabletHtml,
  desktopPrefix = "lg",
  tabletPrefix = "md",
} = {}) {
  const hasMobile = isStr(mobileHtml) && mobileHtml.trim().length > 0;
  const hasDesktop = isStr(desktopHtml) && desktopHtml.trim().length > 0;
  const hasTablet = isStr(tabletHtml) && tabletHtml.trim().length > 0;

  // Base DOM priority: mobile -> tablet -> desktop
  const base = hasMobile ? mobileHtml : hasTablet ? tabletHtml : hasDesktop ? desktopHtml : "";
  if (!base) return "";

  if (!hasDesktop && !hasTablet) return base;

  const baseMap = extractClassMap(base);
  const merged = new Map();

  for (const [key, cls] of baseMap.entries()) {
    merged.set(key, String(cls || "").trim());
  }

  function applyVariant(variantHtml, prefix) {
    if (!variantHtml) return;
    const vMap = extractClassMap(variantHtml);

    for (const [key, vCls] of vMap.entries()) {
      if (!merged.has(key)) continue;

      const baseCls = merged.get(key) || "";
      const baseTokens = splitClassTokens(baseCls);
      const vTokens = splitClassTokens(vCls).map((t) => prefixToken(t, prefix));

      const next = uniqKeepOrder([...baseTokens, ...vTokens]).join(" ");
      merged.set(key, next);
    }
  }

  if (hasTablet) applyVariant(tabletHtml, tabletPrefix);
  if (hasDesktop) applyVariant(desktopHtml, desktopPrefix);

  return replaceClassAttr(base, merged);
}
