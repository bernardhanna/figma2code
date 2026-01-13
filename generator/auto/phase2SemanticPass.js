// generator/auto/phase2SemanticPass.js
// Phase-2: Semantic + Accessible pass.
// Called as: semanticAccessiblePass({ html, ast, semantics })
// Returns:  { html, report }
//
// Adds/keeps:
// - aria-label on icon-only buttons/links
// - img alt inference
// - overlay RECTANGLE absolute promotion
// - focus-visible ring enforcement
// - deterministic typography injection
// - deterministic landmark upgrades (root + limited top-level frames)
//
// Landmark rules:
// 1) semantics map (semantics[nodeId].tag / role / label) if present
// 2) frame name patterns (node.name)
// 3) ROOT hero fallback (NEW): apply role="banner" + aria-labelledby when bg cues + heading exist,
//    even if the outer wrapper lacks data-node or the “real” root is the first data-node==ast.tree.id.
//
// Disable via semantics flags (no call-site signature changes):
// - semantics.enableLandmarks = false
// - semantics.rootHeroFallback = false
// - semantics.strictLandmarks = false (no tag rename; only role/aria additions)

function tokenize(html) {
  const tokens = [];
  const re = /<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(html))) {
    const v = m[0];
    if (v.startsWith("<")) tokens.push({ type: "tag", value: v });
    else tokens.push({ type: "text", value: v });
  }
  return tokens;
}

function parseTag(tagStr) {
  const raw = tagStr;
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

      // Normalize keys to lowercase so lookups are deterministic.
      const k = String(kRaw).toLowerCase();
      attrs.set(k, v);
    }
  }

  return { kind: isClose ? "close" : isSelf ? "self" : "open", name, attrs, raw };
}

function escAttr(s = "") {
  return String(s).replace(/"/g, "&quot;");
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

function getAttr(attrs, key) {
  const k = String(key || "").toLowerCase();
  return attrs.has(k) ? attrs.get(k) : null;
}
function setAttr(attrs, key, val) {
  const k = String(key || "").toLowerCase();
  attrs.set(k, val);
}
function delAttr(attrs, key) {
  const k = String(key || "").toLowerCase();
  attrs.delete(k);
}
function addClass(attrs, cls) {
  const cur = getAttr(attrs, "class") || "";
  const parts = new Set(cur.split(/\s+/).filter(Boolean));
  String(cls)
    .split(/\s+/)
    .filter(Boolean)
    .forEach((c) => parts.add(c));
  setAttr(attrs, "class", Array.from(parts).join(" "));
}

function trimText(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function tokensToString(tokens) {
  return tokens.map((t) => t.value).join("");
}

function findNodeById(astTree, id) {
  if (!astTree || !id) return null;
  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (n.id === id) {
      found = n;
      return;
    }
    for (const c of n.children || []) walk(c);
  })(astTree);
  return found;
}

function inferAltFromNode(node) {
  if (!node) return null;
  const n = trimText(node.name || "");
  if (!n) return "";
  if (/\b(bg|background|shape|rectangle|vector)\b/i.test(n)) return "";
  return n.length > 120 ? n.slice(0, 117) + "…" : n;
}

function inferLabelFromNode(node) {
  if (!node) return null;
  const n = trimText(node.name || "");
  if (!n) return null;
  const cleaned = n.replace(/\b(frame|group|component|instance)\b/gi, "").trim();
  return cleaned || n;
}

/* ==================== Typography (STRICT) ==================== */

const FONT_FAMILY_MAP = {
  "Red Hat Display": "font-primary",
  "Red Hat Text": "font-secondary",
};

function typographyToTailwind(typography) {
  if (!typography || typeof typography !== "object") return "";

  const { family, sizePx, lineHeightPx, weight, letterSpacingPx, colorHex } = typography;

  const out = [];

  if (colorHex) out.push(`text-[${colorHex}]`);

  if (family) {
    const fam = String(family);
    const mapped = FONT_FAMILY_MAP[fam];
    if (mapped) out.push(mapped);
  }

  if (typeof sizePx === "number" && Number.isFinite(sizePx) && sizePx > 0) {
    out.push(`text-[${sizePx}px]`);
  }

  if (typeof lineHeightPx === "number" && Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
    out.push(`leading-[${lineHeightPx}px]`);
  }

  if (
    typeof letterSpacingPx === "number" &&
    Number.isFinite(letterSpacingPx) &&
    letterSpacingPx !== 0
  ) {
    out.push(`tracking-[${letterSpacingPx}px]`);
  }

  if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
    if (weight === 400) out.push("font-normal");
    else if (weight === 500) out.push("font-medium");
    else if (weight === 600) out.push("font-semibold");
    else if (weight === 700) out.push("font-bold");
    else if (weight === 800) out.push("font-extrabold");
    else out.push(`font-[${weight}]`);
  }

  return out.join(" ");
}

/* -------------------- Layout Fix Helpers -------------------- */

function buildParentMap(astTree) {
  const parent = new Map(); // childId -> parentNode
  (function walk(n) {
    for (const c of n?.children || []) {
      parent.set(c.id, n);
      walk(c);
    }
  })(astTree);
  return parent;
}

function hasGradientFill(node) {
  return (node?.fills || []).some((f) => f?.kind === "gradient");
}

function isMostlyCoveringParent(node, parentNode) {
  const nw = node?.bb?.w ?? node?.w ?? 0;
  const nh = node?.bb?.h ?? node?.h ?? 0;
  const pw = parentNode?.bb?.w ?? parentNode?.w ?? 0;
  const ph = parentNode?.bb?.h ?? parentNode?.h ?? 0;
  if (!nw || !nh || !pw || !ph) return false;

  const wr = nw / pw;
  const hr = nh / ph;
  return wr >= 0.75 && hr >= 0.75;
}

function looksLikeOverlayRect(node, parentNode) {
  if (!node || node.type !== "RECTANGLE") return false;

  const name = String(node.name || "").toLowerCase();
  const namedOverlay =
    name.includes("overlay") ||
    name.includes("gradient") ||
    name.includes("bg") ||
    name === "rectangle" ||
    name.startsWith("rectangle ");

  if (hasGradientFill(node)) return true;
  if (node.opacity !== undefined && node.opacity < 1) return true;
  if (isMostlyCoveringParent(node, parentNode)) return true;

  return namedOverlay;
}

function stripFlowSizingClasses(classStr) {
  const s = String(classStr || "");
  return s
    .replace(/\bw-\[[^\]]+\]\b/g, "")
    .replace(/\bh-\[[^\]]+\]\b/g, "")
    .replace(/\bmax-w-full\b/g, "")
    .replace(/\bshrink-0\b/g, "")
    .replace(/\bself-(start|center|end|stretch)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ==================== Landmarks (deterministic, safe) ==================== */

function readLandmarkOpts(semantics) {
  const opts = {
    enableLandmarks: true,
    strictLandmarks: true,
    upgradeTopLevelFrames: true,
    topLevelLimit: 6,
    upgradeRootWrapper: true,
    rootHeroFallback: true,
  };

  if (semantics && typeof semantics.enableLandmarks === "boolean") {
    opts.enableLandmarks = semantics.enableLandmarks;
  }
  if (semantics && typeof semantics.strictLandmarks === "boolean") {
    opts.strictLandmarks = semantics.strictLandmarks;
  }
  if (semantics && typeof semantics.upgradeTopLevelFrames === "boolean") {
    opts.upgradeTopLevelFrames = semantics.upgradeTopLevelFrames;
  }
  if (semantics && Number.isFinite(semantics.topLevelLimit)) {
    opts.topLevelLimit = Math.max(0, Math.min(20, Math.floor(semantics.topLevelLimit)));
  }
  if (semantics && typeof semantics.upgradeRootWrapper === "boolean") {
    opts.upgradeRootWrapper = semantics.upgradeRootWrapper;
  }
  if (semantics && typeof semantics.rootHeroFallback === "boolean") {
    opts.rootHeroFallback = semantics.rootHeroFallback;
  }

  return opts;
}

function normHint(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_\-:]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableIdFromToken(s) {
  return String(s || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function isLandmarkTag(t) {
  const x = String(t || "").toLowerCase();
  return x === "header" || x === "nav" || x === "main" || x === "footer" || x === "section";
}

function isContainerishHtmlTag(tagName) {
  const t = String(tagName || "").toLowerCase();
  return t === "div" || t === "section" || t === "header" || t === "footer" || t === "nav" || t === "main";
}

function semLandmarkHint(sem) {
  if (!sem || typeof sem !== "object") return null;
  const tag = sem.tag ? String(sem.tag).toLowerCase() : "";
  const role = sem.role ? String(sem.role).toLowerCase() : "";
  const label =
    (typeof sem.label === "string" && sem.label.trim()) ? sem.label.trim() :
      (typeof sem.ariaLabel === "string" && sem.ariaLabel.trim()) ? sem.ariaLabel.trim() :
        "";

  if (isLandmarkTag(tag)) return { kind: tag, role, label };

  if (role === "banner") return { kind: "header", role: "banner", label };
  if (role === "navigation") return { kind: "nav", role: "navigation", label };
  if (role === "main") return { kind: "main", role: "main", label };
  if (role === "contentinfo") return { kind: "footer", role: "contentinfo", label };

  return null;
}

function nameLandmarkHint(nodeName) {
  const n = normHint(nodeName);

  if (/\b(nav|navigation|menu|menubar)\b/.test(n)) return { kind: "nav" };
  if (/\b(footer|site footer)\b/.test(n)) return { kind: "footer" };
  if (/\b(main|content|page content)\b/.test(n)) return { kind: "main" };

  if (/\b(hero|banner|jumbotron|masthead|top)\b/.test(n)) return { kind: "header", role: "banner" };
  if (/\b(header|headerbar|topbar)\b/.test(n)) return { kind: "header" };

  if (/\b(section|block|module)\b/.test(n)) return { kind: "section" };

  return null;
}

function deriveNavLabel(nodeName, sem) {
  const fromSem =
    (typeof sem?.label === "string" && sem.label.trim()) ? sem.label.trim() :
      (typeof sem?.ariaLabel === "string" && sem.ariaLabel.trim()) ? sem.ariaLabel.trim() :
        "";

  if (fromSem) return fromSem;

  const n = normHint(nodeName);
  if (/\b(footer)\b/.test(n)) return "Footer navigation";
  if (/\b(secondary|sub)\b/.test(n)) return "Secondary navigation";
  return "Primary";
}

function setIfMissing(attrs, key, value) {
  if (getAttr(attrs, key) === null) setAttr(attrs, key, value);
}

function canRenameToLandmark({ opts, insideInteractive, currentTag, targetTag }) {
  if (!opts.strictLandmarks) return false;
  if (insideInteractive) return false;
  if (!isContainerishHtmlTag(currentTag)) return false;
  if (!isLandmarkTag(targetTag)) return false;
  return true;
}

function findOrCreateHeadingIdInRange(tokens, containerOpenIndex, preferredIdSeed) {
  let depth = 1;
  for (let i = containerOpenIndex + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "tag") continue;

    const tag = parseTag(t.value);

    if (tag.kind === "open") depth++;
    else if (tag.kind === "close") depth--;

    if (tag.kind === "open" && /^h[1-6]$/.test(tag.name)) {
      const existingId = getAttr(tag.attrs, "id");
      if (existingId && existingId.trim()) {
        return { headingOpenIndex: i, headingId: existingId.trim(), injected: false };
      }

      const seed = stableIdFromToken(preferredIdSeed || "");
      if (!seed) return null;

      const newId = `${seed}-heading`;
      setAttr(tag.attrs, "id", newId);
      tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };

      return { headingOpenIndex: i, headingId: newId, injected: true };
    }

    if (depth === 0) break;
  }

  return null;
}

function rootHasBgCue(rootWrapperTag, astRoot, astWhole) {
  const style = rootWrapperTag?.attrs ? (getAttr(rootWrapperTag.attrs, "style") || "") : "";
  if (/background-image\s*:/i.test(style)) return true;

  if (astWhole?.__bg?.enabled) return true;

  const fills = astRoot?.fills || [];
  if (Array.isArray(fills)) {
    if (fills.some((f) => f?.kind === "image")) return true;
    if (fills.some((f) => f?.kind === "gradient")) return true;
  }

  return false;
}

// ===== Root hero fallback: ALWAYS applies role=banner when bg cue exists.
// If a heading exists, uses aria-labelledby; otherwise uses aria-label deterministically. =====

function findFirstOpenTagIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "tag") continue;
    const tag = parseTag(tokens[i].value);
    if (tag.kind === "open") return i;
  }
  return -1;
}

function findFirstOpenTagByDataNode(tokens, nodeId) {
  if (!nodeId) return -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "tag") continue;
    const tag = parseTag(tokens[i].value);
    if (tag.kind !== "open") continue;
    const dn = getAttr(tag.attrs, "data-node");
    if (dn === nodeId) return i;
  }
  return -1;
}

function htmlAlreadyHasBanner(tokens) {
  for (const t of tokens) {
    if (t.type !== "tag") continue;
    const tag = parseTag(t.value);
    if (tag.kind !== "open") continue;
    const role = getAttr(tag.attrs, "role");
    if (role && String(role).toLowerCase() === "banner") return true;
  }
  return false;
}

function heroFallbackLabel(ast, semantics) {
  const rootId = ast?.tree?.id || "";
  const sem = rootId ? semantics?.[rootId] : null;
  const fromSem =
    (typeof sem?.label === "string" && sem.label.trim()) ? sem.label.trim() :
      (typeof sem?.ariaLabel === "string" && sem.ariaLabel.trim()) ? sem.ariaLabel.trim() :
        "";
  if (fromSem) return fromSem;

  const name = trimText(ast?.tree?.name || "");
  if (name) return inferLabelFromNode({ name }) || name;

  return "Hero";
}

function applyRootHeroBannerEarly(tokens, ast, semantics, opts, report) {
  if (!opts?.enableLandmarks) return { applied: false };
  if (!opts?.rootHeroFallback) return { applied: false };
  if (htmlAlreadyHasBanner(tokens)) return { applied: false };

  const rootAst = ast?.tree || null;
  const rootAstId = rootAst?.id || "";
  if (!rootAstId) return { applied: false };

  const rootWrapperIdx = findFirstOpenTagIndex(tokens);
  const rootNodeIdx = findFirstOpenTagByDataNode(tokens, rootAstId);

  const candidates = [];
  if (rootWrapperIdx >= 0) candidates.push({ idx: rootWrapperIdx, kind: "wrapper" });
  if (rootNodeIdx >= 0 && rootNodeIdx !== rootWrapperIdx)
    candidates.push({ idx: rootNodeIdx, kind: "rootNode" });

  const fallbackAriaLabel = heroFallbackLabel(ast, semantics);

  // Prefer wrapper if it has bg cue. Otherwise allow root node.
  for (const c of candidates) {
    const idx = c.idx;
    const t = tokens[idx];
    if (t.type !== "tag") continue;

    const tag = parseTag(t.value);
    if (!isContainerishHtmlTag(tag.name)) continue;

    // Candidate-specific bg cue test:
    // - wrapper: style may carry background-image
    // - root node: may not have style; but AST root fills/__bg indicate cue
    const hasCue = rootHasBgCue(tag, rootAst, ast);
    if (!hasCue) continue;

    // Apply banner role
    setIfMissing(tag.attrs, "role", "banner");

    // Prefer aria-labelledby if we can find/insert a real heading tag; else aria-label.
    const found = findOrCreateHeadingIdInRange(tokens, idx, rootAstId);

    if (found?.headingId) {
      if (!getAttr(tag.attrs, "aria-labelledby") && !getAttr(tag.attrs, "aria-label")) {
        setAttr(tag.attrs, "aria-labelledby", found.headingId);
      }
    } else {
      if (!getAttr(tag.attrs, "aria-label") && !getAttr(tag.attrs, "aria-labelledby")) {
        setAttr(tag.attrs, "aria-label", fallbackAriaLabel);
      }
    }

    tokens[idx] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
    report?.fixes?.push(
      `Landmark: root hero fallback applied on <${tag.name}> (idx=${idx}) role="banner".`
    );
    return { applied: true, index: idx };
  }

  return { applied: false };
}

/* ==================== MAIN PASS ==================== */

function upgradeRootHeroBanner({ html, ast, semantics, report }) {
  if (semantics && semantics.enableLandmarks === false) return html;
  if (semantics && semantics.rootHeroFallback === false) return html;

  // If any banner already exists, never add another.
  if (/\brole\s*=\s*["']banner["']/i.test(String(html || ""))) return html;

  const rootId = ast?.tree?.id;
  if (!rootId) return html;

  const seed = String(rootId).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const headingId = `${seed}-heading`;

  let out = html;

  // Ensure first h1 has stable id if present
  out = out.replace(/<h1\b(?![^>]*\bid=)([^>]*)>/i, `<h1 id="${headingId}"$1>`);

  // Backstop 1: if wrapper (first section/div/header/main) has background-image style, apply banner there.
  // Use aria-labelledby if we now have an h1, else aria-label.
  const wrapperRe =
    /<(section|div|header|main)\b([^>]*\bstyle\s*=\s*["'][^"']*background-image\s*:[^"']*["'][^>]*)>/i;

  const fallbackLabel = heroFallbackLabel(ast, semantics);

  out = out.replace(wrapperRe, (m, tagName, attrs) => {
    const lowerAttrs = String(attrs).toLowerCase();
    if (/\brole\s*=\s*["']banner["']/.test(lowerAttrs)) return m;

    // prefer aria-labelledby if the injected id exists somewhere
    const hasHeading = new RegExp(`\\bid=["']${headingId}["']`, "i").test(out);

    report?.fixes?.push?.(`Landmark: backstop banner applied on <${tagName}> (wrapper bg cue).`);

    if (hasHeading) {
      if (/\baria-labelledby\s*=|\baria-label\s*=/.test(lowerAttrs)) return `<${tagName}${attrs} role="banner">`;
      return `<${tagName}${attrs} role="banner" aria-labelledby="${headingId}">`;
    }

    if (/\baria-labelledby\s*=|\baria-label\s*=/.test(lowerAttrs)) return `<${tagName}${attrs} role="banner">`;
    return `<${tagName}${attrs} role="banner" aria-label="${escAttr(fallbackLabel)}">`;
  });

  // If banner now exists, stop.
  if (/\brole\s*=\s*["']banner["']/i.test(out)) return out;

  // Backstop 2: apply banner on root data-node container
  const dataNodeNeedle = `data-node="${rootId}"`;
  const reRootOpen = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9:-]*)\\b([^>]*\\s${dataNodeNeedle}[^>]*)>`,
    "i"
  );

  out = out.replace(reRootOpen, (m, tagName, attrs) => {
    const lowerAttrs = String(attrs).toLowerCase();
    if (/\brole\s*=/.test(lowerAttrs)) return m;

    const tn = String(tagName).toLowerCase();
    if (!["div", "section", "header", "main", "footer", "nav", "span"].includes(tn)) return m;

    report?.fixes?.push?.(`Landmark: backstop banner applied on ${tagName}[data-node=${rootId}].`);

    // aria-labelledby if h1 exists, else aria-label
    const hasHeading = new RegExp(`\\bid=["']${headingId}["']`, "i").test(out);

    if (hasHeading) return `<${tagName}${attrs} role="banner" aria-labelledby="${headingId}">`;
    return `<${tagName}${attrs} role="banner" aria-label="${escAttr(fallbackLabel)}">`;
  });

  return out;
}

export function semanticAccessiblePass({ html, ast, semantics }) {
  const report = { fixes: [], warnings: [] };
  let tokens = tokenize(html || "");

  const opts = readLandmarkOpts(semantics);

  // Early deterministic hero fallback
  const early = applyRootHeroBannerEarly(tokens, ast, semantics, opts, report);

  const parentMap = buildParentMap(ast?.tree);

  const rootAst = ast?.tree || null;
  const rootAstId = rootAst?.id || "";
  const topLevelIds = new Set();
  if (opts.upgradeTopLevelFrames && rootAst && Array.isArray(rootAst.children)) {
    for (const c of rootAst.children.slice(0, opts.topLevelLimit)) {
      if (c?.id) topLevelIds.add(c.id);
    }
  }

  let rootWrapperOpenIndex = -1;
  let linkDepth = 0;
  let buttonDepth = 0;

  const interactiveStack = []; // { name, attrs, openIndex, hasText, nodeId }

  let mainApplied = false;
  let bannerApplied = !!early?.applied || htmlAlreadyHasBanner(tokens);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type !== "tag") {
      const txt = trimText(t.value || "");
      if (txt) {
        for (let k = interactiveStack.length - 1; k >= 0; k--) {
          interactiveStack[k].hasText = true;
          break;
        }
      }
      continue;
    }

    const tag = parseTag(t.value);

    if (rootWrapperOpenIndex === -1 && tag.kind === "open") {
      rootWrapperOpenIndex = i;
    }

    const insideInteractive = linkDepth > 0 || buttonDepth > 0;

    if (tag.kind === "open") {
      const role = getAttr(tag.attrs, "role");
      if (role && String(role).toLowerCase() === "banner") bannerApplied = true;
    }

    // OPEN: landmarks + typography
    if (tag.kind === "open") {
      const nodeId = getAttr(tag.attrs, "data-node") || "";
      const node = nodeId ? findNodeById(ast?.tree, nodeId) : null;
      const sem = nodeId && semantics ? semantics[nodeId] : null;

      if (opts.enableLandmarks) {
        const isRootWrapper = i === rootWrapperOpenIndex && opts.upgradeRootWrapper;
        const isRootNode = !!(nodeId && rootAstId && nodeId === rootAstId);
        const isTopLevel = !!(nodeId && topLevelIds.has(nodeId));

        const nameForHint = isRootWrapper ? (rootAst?.name || "") : (node?.name || "");
        const semForHint = isRootWrapper ? (rootAstId && semantics ? semantics[rootAstId] : null) : sem;

        const semHint = semLandmarkHint(semForHint);
        const nameHint = nameLandmarkHint(nameForHint);

        let target = null;
        if (isRootWrapper || isRootNode || isTopLevel) {
          target = semHint || nameHint;
        }

        if (target && isContainerishHtmlTag(tag.name) && !insideInteractive) {
          if (target.kind === "main" && mainApplied) target = null;

          const canRename = canRenameToLandmark({
            opts,
            insideInteractive,
            currentTag: tag.name,
            targetTag: target?.kind,
          });

          if (target) {
            if (canRename && target.kind && target.kind !== tag.name) {
              tag.name = target.kind;
              report.fixes.push(
                `Landmark: upgraded to <${target.kind}>` +
                (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
              );
            }

            const wantsBanner =
              target.role === "banner" ||
              (target.kind === "header" &&
                /\b(hero|banner|jumbotron|masthead|top)\b/.test(normHint(nameForHint)));

            if (wantsBanner && !bannerApplied) {
              setIfMissing(tag.attrs, "role", "banner");
              bannerApplied = true;
              report.fixes.push(
                `Landmark: applied role="banner"` +
                (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
              );
            }

            const isNavNow = tag.name === "nav" || target.kind === "nav";
            if (isNavNow) {
              const existing = getAttr(tag.attrs, "aria-label");
              if (!existing) {
                const navLabel = deriveNavLabel(nameForHint, semForHint);
                setAttr(tag.attrs, "aria-label", navLabel);
                report.fixes.push(
                  `Landmark: added aria-label="${navLabel}" on <nav>` +
                  (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
                );
              }
            }

            if (target.kind === "main" && (tag.name === "main" || !opts.strictLandmarks)) {
              mainApplied = true;
            }

            tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
            continue;
          }
        }
      }

      // Typography injection
      if (nodeId) {
        if (node?.typography) {
          const tw = typographyToTailwind(node.typography);
          if (tw) addClass(tag.attrs, tw);

          const fam = String(node.typography.family || "").trim();
          if (fam && !FONT_FAMILY_MAP[fam]) {
            report.warnings.push(
              `Unmapped font family "${fam}" on data-node=${nodeId}. Add to FONT_FAMILY_MAP for deterministic output.`
            );
          }
        }

        tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
        continue;
      }
    }

    // SELF: images
    if (tag.kind === "self" && tag.name === "img") {
      const nodeId = getAttr(tag.attrs, "data-node");
      const node = nodeId ? findNodeById(ast?.tree, nodeId) : null;

      if (!getAttr(tag.attrs, "loading")) setAttr(tag.attrs, "loading", "lazy");
      if (!getAttr(tag.attrs, "decoding")) setAttr(tag.attrs, "decoding", "async");

      const existingAlt = getAttr(tag.attrs, "alt");
      const sem = nodeId ? semantics?.[nodeId] : null;
      const semanticAlt = sem?.alt;

      if (semanticAlt && typeof semanticAlt === "string") {
        setAttr(tag.attrs, "alt", semanticAlt);
        report.fixes.push(`img[data-node=${nodeId}] alt set from semantics.`);
      } else if (existingAlt === null || existingAlt === "") {
        const inferred = inferAltFromNode(node);
        setAttr(tag.attrs, "alt", inferred ?? "");
        report.warnings.push(
          `img[data-node=${nodeId}] alt inferred; consider providing semantics.alt for precision.`
        );
      }

      tokens[i] = { type: "tag", value: buildTag("img", tag.attrs, "self") };
      continue;
    }

    // OPEN: interactive
    if (tag.kind === "open" && (tag.name === "a" || tag.name === "button")) {
      if (tag.name === "a") linkDepth++;
      if (tag.name === "button") buttonDepth++;

      addClass(tag.attrs, "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2");

      if (tag.name === "button" && !getAttr(tag.attrs, "type")) {
        setAttr(tag.attrs, "type", "button");
        report.fixes.push('Added type="button" on <button>.');
      }

      if (tag.name === "a" && !getAttr(tag.attrs, "href")) {
        setAttr(tag.attrs, "href", "#");
        report.fixes.push('Added href="#" on <a>.');
      }

      if (linkDepth > 1) {
        report.warnings.push("Nested <a> inside <a> converted to <span>.");
        tag.name = "span";
        delAttr(tag.attrs, "href");
      }
      if (linkDepth > 0 && tag.name === "button") {
        report.warnings.push("Nested <button> inside <a> converted to <span>.");
        tag.name = "span";
        delAttr(tag.attrs, "type");
      }

      const nodeId = getAttr(tag.attrs, "data-node");
      interactiveStack.push({
        name: tag.name,
        attrs: tag.attrs,
        openIndex: i,
        hasText: false,
        nodeId,
      });

      tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
      continue;
    }

    // CLOSE: interactive - aria-label if icon-only
    if (tag.kind === "close" && (tag.name === "a" || tag.name === "button" || tag.name === "span")) {
      const top = interactiveStack.length ? interactiveStack[interactiveStack.length - 1] : null;

      if (top && top.name === tag.name) {
        interactiveStack.pop();

        const aria = getAttr(top.attrs, "aria-label");
        if (!top.hasText && !aria && (top.name === "a" || top.name === "button")) {
          const node = top.nodeId ? findNodeById(ast?.tree, top.nodeId) : null;
          const sem = top.nodeId ? semantics?.[top.nodeId] : null;
          const labelFromSem = sem?.ariaLabel || sem?.label;

          const label =
            typeof labelFromSem === "string" && labelFromSem.trim()
              ? labelFromSem.trim()
              : inferLabelFromNode(node) || (top.name === "button" ? "Action" : "Link");

          setAttr(top.attrs, "aria-label", label);

          tokens[top.openIndex] = { type: "tag", value: buildTag(top.name, top.attrs, "open") };
          report.fixes.push(`Added aria-label on <${top.name}> (icon-only).`);
        }
      }

      if (tag.name === "a") linkDepth = Math.max(0, linkDepth - 1);
      if (tag.name === "button") buttonDepth = Math.max(0, buttonDepth - 1);
      continue;
    }
  }

  // Pass B: Layout fix: overlay RECTANGLE -> absolute layer
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "tag") continue;

    const tag = parseTag(t.value);
    if (tag.kind !== "open") continue;

    if (tag.name !== "div" && tag.name !== "section" && tag.name !== "main" && tag.name !== "header") continue;

    const nodeId = getAttr(tag.attrs, "data-node");
    if (!nodeId) continue;

    const node = findNodeById(ast?.tree, nodeId);
    if (!node) continue;

    const parentNode = parentMap.get(nodeId);

    if (looksLikeOverlayRect(node, parentNode)) {
      const curClass = getAttr(tag.attrs, "class") || "";
      const cleaned = stripFlowSizingClasses(curClass);

      setAttr(tag.attrs, "class", cleaned);
      addClass(tag.attrs, "absolute inset-0 pointer-events-none");
      setAttr(tag.attrs, "aria-hidden", "true");

      tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
      report.fixes.push(`Promoted RECTANGLE overlay to absolute layer (data-node=${nodeId}).`);

      for (let j = i - 1; j >= 0; j--) {
        const tj = tokens[j];
        if (tj.type !== "tag") continue;

        const pj = parseTag(tj.value);
        if (pj.kind === "open" && (pj.name === "div" || pj.name === "section" || pj.name === "main" || pj.name === "header")) {
          addClass(pj.attrs, "relative");
          tokens[j] = { type: "tag", value: buildTag(pj.name, pj.attrs, "open") };
          report.fixes.push(`Ensured parent wrapper is relative for overlay (data-node=${nodeId}).`);
          break;
        }
      }
    }
  }

  // FINAL: stringify tokens, then apply string-level root hero upgrade as a deterministic backstop.
  let outHtml = tokensToString(tokens);
  outHtml = upgradeRootHeroBanner({ html: outHtml, ast, semantics, report });

  return { html: outHtml, report };
}
