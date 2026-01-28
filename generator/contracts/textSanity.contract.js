import { applyPatches, createPatch } from "./contractTypes.js";

const TEXT_TAG_RE = /<(button|a|p|span|h[1-6])\b([^>]*)>([^<]*)<\/\1>/gi;
const LEADING_GARBAGE_RE = /^\s*0"\s*&gt;\s*/;
const TRAILING_GARBAGE_RE = /\s*v&gt;\s*$/;

function sanitizeText(text) {
  let out = String(text || "");
  out = out.replace(LEADING_GARBAGE_RE, "");
  out = out.replace(TRAILING_GARBAGE_RE, "");
  if (out.includes("&gt;")) {
    out = out.replace(/&gt;/g, ">");
  }
  return out;
}

export const textSanityContract = {
  name: "textSanity",
  order: 1000,
  apply(html) {
    const patches = [];
    let match;

    while ((match = TEXT_TAG_RE.exec(html))) {
      const full = match[0];
      const tag = match[1];
      const attrs = match[2] || "";
      const text = match[3] || "";

      const sanitized = sanitizeText(text);
      if (sanitized === text) continue;

      const start = match.index;
      const end = start + full.length;
      const replacement = `<${tag}${attrs}>${sanitized}</${tag}>`;
      patches.push(createPatch(start, end, replacement));
    }

    const output = applyPatches(html, patches);
    return { html: output, changedNodes: patches.length, notes: [] };
  },
};

export default textSanityContract;
