// generator/auto/phase2SemanticPass.js
// Phase-2: Semantic + Accessible pass.
// Consumes rendered HTML (from autoLayoutify/render.js) + AST and applies:
// - aria-label on icon-only buttons/links
// - alt text for images
// - deterministic landmark upgrades (root + small set of top-level frames) based on:
//    1) semantics map (semantics[nodeId].tag / role / label)
//    2) node.name patterns ("hero", "nav", "footer", "main", etc.)
// - deterministic layout fix: promote overlay RECTANGLE layers to absolute
// - deterministic typography emission from AST node.typography (NO guessing)
//
// IMPORTANT:
// - This pass MUST be called like:
//   semanticAccessiblePass({ html: fragmentHtml, ast, semantics })
//
// Return shape:
//   { html: "<processed>", report: { fixes:[], warnings:[] } }

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
    const attrRe = /([a-zA-Z0-9:-]+)(?:\s*=\s*"([^"]*)")?/g;
    const inner = tagStr
      .replace(/^<\s*([a-zA-Z0-9:-]+)\s*/i, "")
      .replace(/\/?>$/, "");
    let a;
    while ((a = attrRe.exec(inner))) {
      const k = a[1];
      if (!k) continue;
      const v = typeof a[2] === "string" ? a[2] : null;
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
  return attrs.has(key) ? attrs.get(key) : null;
}
function setAttr(attrs, key, val) {
  attrs.set(key, val);
}
function delAttr(attrs, key) {
  attrs.delete(key);
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

// Deterministic: emit exact values. No semantic guesses.
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

  // NOTE: We intentionally keep px here (strict) because Phase-1 is already outputting rem
  // via remTypo(). If you want Phase-2 to also use rem, swap to rem conversion here.
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

// Remove sizing/shrink classes that force flow placement
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
  // Call signature stays semanticAccessiblePass({ html, ast, semantics })
  // Options are optionally hung off the semantics object itself to avoid new params.
  const opts = {
    enableLandmarks: true,
    strictLandmarks: true, // if false: do not rename tags; only add safe role/aria.
    upgradeTopLevelFrames: true,
    topLevelLimit: 6,
    upgradeRootWrapper: true,
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
  // IMPORTANT: exclude inline tags like <span> to avoid layout changes.
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

  // Prefer explicit tag when it is a landmark.
  if (isLandmarkTag(tag)) return { kind: tag, role, label };

  // Otherwise, allow role as a hint for banner/nav/main/footer-ish.
  if (role === "banner") return { kind: "header", role: "banner", label };
  if (role === "navigation") return { kind: "nav", role: "navigation", label };
  if (role === "main") return { kind: "main", role: "main", label };
  if (role === "contentinfo") return { kind: "footer", role: "contentinfo", label };

  return null;
}

function nameLandmarkHint(nodeName) {
  const n = normHint(nodeName);

  // Order matters: nav/footer/main before generic "header"
  if (/\b(nav|navigation|menu|menubar)\b/.test(n)) return { kind: "nav" };
  if (/\b(footer|site footer)\b/.test(n)) return { kind: "footer" };
  if (/\b(main|content|page content)\b/.test(n)) return { kind: "main" };

  // Hero-like => banner/header
  if (/\b(hero|banner|jumbotron|masthead|top)\b/.test(n)) return { kind: "header", role: "banner" };

  // Header bar (not necessarily hero)
  if (/\b(header|headerbar|topbar)\b/.test(n)) return { kind: "header" };

  // Generic section hint (low confidence): only used to add aria labeling, not rename.
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

/**
 * Find the first heading tag (h1-h6) within a container token range and return:
 * - headingOpenIndex
 * - headingId (existing or injected)
 *
 * This uses a generic nesting counter starting at containerOpenIndex to remain token-based.
 */
function findOrCreateHeadingIdInRange(tokens, containerOpenIndex, preferredIdSeed) {
  let depth = 1;
  for (let i = containerOpenIndex + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "tag") continue;

    const tag = parseTag(t.value);

    if (tag.kind === "open") depth++;
    else if (tag.kind === "close") depth--;

    // Look for first heading open tag inside the container.
    if (tag.kind === "open" && /^h[1-6]$/.test(tag.name)) {
      const existingId = getAttr(tag.attrs, "id");
      if (existingId && existingId.trim()) {
        return { headingOpenIndex: i, headingId: existingId.trim(), injected: false };
      }

      // Inject deterministic id.
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

/* ==================== MAIN PASS ==================== */

export function semanticAccessiblePass({ html, ast, semantics }) {
  const report = { fixes: [], warnings: [] };
  let tokens = tokenize(html || "");

  const opts = readLandmarkOpts(semantics);

  const parentMap = buildParentMap(ast?.tree);

  // Root/top-level IDs (AST-driven), used for deterministic landmark upgrades.
  const rootAst = ast?.tree || null;
  const rootAstId = rootAst?.id || "";
  const topLevelIds = new Set();
  if (opts.upgradeTopLevelFrames && rootAst && Array.isArray(rootAst.children)) {
    for (const c of rootAst.children.slice(0, opts.topLevelLimit)) {
      if (c?.id) topLevelIds.add(c.id);
    }
  }

  // Track first open tag as "root wrapper" (may NOT have data-node).
  let rootWrapperOpenIndex = -1;

  // Track interactive nesting to prevent invalid landmark nesting.
  let linkDepth = 0;
  let buttonDepth = 0;

  // Stack for icon-only aria-label detection
  const interactiveStack = []; // { name, attrs, openIndex, hasText, nodeId }

  // Landmark uniqueness guards (avoid multiple <main> etc).
  let mainApplied = false;
  let bannerApplied = false;

  // Pass A: Accessibility/semantics + Typography + Landmark upgrades
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type !== "tag") {
      const txt = trimText(t.value || "");
      if (txt) {
        // mark nearest interactive as containing text
        for (let k = interactiveStack.length - 1; k >= 0; k--) {
          interactiveStack[k].hasText = true;
          break;
        }
      }
      continue;
    }

    const tag = parseTag(t.value);

    // Identify the root wrapper (first open tag in the fragment).
    if (rootWrapperOpenIndex === -1 && tag.kind === "open") {
      rootWrapperOpenIndex = i;
    }

    const insideInteractive = linkDepth > 0 || buttonDepth > 0;

    // OPEN: typography + landmark upgrades for container-ish tags
    if (tag.kind === "open") {
      const nodeId = getAttr(tag.attrs, "data-node") || "";
      const node = nodeId ? findNodeById(ast?.tree, nodeId) : null;
      const sem = nodeId && semantics ? semantics[nodeId] : null;

      // ========================
      // Landmark upgrades (ROOT wrapper and selected top-level frames)
      // ========================
      if (opts.enableLandmarks) {
        const isRootWrapper = i === rootWrapperOpenIndex && opts.upgradeRootWrapper;
        const isRootNode = !!(nodeId && rootAstId && nodeId === rootAstId);
        const isTopLevel = !!(nodeId && topLevelIds.has(nodeId));

        // Use AST root name/semantics to guide root wrapper even without data-node.
        const nameForHint = isRootWrapper
          ? (rootAst?.name || "")
          : (node?.name || "");

        const semForHint = isRootWrapper
          ? (rootAstId && semantics ? semantics[rootAstId] : null)
          : sem;

        const semHint = semLandmarkHint(semForHint);
        const nameHint = nameLandmarkHint(nameForHint);

        // Choose a target landmark:
        // 1) semantics hint if present
        // 2) name hint if present
        // Only apply to root wrapper, root node, or top-level frames (small set).
        let target = null;
        if (isRootWrapper || isRootNode || isTopLevel) {
          target = semHint || nameHint;
        }

        if (target && isContainerishHtmlTag(tag.name) && !insideInteractive) {
          // MAIN uniqueness guard
          if (target.kind === "main" && mainApplied) {
            target = null;
          }

          // Rename tag only in strict mode; otherwise keep tag and apply role/aria.
          const canRename = canRenameToLandmark({
            opts,
            insideInteractive,
            currentTag: tag.name,
            targetTag: target.kind,
          });

          if (target) {
            if (canRename && target.kind !== tag.name) {
              tag.name = target.kind;
              report.fixes.push(
                `Landmark: upgraded <${parseTag(t.value).name}> to <${target.kind}>` +
                (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
              );
            }

            // Banner role: apply for hero/header targets (even if tag remains <section> when strictLandmarks=false)
            const wantsBanner =
              target.role === "banner" ||
              target.kind === "header" && /\b(hero|banner|jumbotron|masthead|top)\b/.test(normHint(nameForHint));

            if (wantsBanner && !bannerApplied) {
              // Only set role if missing; do not override explicit roles.
              setIfMissing(tag.attrs, "role", "banner");
              bannerApplied = true;
              report.fixes.push(
                `Landmark: applied role="banner"` +
                (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
              );
            }

            // Nav aria-label (minimal): only if tag is nav after rename OR already nav.
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

            // Main uniqueness mark once we apply it (either by rename or by semantics hint).
            if (target.kind === "main" && (tag.name === "main" || !opts.strictLandmarks)) {
              mainApplied = true;
            }

            // Section/header/banner labelling: aria-labelledby if we can reliably find a heading.
            // Applies to:
            // - <section>
            // - <header role="banner"> (your preferred pattern)
            const isSectionLike =
              tag.name === "section" ||
              (getAttr(tag.attrs, "role") === "banner") ||
              tag.name === "header";

            if (isSectionLike) {
              const hasAL = !!getAttr(tag.attrs, "aria-label");
              const hasALB = !!getAttr(tag.attrs, "aria-labelledby");

              // If already labelled, do nothing.
              if (!hasAL && !hasALB) {
                // Use nodeId (preferred), else AST root id for root wrapper, else nothing.
                const seed =
                  nodeId ||
                  (isRootWrapper && rootAstId ? stableIdFromToken(rootAstId) : "");

                const found = seed ? findOrCreateHeadingIdInRange(tokens, i, seed) : null;

                if (found?.headingId) {
                  setAttr(tag.attrs, "aria-labelledby", found.headingId);
                  report.fixes.push(
                    `Landmark: added aria-labelledby="${found.headingId}"` +
                    (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
                  );
                } else if (target.kind === "section") {
                  // As a fallback for non-hero sections, aria-label from name/semantics (minimal).
                  const label =
                    (typeof semForHint?.label === "string" && semForHint.label.trim())
                      ? semForHint.label.trim()
                      : (trimText(nameForHint) || "");

                  if (label) {
                    setAttr(tag.attrs, "aria-label", label.length > 80 ? label.slice(0, 77) + "…" : label);
                    report.fixes.push(
                      `Landmark: added aria-label on <section>` +
                      (nodeId ? ` (data-node=${nodeId}).` : " (root wrapper).")
                    );
                  }
                }
              }
            }

            tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
            continue;
          }
        }
      }

      // ========================
      // Typography injection (existing behavior)
      // ========================
      if (nodeId) {
        // Typography (safe: only if node.typography exists)
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

      // Prevent nested interactive inside <a>
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

    if (tag.name !== "div" && tag.name !== "section" && tag.name !== "main" && tag.name !== "header")
      continue;

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

      // Ensure a nearby ancestor wrapper is relative
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

  return { html: tokensToString(tokens), report };
}
