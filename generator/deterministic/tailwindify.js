// deterministic/tailwindify.js — pixel-perfect AST → Tailwind HTML fragment (absolute layout)

const px = (n) => `${Math.round(n * 1000) / 1000}px`;
const cls = (...parts) => parts.filter(Boolean).join(' ');

export function tailwindify(ast) {
  const { frame, tree, slots = {} } = ast;
  const html = renderFrame(frame, tree, slots);
  return html;
}

function renderFrame(frame, node, slots) {
  const wrap = cls(
    'relative',
    `w-[${px(frame.w)}]`,
    `h-[${px(frame.h)}]`,
    'overflow-hidden'
  );
  return `
<div class="${wrap}">
  ${renderNode(node, node, slots, { ox: frame.x, oy: frame.y })}
</div>`.trim();
}

function renderNode(root, node, slots, ctx) {
  // If this node matches a slot id, emit slot marker and skip children.
  const slotName = findSlot(slots, node.id);
  if (slotName) return slotMarkup(slotName, node);

  const style = boxToClasses(node, ctx);
  const deco = decorationClasses(node);
  const base = cls('absolute', style, deco);

  // text
  if (node.text) {
    return `
<div class="${base}">
  ${textMarkup(node)}
</div>`.trim();
  }

  // image node
  if (node.img?.src) {
    return `
<img class="${base} object-cover" src="${escape(node.img.src)}" alt="" loading="lazy" decoding="async" />`.trim();
  }

  // container
  const kids = (node.children || []).map(n => renderNode(root, n, slots, ctx)).join('\n');
  if (!kids) {
    // plain box (could be overlay card)
    return `<div class="${base}"></div>`;
  }
  return `<div class="${base}">\n${kids}\n</div>`;
}

function boxToClasses(node, { ox, oy }) {
  const left = node.x - ox;
  const top = node.y - oy;
  const width = node.w;
  const height = node.h;

  const out = [
    `left-[${px(left)}]`,
    `top-[${px(top)}]`,
    `w-[${px(width)}]`,
    `h-[${px(height)}]`,
  ];
  return out.join(' ');
}

function decorationClasses(node) {
  const out = [];
  if (node.r && node.r > 0) {
    out.push(radiusToTW(node.r));
    out.push('bg-white'); // neutral overlay bg; you can strip or map colors later
    out.push('border');   // thin border like in the screenshot; remove if not needed
  }
  if (node.shadow?.length) out.push('shadow'); // generic; could map exact blur/offset via shadow-[...]
  return out.join(' ');
}

function radiusToTW(r) {
  if (r <= 0) return 'rounded-none';
  if (r <= 6) return 'rounded';
  if (r <= 8) return 'rounded-md';
  if (r <= 12) return 'rounded-lg';
  if (r <= 16) return 'rounded-xl';
  return 'rounded-[${r}px]';
}

function textMarkup(node) {
  const t = node.text || {};
  const aligns = { left: 'text-left', center: 'text-center', right: 'text-right' };
  const lh = t.lineHeightPx ? `leading-[${px(t.lineHeightPx)}]` : '';
  const ls = t.letterSpacingPx ? `tracking-[${px(t.letterSpacingPx)}]` : '';
  const fs = t.fontSize ? `text-[${px(t.fontSize)}]` : '';
  const fw = t.fontWeight ? `font-[${t.fontWeight}]` : '';

  // Slot for the *content*, not hardcoded text:
  // Prefer semantic slot names if this text node *is* the "heading/subcopy" by ID.
  // Otherwise use a generic <span><!--SLOT:...--></span> fallback.
  return `<div class="${cls(aligns[t.align || 'left'], fs, fw, lh, ls)}"><!--SLOT:auto_text_${node.id}--></div>`;
}

function findSlot(slots, id) {
  for (const key of Object.keys(slots || {})) {
    if (slots[key] === id) return key; // e.g. 'heading', 'subcopy', 'cta_primary', 'image_main', 'overlay'
  }
  return '';
}

function slotMarkup(name, node) {
  // Wrap slot in a box so its size/position remains correct
  return `<div class="absolute ${boxToClasses(node, { ox: node.x, oy: node.y })}">
  ${namedSlot(name)}
</div>`;
}

function namedSlot(name) {
  switch (name) {
    case 'heading': return '<!--SLOT:heading-->';
    case 'subcopy': return '<!--SLOT:subcopy-->';
    case 'cta_primary': return '<!--SLOT:cta_primary-->';
    case 'image_main': return '<!--SLOT:image_main-->';
    case 'overlay': return '<!--SLOT:overlay-->';
    default: return `<!--SLOT:${name}-->`;
  }
}

function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
