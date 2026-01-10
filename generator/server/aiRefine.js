// generator/server/aiRefine.js

import process from "node:process";

function envBool(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function looksLikeHtml(s) {
  return typeof s === "string" && s.includes("<") && s.includes(">") && s.length > 20;
}

function stripCodeFences(s) {
  return String(s || "")
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "");
}

function extractTextFromResponsesOutput(outputArr) {
  try {
    const parts = [];
    for (const item of outputArr) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === "output_text" && typeof c?.text === "string") parts.push(c.text);
        if (typeof c?.text === "string" && !c?.type) parts.push(c.text);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

export async function maybeAIRefine(fragment, ast) {
  const enabled = envBool(process.env.AI_REFINE);
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

  if (!enabled) return fragment;
  if (!apiKey) {
    console.warn("[ai] AI_REFINE enabled but OPENAI_API_KEY missing; skipping.");
    return fragment;
  }
  if (!looksLikeHtml(fragment)) return fragment;

  let OpenAI;
  try {
    ({ default: OpenAI } = await import("openai"));
  } catch {
    console.warn("[ai] openai SDK not installed; run `npm i openai`. Skipping AI refine.");
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

  const client = new OpenAI({ apiKey });

  try {
    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_output_tokens: 1800,
      temperature: 0.15,
    });

    const outText =
      (resp && typeof resp.output_text === "string" && resp.output_text.trim()) ||
      (resp && Array.isArray(resp.output) ? extractTextFromResponsesOutput(resp.output) : "") ||
      "";

    if (!outText.trim()) return fragment;

    const cleaned = stripCodeFences(outText).trim();
    return cleaned || fragment;
  } catch (e) {
    console.warn("[ai] refine failed; continuing deterministically:", String(e?.message || e));
    return fragment;
  }
}
