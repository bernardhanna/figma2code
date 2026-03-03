// generator/qa/applyPatches.js
// Class-only patch application on HTML string using data-key targeting.

function splitClasses(classValue) {
  return String(classValue || "")
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinClasses(tokens) {
  return Array.from(new Set(tokens)).join(" ").trim();
}

function escapeRegExp(v) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePatch(patch) {
  if (!patch || typeof patch !== "object") return null;
  const targetKey = String(patch.targetKey || "").trim();
  const op = String(patch.op || "").trim();
  const classes = Array.isArray(patch.classes) ? patch.classes.map((c) => String(c || "").trim()).filter(Boolean) : [];
  if (!targetKey || !op || !classes.length) return null;
  if (!["classAdd", "classRemove", "classReplace"].includes(op)) return null;
  return { targetKey, op, classes };
}

function applyToClassValue(classValue, op, classes) {
  const tokens = splitClasses(classValue);
  if (op === "classAdd") {
    return joinClasses([...tokens, ...classes]);
  }
  if (op === "classRemove") {
    const removeSet = new Set(classes);
    return joinClasses(tokens.filter((t) => !removeSet.has(t)));
  }
  if (op === "classReplace") {
    const next = [...tokens];
    for (let i = 0; i < classes.length - 1; i += 2) {
      const from = classes[i];
      const to = classes[i + 1];
      if (!from || !to) continue;
      const idx = next.indexOf(from);
      if (idx >= 0) next[idx] = to;
    }
    return joinClasses(next);
  }
  return joinClasses(tokens);
}

function patchTagClass(tag, op, classes) {
  const classRe = /\sclass=(["'])([\s\S]*?)\1/i;
  const classMatch = tag.match(classRe);
  if (!classMatch) {
    if (op !== "classAdd") return tag;
    const newClass = joinClasses(classes);
    if (!newClass) return tag;
    return tag.replace(/>$/, ` class="${newClass}">`);
  }
  const quote = classMatch[1];
  const oldClass = classMatch[2];
  const nextClass = applyToClassValue(oldClass, op, classes);
  if (nextClass === oldClass) return tag;
  return tag.replace(classRe, ` class=${quote}${nextClass}${quote}`);
}

export function applyPatches(html, patches) {
  let nextHtml = String(html || "");
  const applied = [];
  const skipped = [];

  const list = Array.isArray(patches) ? patches.map(parsePatch).filter(Boolean) : [];
  for (const patch of list) {
    const keyEsc = escapeRegExp(patch.targetKey);
    const tagRe = new RegExp(
      `<([a-zA-Z][\\w:-]*)([^>]*\\sdata-key=(["'])${keyEsc}\\3[^>]*)>`,
      "g"
    );

    let matched = false;
    nextHtml = nextHtml.replace(tagRe, (full) => {
      matched = true;
      return patchTagClass(full, patch.op, patch.classes);
    });

    if (matched) applied.push(patch);
    else skipped.push({ patch, reason: "target-not-found" });
  }

  return {
    html: nextHtml,
    applied,
    debug: {
      attempted: list.length,
      appliedCount: applied.length,
      skipped,
    },
  };
}

