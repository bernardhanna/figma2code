// generator/auto/autoLayoutify/background.js
import { escCssUrl } from "./escape.js";
import { gradientToCss } from "./paint.js";
import { hasImageFill, hasGradientFill, firstFill } from "./styles.js";

export function detectSectionBackground(root, ast) {
  const css = cssBackgroundFromNode(root, ast, {
    includeGradient: true,
    preferPlaceholder: false,
    allowRealSrc: true,
  });

  return {
    css,
    suppressRootBgId: root.id,
    suppressChildIds: findDecorativeBgChildIds(root),
  };
}

function cssBackgroundFromNode(node, ast, opts = {}) {
  const w = Math.max(1, Math.round(node?.w || ast?.frame?.w || 1600));
  const h = Math.max(1, Math.round(node?.h || ast?.frame?.h || 900));

  const placeholderUrl = `https://placehold.co/${w}x${h}/png?text=bgImage`;

  const realSrc =
    (ast?.__bg?.src && typeof ast.__bg.src === "string" && ast.__bg.src.trim()) ||
    (node?.img?.src && typeof node.img.src === "string" && node.img.src.trim()) ||
    "";

  let imgUrl = "";
  if (opts.preferPlaceholder) {
    imgUrl = placeholderUrl;
  } else if (opts.allowRealSrc && realSrc) {
    imgUrl = realSrc;
  } else {
    imgUrl = placeholderUrl;
  }

  const urlLayer = imgUrl ? `url('${escCssUrl(imgUrl)}')` : "";

  let gradientLayer = "";
  if (opts.includeGradient) {
    const fills = Array.isArray(node?.fills) ? node.fills : [];
    const g = fills.find((f) => f?.kind === "gradient");
    if (g) {
      const gcss = gradientToCss(g);
      if (gcss) gradientLayer = gcss;
    }
  }

  const layers = [];
  if (gradientLayer) layers.push(gradientLayer);
  if (urlLayer) layers.push(urlLayer);

  if (!layers.length) layers.push(`url('${escCssUrl(placeholderUrl)}')`);

  return layers.join(", ");
}

function findDecorativeBgChildIds(root) {
  const out = [];
  const kids = root?.children || [];
  if (!kids.length) return out;

  const pw = root?.bb?.w ?? root?.w ?? 0;
  const ph = root?.bb?.h ?? root?.h ?? 0;

  for (const c of kids) {
    const name = String(c?.name || "").toLowerCase();

    if (/\b(bg|background|overlay|gradient)\b/.test(name)) {
      out.push(c.id);
      continue;
    }

    const hasImg = hasImageFill(c) || !!c.img?.src;
    const hasGrad = hasGradientFill(c);
    const hasSolid = firstFill(c)?.kind === "solid";

    const cw = c?.bb?.w ?? c?.w ?? 0;
    const ch = c?.bb?.h ?? c?.h ?? 0;
    const wr = pw ? cw / pw : 0;
    const hr = ph ? ch / ph : 0;
    const covers = wr >= 0.75 && hr >= 0.75;

    if ((hasImg || hasGrad) && covers && !c.text) {
      out.push(c.id);
      continue;
    }

    if (String(root?.name || "").toLowerCase().includes("bgimage")) {
      if (c.type === "RECTANGLE" && hasSolid && !c.text) {
        out.push(c.id);
        continue;
      }
    }
  }

  return out;
}
