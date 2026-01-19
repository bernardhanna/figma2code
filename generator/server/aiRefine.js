// generator/server/aiRefine.js

import { getConfig, getAiClient } from "../config/env.js";

function looksLikeHtml(s) {
  return typeof s === "string" && s.includes("<") && s.includes(">") && s.length > 20;
}

function stripCodeFences(s) {
  return String(s || "")
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "");
}

export async function maybeAIRefine(fragment, ast) {
  const config = getConfig();
  if (!config.aiRefine) return fragment;
  if (!looksLikeHtml(fragment)) return fragment;

  let client;
  try {
    client = await getAiClient(config);
  } catch (e) {
    console.warn("[ai] getAiClient failed; skipping AI refine:", String(e?.message || e));
    return fragment;
  }

  const system = [
    "You are refining an HTML fragment produced from a Figma AST for pixel-faithful rendering.",
    "You must output ONLY valid HTML (no markdown, no commentary).",
    "Preserve all existing `data-node` attributes exactly.",
    "Do NOT introduce fixed heights except for <img> or explicit CTA instances already fixed.",
    "Do NOT add JS, do NOT add external assets, do NOT add <style> tags.",
    "You may adjust Tailwind classes, wrapper structure, and minor tag changes to better match layout.",
    "Prefer flex for small horizontal groups unless children widths are equal; use grid only when children are near-equal width or explicitly hinted (e.g., colsHint). Never use grid for vertical stacks.",
    "Avoid self-stretch; avoid unexpected width growth; preserve semantics of links/buttons when present.",
  ].join("\n");

  const frameW = ast?.tree?.w || ast?.frame?.w || null;
  const frameH = ast?.tree?.h || ast?.frame?.h || null;

  const user = [
    `Frame: ${frameW || "?"}x${frameH || "?"}`,
    `Slug: ${ast?.slug || ""}`,
    "",
    "HTML fragment to refine:",
    fragment,
  ].join("\n");

  try {
    const { text } = await client.complete({
      system,
      user,
      maxOutputTokens: 1800,
      temperature: 0.15,
    });

    if (!text || !String(text).trim()) return fragment;

    const cleaned = stripCodeFences(String(text)).trim();
    return cleaned || fragment;
  } catch (e) {
    console.warn("[ai] refine failed; continuing deterministically:", String(e?.message || e));
    return fragment;
  }
}
