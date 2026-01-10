// generator/ai/semantics.js
// AI semantics annotator: returns { [nodeId]: { tag, href?, role? } }

function compactNode(n) {
  // Extract only what the model needs to decide semantics
  const f0 = Array.isArray(n.fills) && n.fills.length ? n.fills[0] : null;
  const fillKind = f0?.kind || "none";
  const fillAlpha = typeof f0?.a === "number" ? f0.a : undefined;
  const hasRadius =
    !!n.r && [n.r.tl, n.r.tr, n.r.br, n.r.bl].some((v) => typeof v === "number" && v > 0);
  const hasShadow = Array.isArray(n.shadows) && n.shadows.length > 0;
  const isAuto = !!n.auto && n.auto.layout && n.auto.layout !== "NONE";
  const children = Array.isArray(n.children) ? n.children : [];

  // Aggregate small child summary
  const childSummary = children.reduce(
    (acc, c) => {
      acc.types[c.type] = (acc.types[c.type] || 0) + 1;
      if (c.text?.raw) acc.textChildCount++;
      return acc;
    },
    { types: {}, textChildCount: 0 }
  );

  return {
    id: n.id,
    name: (n.name || "").toLowerCase(),
    type: n.type,
    w: n.w, h: n.h,
    auto: isAuto ? { layout: n.auto.layout, itemSpacing: n.auto.itemSpacing || 0 } : null,
    text: n.text
      ? {
        raw: n.text.raw?.slice(0, 200) || "",
        fontSize: n.text.fontSize || null,
        fontWeight: n.text.fontWeight || null,
        uppercase: !!n.text.uppercase,
      }
      : null,
    actions: n.actions ? { openUrl: n.actions.openUrl || null, isClickable: !!n.actions.isClickable } : null,
    style: {
      fillKind,
      fillAlpha: fillAlpha ?? null,
      hasRadius,
      hasShadow,
      strokeW: n.stroke?.weight || 0,
    },
    childSummary,
    children: children.map(compactNode),
  };
}

function buildPrompt(root) {
  const system = `You are a frontend architect. Your job is to label nodes from a Figma-derived tree with appropriate HTML semantic tags.
Rules:
- Prefer semantic tags: a, button, h1..h6, p, span, nav, header, footer, section, ul, ol, li, img, div.
- If a node (or its autolayout container) is a "button-like" element (solid fill, corner radius, one text child) -> tag "button".
- If a node has an OPEN_URL action or looks like a link -> tag "a" and include "href".
- For text:
  * Very large titles -> h1/h2/h3
  * Body copy -> p
  * Short labels, uppercase small -> span
- For nav containers -> nav (only if clearly navigation).
- Never assign img unless it's actually an image. Background images should remain as container divs.
- If unsure, use "div".
Return JSON: { "nodes": { "<id>": { "tag": "<tag>", "href": "<url?>", "role": "<optional-role>" }, ... } }`;

  const user = {
    task: "Assign semantic tags for each node. Use child shapes, text presence, fills, actions.",
    root,
  };

  return { system, user };
}

export async function annotateSemanticsWithAI(openai, ast) {
  const compact = compactNode(ast.tree);
  const { system, user } = buildPrompt(compact);

  // Ask the model for pure JSON
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ],
  });

  // Parse safe JSON
  const txt = resp.choices?.[0]?.message?.content || "{}";
  let data;
  try { data = JSON.parse(txt); }
  catch { data = { nodes: {} }; }

  if (!data || typeof data !== "object" || typeof data.nodes !== "object") {
    return {};
  }
  return data.nodes;
}
