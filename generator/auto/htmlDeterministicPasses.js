// generator/auto/htmlDeterministicPasses.js

function tokenize(html) {
  const tokens = [];
  const re = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const v = m[0];
    if (v.startsWith("<")) tokens.push({ type: "tag", value: v });
    else tokens.push({ type: "text", value: v });
  }
  return tokens;
}

function parseTag(tagStr) {
  const isClose = /^<\/\s*/.test(tagStr);
  const isSelf =
    /\/\s*>$/.test(tagStr) || /^<\s*(img|br|hr|input|meta|link)\b/i.test(tagStr);
  const nameMatch = tagStr.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
  const name = nameMatch ? nameMatch[1].toLowerCase() : "";
  const attrs = new Map();

  if (!isClose) {
    const inner = tagStr
      .replace(/^<\s*([a-zA-Z0-9:-]+)\s*/i, "")
      .replace(/\/?>$/, "")
      .trim();
    const attrRe =
      /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m2;
    while ((m2 = attrRe.exec(inner))) {
      const kRaw = m2[1];
      if (!kRaw) continue;
      const v =
        typeof m2[2] === "string"
          ? m2[2]
          : typeof m2[3] === "string"
            ? m2[3]
            : typeof m2[4] === "string"
              ? m2[4]
              : null;
      attrs.set(String(kRaw).toLowerCase(), v);
    }
  }

  return { kind: isClose ? "close" : isSelf ? "self" : "open", name, attrs };
}

function escAttr(s = "") {
  return String(s)
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTag(name, attrs, kind) {
  let out = `<${kind === "close" ? "/" : ""}${name}`;
  if (kind !== "close") {
    for (const [k, v] of attrs.entries()) {
      if (v === null) out += ` ${k}`;
      else out += ` ${k}="${escAttr(v)}"`;
    }
    out += kind === "self" ? " />" : ">";
  } else {
    out += ">";
  }
  return out;
}

function splitTopLevelComma(input) {
  const s = String(input || "");
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

function normalizeColorToken(color) {
  return String(color || "").trim().toLowerCase().replace(/\s+/g, "");
}

function parseStyleDecls(styleValue) {
  return String(styleValue || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const idx = chunk.indexOf(":");
      if (idx === -1) return null;
      const keyRaw = chunk.slice(0, idx).trim();
      const value = chunk.slice(idx + 1).trim();
      if (!keyRaw) return null;
      return { keyRaw, key: keyRaw.toLowerCase(), value };
    })
    .filter(Boolean);
}

function serializeStyleDecls(decls) {
  return decls.map((d) => `${d.keyRaw}: ${d.value}`).join("; ");
}

function getDeclIndex(decls, key) {
  const target = String(key || "").toLowerCase();
  return decls.findIndex((d) => d.key === target);
}

function setDecl(decls, key, value) {
  const i = getDeclIndex(decls, key);
  if (i >= 0) {
    decls[i].value = value;
    return;
  }
  decls.push({ keyRaw: key, key: key.toLowerCase(), value });
}

function removeDecl(decls, key) {
  const i = getDeclIndex(decls, key);
  if (i >= 0) decls.splice(i, 1);
}

function normalizeBackgroundStyleValue(styleValue) {
  const decls = parseStyleDecls(styleValue);
  if (!decls.length) return styleValue;

  const bgImageIdx = getDeclIndex(decls, "background-image");
  if (bgImageIdx >= 0) {
    const layers = splitTopLevelComma(decls[bgImageIdx].value);
    const removeIndices = new Set();
    const bgColorIdx = getDeclIndex(decls, "background-color");

    layers.forEach((layer, idx) => {
      const m = String(layer).match(/^linear-gradient\((.*)\)$/i);
      if (!m) return;
      const args = splitTopLevelComma(m[1]);
      if (args.length !== 2) return;
      const c1 = normalizeColorToken(args[0]);
      const c2 = normalizeColorToken(args[1]);
      if (!c1 || c1 !== c2) return;
      if (bgColorIdx === -1) {
        setDecl(decls, "background-color", args[0].trim());
      }
      removeIndices.add(idx);
    });

    if (removeIndices.size) {
      const nextLayers = layers.filter((_, idx) => !removeIndices.has(idx));
      if (!nextLayers.length) removeDecl(decls, "background-image");
      else decls[bgImageIdx].value = nextLayers.join(", ");

      // Keep layer-indexed background-* declarations aligned if they have multiple values.
      for (const prop of [
        "background-size",
        "background-position",
        "background-repeat",
        "background-blend-mode",
      ]) {
        const idx = getDeclIndex(decls, prop);
        if (idx === -1) continue;
        const vals = splitTopLevelComma(decls[idx].value);
        if (vals.length <= 1) continue;
        const filtered = vals.filter((_, vi) => !removeIndices.has(vi));
        decls[idx].value = filtered.length ? filtered.join(", ") : vals[0];
      }
    }
  }

  for (const prop of ["background-size", "background-position", "background-repeat"]) {
    const idx = getDeclIndex(decls, prop);
    if (idx === -1) continue;
    const vals = splitTopLevelComma(decls[idx].value);
    if (vals.length <= 1) continue;
    const normalized = vals.map((v) => v.trim().toLowerCase());
    if (normalized.every((v) => v === normalized[0])) {
      decls[idx].value = vals[0].trim();
    }
  }

  const blendIdx = getDeclIndex(decls, "background-blend-mode");
  if (blendIdx >= 0) {
    const blendVals = splitTopLevelComma(decls[blendIdx].value).map((v) =>
      v.trim().toLowerCase()
    );
    const imgIdx = getDeclIndex(decls, "background-image");
    const layerCount = imgIdx >= 0 ? splitTopLevelComma(decls[imgIdx].value).length : 0;
    if (
      blendVals.length &&
      blendVals.every((v) => v === "normal") &&
      (layerCount === 0 || blendVals.length === layerCount)
    ) {
      removeDecl(decls, "background-blend-mode");
    }
  }

  const finalBgImageIdx = getDeclIndex(decls, "background-image");
  if (finalBgImageIdx === -1) {
    removeDecl(decls, "background-size");
    removeDecl(decls, "background-position");
    removeDecl(decls, "background-repeat");
  }

  return serializeStyleDecls(decls);
}

export function normalizeBackgroundStylePass(html) {
  const tokens = tokenize(html);
  const targets = new Set(["section", "div", "header", "main"]);

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const tag = parseTag(tokens[i].value);
    if (!(tag.kind === "open" || tag.kind === "self")) continue;
    if (!targets.has(tag.name)) continue;
    const style = tag.attrs.get("style");
    if (!style || typeof style !== "string") continue;
    const nextStyle = normalizeBackgroundStyleValue(style);
    tag.attrs.set("style", nextStyle);
    tokens[i].value = buildTag(tag.name, tag.attrs, tag.kind);
  }

  return tokens.map((t) => t.value).join("");
}

function hasMeaningfulHref(href) {
  const v = String(href || "").trim();
  return !!v && v !== "#";
}

function hasAnyChildElement(tokens, start, end) {
  for (let i = start + 1; i < end; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const t = parseTag(tokens[i].value);
    if (t.kind === "open" || t.kind === "self") return true;
  }
  return false;
}

function hasMeaningfulText(tokens, start, end) {
  let text = "";
  for (let i = start + 1; i < end; i += 1) {
    if (tokens[i].type !== "text") continue;
    text += tokens[i].value;
  }
  const normalized = text.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 0;
}

function findMatchingClose(tokens, openIndex, tagName) {
  let depth = 0;
  const target = String(tagName || "").toLowerCase();
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const p = parseTag(tokens[i].value);
    if (p.name !== target) continue;
    if (p.kind === "open") depth += 1;
    if (p.kind === "close") depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

export function removePhantomInteractivePass(html) {
  const tokens = tokenize(html);
  const removeRanges = [];

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const open = parseTag(tokens[i].value);
    if (open.kind !== "open") continue;
    if (open.name !== "button" && open.name !== "a") continue;

    const closeIndex = findMatchingClose(tokens, i, open.name);
    if (closeIndex <= i) continue;

    const hasChildren = hasAnyChildElement(tokens, i, closeIndex);
    const hasText = hasMeaningfulText(tokens, i, closeIndex);
    const ariaLabel = String(open.attrs.get("aria-label") || "").trim();
    const ariaLabelledby = String(open.attrs.get("aria-labelledby") || "").trim();
    const role = String(open.attrs.get("role") || "").trim().toLowerCase();
    const href = open.name === "a" ? open.attrs.get("href") : null;
    const isAnchorWithMeaningfulHref = open.name === "a" && hasMeaningfulHref(href);

    const isPhantom =
      !hasChildren &&
      !hasText &&
      !ariaLabel &&
      !ariaLabelledby &&
      !isAnchorWithMeaningfulHref &&
      role !== "button" &&
      role !== "link";

    if (isPhantom) {
      removeRanges.push([i, closeIndex]);
      i = closeIndex;
    }
  }

  if (!removeRanges.length) return html;
  const keep = tokens.map(() => true);
  for (const [start, end] of removeRanges) {
    for (let i = start; i <= end; i += 1) keep[i] = false;
  }
  return tokens.filter((_, i) => keep[i]).map((t) => t.value).join("");
}

export function normalizeMediaSlotInteractivityPass(html) {
  const tokens = tokenize(html);
  let changed = false;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const open = parseTag(tokens[i].value);
    if (open.kind !== "open") continue;
    if (open.name !== "button" && open.name !== "a") continue;

    const dataKey = String(open.attrs.get("data-key") || "").toLowerCase();
    const isMediaSlot =
      dataKey.includes("frame:image") ||
      dataKey.includes("frame:hero") ||
      dataKey.includes("frame:media");
    if (!isMediaSlot) continue;

    const closeIndex = findMatchingClose(tokens, i, open.name);
    if (closeIndex <= i) continue;

    open.attrs.delete("type");
    open.attrs.delete("href");
    open.attrs.delete("target");
    open.attrs.delete("rel");
    open.attrs.delete("tabindex");

    const role = String(open.attrs.get("role") || "").toLowerCase();
    if (role === "button" || role === "link") {
      open.attrs.delete("role");
    }

    tokens[i].value = buildTag("div", open.attrs, "open");
    tokens[closeIndex].value = "</div>";
    changed = true;
    i = closeIndex;
  }

  return changed ? tokens.map((t) => t.value).join("") : html;
}

function extractFirstBackgroundImageUrl(styleValue) {
  const decls = parseStyleDecls(styleValue);
  const idx = getDeclIndex(decls, "background-image");
  if (idx === -1) return { url: "", nextStyle: String(styleValue || "") };
  const val = String(decls[idx].value || "");
  const m = val.match(/url\((['"]?)([^'")]+)\1\)/i);
  const url = m ? String(m[2] || "").trim() : "";
  if (!url) return { url: "", nextStyle: String(styleValue || "") };
  removeDecl(decls, "background-image");
  const nextStyle = serializeStyleDecls(decls);
  return { url, nextStyle };
}

function hasMediaDescendant(tokens, start, end) {
  for (let i = start + 1; i < end; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const t = parseTag(tokens[i].value);
    if ((t.kind === "open" || t.kind === "self") && (t.name === "img" || t.name === "video")) return true;
  }
  return false;
}

export function promoteSectionBgToHeroMediaPass(html) {
  const tokens = tokenize(html);
  let bgUrl = "";
  let mediaOpenIndex = -1;
  let mediaCloseIndex = -1;

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const tag = parseTag(tokens[i].value);
    if (tag.kind !== "open") continue;

    if (!bgUrl && tag.name === "section") {
      const style = String(tag.attrs.get("style") || "");
      const { url, nextStyle } = extractFirstBackgroundImageUrl(style);
      if (url) {
        bgUrl = url;
        if (nextStyle.trim()) tag.attrs.set("style", nextStyle);
        else tag.attrs.delete("style");
        tokens[i].value = buildTag(tag.name, tag.attrs, tag.kind);
      }
      continue;
    }

    if (bgUrl && mediaOpenIndex === -1) {
      const dataKey = String(tag.attrs.get("data-key") || "").toLowerCase();
      const looksMediaSlot = dataKey.includes("frame:image") || dataKey.includes("frame:hero");
      if (!looksMediaSlot) continue;
      const closeIdx = findMatchingClose(tokens, i, tag.name);
      if (closeIdx <= i) continue;
      if (hasMediaDescendant(tokens, i, closeIdx)) continue;
      mediaOpenIndex = i;
      mediaCloseIndex = closeIdx;
      break;
    }
  }

  if (!bgUrl || mediaOpenIndex === -1 || mediaCloseIndex <= mediaOpenIndex) return html;
  const mediaImg = `<img src="${escAttr(bgUrl)}" alt="Hero media" loading="lazy" decoding="async" class="w-full h-full object-cover rounded-[inherit]" />`;
  tokens.splice(mediaOpenIndex + 1, 0, { type: "tag", value: mediaImg });
  return tokens.map((t) => t.value).join("");
}

export function injectHeroMediaByKeyPass(html, mediaSrc, keyHint = "frame:image#1") {
  const src = String(mediaSrc || "").trim();
  const keyNeedle = String(keyHint || "").toLowerCase();
  if (!src || !keyNeedle) return html;

  const tokens = tokenize(html);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const open = parseTag(tokens[i].value);
    if (open.kind !== "open") continue;
    const dataKey = String(open.attrs.get("data-key") || "").toLowerCase();
    if (!dataKey.includes(keyNeedle)) continue;
    if (open.name !== "div" && open.name !== "section") continue;
    const closeIndex = findMatchingClose(tokens, i, open.name);
    if (closeIndex <= i) continue;
    if (hasMediaDescendant(tokens, i, closeIndex)) return html;
    const mediaImg = `<img src="${escAttr(src)}" alt="Hero media" loading="lazy" decoding="async" class="w-full h-full object-cover rounded-[inherit]" />`;
    tokens.splice(i + 1, 0, { type: "tag", value: mediaImg });
    return tokens.map((t) => t.value).join("");
  }
  return html;
}

export function normalizeHeroLandmarkDriftPass(html) {
  const tokens = tokenize(html);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "tag") continue;
    const open = parseTag(tokens[i].value);
    if (open.kind !== "open") continue;

    const dataKey = String(open.attrs.get("data-key") || "").toLowerCase();
    const shouldNormalizeRootMain = open.name === "main" && dataKey === "root";
    const shouldNormalizeHeroHeader =
      open.name === "header" &&
      (dataKey.includes("hero-text-box") || dataKey.includes("frame:hero-text-box"));

    if (!shouldNormalizeRootMain && !shouldNormalizeHeroHeader) continue;
    const closeIndex = findMatchingClose(tokens, i, open.name);
    if (closeIndex <= i) continue;

    if (shouldNormalizeHeroHeader && open.attrs.has("role")) {
      open.attrs.delete("role");
    }
    const nextName = "div";
    tokens[i].value = buildTag(nextName, open.attrs, open.kind);
    const close = parseTag(tokens[closeIndex].value);
    tokens[closeIndex].value = buildTag(nextName, close.attrs, close.kind);
  }
  return tokens.map((t) => t.value).join("");
}

