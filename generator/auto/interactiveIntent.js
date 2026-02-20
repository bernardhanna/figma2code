// generator/auto/interactiveIntent.js
// Deterministic interactive intent resolver used across normalize + render.
import { classifyInteractiveStyle } from "../styleFingerprint/classifyInteractiveStyle.js";

function lower(v) {
  return String(v || "").toLowerCase();
}

function textFromNode(node) {
  const raw = node?.text?.raw;
  return typeof raw === "string" ? raw.trim() : "";
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function hasTextDescendant(node) {
  let ok = false;
  walk(node, (n) => {
    if (ok) return;
    if (textFromNode(n)) ok = true;
  });
  return ok;
}

function hasDateLikeTextDescendant(node) {
  let ok = false;
  const re = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
  walk(node, (n) => {
    if (ok) return;
    const raw = textFromNode(n);
    if (raw && re.test(raw)) ok = true;
  });
  return ok;
}

function hasIconishDescendant(node) {
  let ok = false;
  walk(node, (n) => {
    if (ok) return;
    const nName = lower(n?.name);
    const nKey = lower(n?.key);
    if (
      n?.img?.src ||
      String(n?.type || "").toUpperCase() === "SVG" ||
      /\b(icon|arrow|chevron|caret|glyph|vector)\b/.test(nName) ||
      /\b(icon|arrow|chevron|caret|glyph|vector)\b/.test(nKey)
    ) {
      ok = true;
    }
  });
  return ok;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasFilledBackground(node) {
  const fills = Array.isArray(node?.fills)
    ? node.fills
    : Array.isArray(node?.fill)
      ? node.fill
      : [];
  return fills.some((f) => {
    if (!f || typeof f !== "object") return false;
    const kind = lower(f.kind || f.type || f.fillType);
    if (!kind) return false;
    const alpha = toNum(f.a ?? f.opacity ?? f.alpha ?? 1);
    const visible = alpha === null ? true : alpha > 0.02;
    if (!visible) return false;
    return (
      kind.includes("solid") ||
      kind.includes("gradient") ||
      kind.includes("image") ||
      kind.includes("video")
    );
  });
}

function hasPillShapeIntent(node) {
  const r =
    toNum(node?.r) ??
    toNum(node?.cornerRadius) ??
    toNum(node?.radius) ??
    toNum(node?.style?.radius);
  if (r !== null && r >= 20) return true;
  if (Array.isArray(node?.cornerRadii)) {
    const maxR = Math.max(...node.cornerRadii.map((x) => toNum(x) ?? 0));
    if (maxR >= 20) return true;
  }
  return false;
}

function hasLinkLikeTypography(node) {
  const t = node?.cta?.typography || node?.typography || node?.text || {};
  const deco = lower(t.decoration);
  if (deco === "underline") return true;
  return typeof t.colorHex === "string" && t.colorHex.trim().length > 0;
}

function hasButtonClassSeed(node) {
  const tw = lower(node?.tw);
  const cls = Array.isArray(node?.className)
    ? node.className.map((x) => lower(x)).join(" ")
    : lower(node?.className);
  return /\bbtn\b/.test(tw) || /\bbtn\b/.test(cls);
}

function extractLinkFromNode(node, semantics) {
  const sem = semantics?.[node?.id] || null;
  const href =
    node?.actions?.openUrl ||
    node?.link?.url ||
    node?.prototype?.url ||
    node?.meta?.href ||
    sem?.href ||
    sem?.url ||
    null;
  const target = node?.actions?.target || node?.link?.target || sem?.target || null;
  const rel = node?.link?.rel || sem?.rel || null;
  return {
    href: typeof href === "string" && href.trim() ? href.trim() : null,
    target: typeof target === "string" && target.trim() ? target.trim() : null,
    rel: typeof rel === "string" && rel.trim() ? rel.trim() : null,
  };
}

function nameSignals(node) {
  const name = lower(node?.name);
  const key = lower(node?.key);
  const variant = lower(node?.cta?.variant);
  const all = `${name} ${key} ${variant}`;
  return {
    textLink: /\btext[\s_-]*link\b/.test(all),
    linkLike: /\b(link|href)\b/.test(all),
    buttonLike: /\b(btn|button|cta_button|primary[\s_-]*cta|cta)\b/.test(all),
  };
}

function isDecorativeTimelineEvent(node) {
  const key = lower(node?.key);
  const name = lower(node?.name);
  const hasTimelineKey = key.includes("frame:time") && key.includes("frame:event");
  const timelineByName = /\b(time|timeline)\b/.test(`${name} ${key}`) && /\bevent\b/.test(`${name} ${key}`);
  if (!hasTimelineKey && !timelineByName) return false;

  const w = toNum(node?.w);
  const tinyMarker = w !== null && w > 0 && w <= 32;
  if (!tinyMarker) return false;

  return hasDateLikeTextDescendant(node);
}

export function resolveInteractiveIntent(node, ctx = {}) {
  if (!node || typeof node !== "object") {
    return {
      interactiveType: "none",
      interactiveStyle: "none",
      href: null,
      target: null,
      rel: null,
      reason: "invalid-node",
    };
  }

  if (node.intent && typeof node.intent === "object") {
    return {
      interactiveType: node.intent.interactiveType || "none",
      interactiveStyle: node.intent.interactiveStyle || "none",
      href: node.intent.href || null,
      target: node.intent.target || null,
      rel: node.intent.rel || null,
      reason: node.intent.reason || "precomputed",
    };
  }

  const signals = nameSignals(node);
  const link = extractLinkFromNode(node, ctx.semantics || null);

  const clickable = node?.actions?.isClickable === true;
  const hasOwnAction = clickable || !!node?.actions?.openUrl;
  const hasOwnCtaSignal = !!node?.cta;
  const hasText = hasTextDescendant(node);
  const hasIcon = hasIconishDescendant(node);
  const hasBg = hasFilledBackground(node);
  const pill = hasPillShapeIntent(node);
  const linkTypo = hasLinkLikeTypography(node);
  const btnClassSeed = hasButtonClassSeed(node);

  // Timeline markers (dot + date) are decorative layout elements, not controls.
  if (isDecorativeTimelineEvent(node) && !link.href) {
    return {
      interactiveType: "none",
      interactiveStyle: "none",
      href: null,
      target: null,
      rel: null,
      reason: "timeline-decorative-event",
    };
  }

  let textLinkScore = 0;
  if (signals.textLink) textLinkScore += 3;
  if (signals.linkLike) textLinkScore += 1;
  if (hasText) textLinkScore += 1;
  if (hasIcon) textLinkScore += 1;
  if (!hasBg) textLinkScore += 1;
  if (!pill) textLinkScore += 1;
  if (linkTypo) textLinkScore += 1;

  let buttonScore = 0;
  if (signals.buttonLike) buttonScore += 2;
  if (hasBg) buttonScore += 2;
  if (pill) buttonScore += 2;
  if (btnClassSeed) buttonScore += 1;
  if (node?.cta && !signals.linkLike && !signals.textLink) buttonScore += 1;

  let interactiveStyle = "none";
  const strongButtonStyleSignal =
    signals.buttonLike ||
    String(node?.cta?.variant || "").toLowerCase().includes("button") ||
    String(node?.key || "").toLowerCase().includes("instance:button");

  if (strongButtonStyleSignal && !signals.textLink) {
    interactiveStyle = "button";
  } else if (textLinkScore >= 4 && textLinkScore >= buttonScore + 1) {
    interactiveStyle = "text_link";
  } else if (buttonScore >= 3) {
    interactiveStyle = "button";
  }

  const enableFingerprintStyle =
    String(process.env.INTERACTIVE_STYLE_FINGERPRINT || "").trim() === "1";
  if (enableFingerprintStyle) {
    const fpClass = classifyInteractiveStyle(node);
    if (
      fpClass?.style &&
      fpClass.style !== "unknown" &&
      Number(fpClass.confidence || 0) >= 0.8
    ) {
      interactiveStyle = fpClass.style;
    }
  }

  let interactiveType = "none";
  if (link.href) {
    interactiveType = "link";
  } else if (
    (signals.textLink || signals.linkLike) &&
    (hasOwnAction || hasOwnCtaSignal || String(node?.type || "").toUpperCase() === "INSTANCE")
  ) {
    interactiveType = "link";
  } else if (hasOwnAction || (signals.buttonLike && hasOwnCtaSignal)) {
    interactiveType = "button";
  }

  return {
    interactiveType,
    interactiveStyle,
    href: link.href,
    target: link.target,
    rel: link.rel,
    reason: `scores:text_link=${textLinkScore},button=${buttonScore};signals=${JSON.stringify(signals)}`,
  };
}
