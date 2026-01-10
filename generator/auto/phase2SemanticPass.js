// generator/auto/phase2SemanticPass.js
// Phase-2: Semantic + Accessible pass.
// Uses data-node="<AST id>" emitted by Phase-1 to improve:
// - aria-label on icon-only buttons/links
// - alt text for images
// - optional landmark upgrades (nav/header/footer) based on semantics map
//
// Extended in this version:
// - Deterministic layout fix: promote overlay RECTANGLE layers (e.g. hero overlays/gradients)
//   to absolute layers so they don’t break flow/layout in the preview/output.
// - Deterministic typography emission from AST node.typography (NO guessing)

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
  // If Figma layer name looks like placeholder/bg, treat decorative
  if (!n) return "";
  if (/\b(bg|background|shape|rectangle|vector)\b/i.test(n)) return "";
  return n.length > 120 ? n.slice(0, 117) + "…" : n;
}

function inferLabelFromNode(node) {
  if (!node) return null;
  const n = trimText(node.name || "");
  if (!n) return null;
  // Remove common non-label tokens
  const cleaned = n
    .replace(/\b(frame|group|component|instance)\b/gi, "")
    .trim();
  return cleaned || n;
}

function tokensToString(tokens) {
  return tokens.map((t) => t.value).join("");
}

/* ==================== Typography (NEW, STRICT) ==================== */

const FONT_FAMILY_MAP = {
  "Red Hat Display": "font-primary",
  "Red Hat Text": "font-secondary",
};

// Deterministic: emit exact values. No semantic tailwind guesses.
function typographyToTailwind(typography) {
  if (!typography || typeof typography !== "object") return "";

  const {
    family,
    sizePx,
    lineHeightPx,
    weight,
    letterSpacingPx,
    colorHex,
  } = typography;

  const out = [];

  if (colorHex) out.push(`text-[${colorHex}]`);

  if (family) {
    const mapped = FONT_FAMILY_MAP[String(family)];
    if (mapped) out.push(mapped);
  }

  if (typeof sizePx === "number" && Number.isFinite(sizePx) && sizePx > 0) {
    out.push(`text-[${sizePx}px]`);
  }

  if (
    typeof lineHeightPx === "number" &&
    Number.isFinite(lineHeightPx) &&
    lineHeightPx > 0
  ) {
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

/* -------------------- Layout Fix Helpers (deterministic) -------------------- */

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

  // Strong signals
  if (hasGradientFill(node)) return true;
  if (node.opacity !== undefined && node.opacity < 1) return true;
  if (isMostlyCoveringParent(node, parentNode)) return true;

  // Weak signal
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

/* -------------------- Main pass -------------------- */

export function semanticAccessiblePass({ html, ast, semantics }) {
  const report = { fixes: [], warnings: [] };
  let tokens = tokenize(html || "");

  const parentMap = buildParentMap(ast?.tree);

  // Track interactive nesting to prevent <a><button> etc.
  let linkDepth = 0;

  // Stack for icon-only aria-label detection
  const interactiveStack = []; // { name, attrs, openIndex, hasText, nodeId }

  // Pass A: Accessibility/semantics (existing behavior) + Typography (NEW, safe)
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

    // TYPOGRAPHY (NEW):
    // Apply deterministic typography classes to OPEN tags that correspond to AST nodes.
    // Do this early, but do NOT interfere with special cases like <img self>.
    if (tag.kind === "open") {
      const nodeId = getAttr(tag.attrs, "data-node");
      if (nodeId) {
        const node = findNodeById(ast?.tree, nodeId);
        if (node?.typography) {
          const tw = typographyToTailwind(node.typography);
          if (tw) addClass(tag.attrs, tw);

          // Warn if font family is unmapped (do not guess)
          const fam = String(node.typography.family || "").trim();
          if (fam && !FONT_FAMILY_MAP[fam]) {
            report.warnings.push(
              `Unmapped font family "${fam}" on data-node=${nodeId}. Add to FONT_FAMILY_MAP for deterministic output.`
            );
          }

          tokens[i] = { type: "tag", value: buildTag(tag.name, tag.attrs, "open") };
          continue;
        }
      }
    }

    // SELF: images
    if (tag.kind === "self" && tag.name === "img") {
      const nodeId = getAttr(tag.attrs, "data-node");
      const node = findNodeById(ast?.tree, nodeId);

      // Always ensure lazy/async
      if (!getAttr(tag.attrs, "loading")) setAttr(tag.attrs, "loading", "lazy");
      if (!getAttr(tag.attrs, "decoding")) setAttr(tag.attrs, "decoding", "async");

      // Alt strategy:
      // 1) semantics map explicit alt
      // 2) existing alt if non-empty
      // 3) infer from AST node name; else decorative
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

    // OPEN: interactive elements
    if (tag.kind === "open" && (tag.name === "a" || tag.name === "button")) {
      if (tag.name === "a") linkDepth++;

      // Focus-visible ring
      addClass(tag.attrs, "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2");

      // Buttons should default to type=button
      if (tag.name === "button" && !getAttr(tag.attrs, "type")) {
        setAttr(tag.attrs, "type", "button");
        report.fixes.push('Added type="button" on <button>.');
      }

      // Anchors should have href
      if (tag.name === "a" && !getAttr(tag.attrs, "href")) {
        setAttr(tag.attrs, "href", "#");
        report.fixes.push('Added href="#" on <a>.');
      }

      // Prevent nested interactive inside <a>
      if (linkDepth > 1) {
        report.warnings.push("Nested <a> inside <a> converted to <span>.");
        tag.name = "span";
      }
      if (linkDepth > 0 && tag.name === "button") {
        report.warnings.push("Nested <button> inside <a> converted to <span>.");
        tag.name = "span";
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

    // CLOSE: interactive elements - add aria-label if icon-only
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

          // rewrite the open tag in-place
          tokens[top.openIndex] = { type: "tag", value: buildTag(top.name, top.attrs, "open") };
          report.fixes.push(`Added aria-label on <${top.name}> (icon-only).`);
        }
      }

      if (tag.name === "a") linkDepth = Math.max(0, linkDepth - 1);
      continue;
    }
  }

  // Pass B: Deterministic layout fixes (overlay RECTANGLE -> absolute layer)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "tag") continue;

    const tag = parseTag(t.value);
    if (tag.kind !== "open") continue;

    // Rectangles are typically emitted as divs (sometimes spans/sections depending on Phase-1)
    if (tag.name !== "div" && tag.name !== "span" && tag.name !== "section") continue;

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

      // Best-effort: ensure a nearby ancestor wrapper is relative
      // (walk backwards to find a plausible container open tag)
      for (let j = i - 1; j >= 0; j--) {
        const tj = tokens[j];
        if (tj.type !== "tag") continue;

        const pj = parseTag(tj.value);
        if (pj.kind === "open" && (pj.name === "div" || pj.name === "section")) {
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
