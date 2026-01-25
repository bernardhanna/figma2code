// generator/server/tailwindPreflight.js

const CLASS_ATTR_RE = /\bclass\s*=\s*(["'])([^"']*)\1/g;

const DISPLAY_CLASSES = new Set([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "contents",
  "hidden",
  "table",
  "table-row",
  "table-cell",
  "table-caption",
  "table-column",
  "table-column-group",
  "table-header-group",
  "table-footer-group",
  "table-row-group",
]);

const POSITION_CLASSES = new Set(["static", "fixed", "absolute", "relative", "sticky"]);

const TEXT_ALIGN_CLASSES = new Set([
  "text-left",
  "text-center",
  "text-right",
  "text-justify",
  "text-start",
  "text-end",
]);

const SPACING_PREFIXES = [
  "p",
  "px",
  "py",
  "pt",
  "pr",
  "pb",
  "pl",
  "m",
  "mx",
  "my",
  "mt",
  "mr",
  "mb",
  "ml",
];

function splitVariants(token) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "[") depth += 1;
    if (ch === "]" && depth > 0) depth -= 1;
    if (ch === ":" && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  const base = parts.pop() || "";
  const variant = parts.join(":");
  return { variant, base };
}

function groupKeyForBase(baseRaw) {
  const base = baseRaw.startsWith("!") ? baseRaw.slice(1) : baseRaw;

  if (DISPLAY_CLASSES.has(base)) return "display";
  if (POSITION_CLASSES.has(base)) return "position";
  if (TEXT_ALIGN_CLASSES.has(base)) return "text-align";

  if (base.startsWith("overflow-x-")) return "overflow-x";
  if (base.startsWith("overflow-y-")) return "overflow-y";
  if (base.startsWith("overflow-")) return "overflow";

  if (/^flex-(row|col)(-reverse)?$/.test(base)) return "flex-direction";
  if (/^flex-(wrap|nowrap|wrap-reverse)$/.test(base)) return "flex-wrap";

  if (base.startsWith("items-")) return "items";
  if (base.startsWith("justify-")) return "justify";
  if (base.startsWith("self-")) return "self";

  if (base.startsWith("gap-x-")) return "gap-x";
  if (base.startsWith("gap-y-")) return "gap-y";
  if (base.startsWith("gap-")) return "gap";

  for (const prefix of SPACING_PREFIXES) {
    if (base.startsWith(prefix + "-")) return `spacing:${prefix}`;
  }

  if (base.startsWith("min-w-")) return "min-w";
  if (base.startsWith("max-w-")) return "max-w";
  if (base.startsWith("w-")) return "w";

  if (base.startsWith("min-h-")) return "min-h";
  if (base.startsWith("max-h-")) return "max-h";
  if (base.startsWith("h-")) return "h";

  if (base.startsWith("leading-")) return "leading";
  if (base.startsWith("tracking-")) return "tracking";
  if (base.startsWith("opacity-")) return "opacity";
  if (base.startsWith("z-")) return "z";

  return "";
}

function analyzeTokens(tokens) {
  let duplicateTokens = 0;
  let conflictTokens = 0;
  const seen = new Set();
  const groupSeen = new Set();

  for (const token of tokens) {
    if (!token) continue;
    if (seen.has(token)) duplicateTokens += 1;
    seen.add(token);

    const { variant, base } = splitVariants(token);
    const group = groupKeyForBase(base);
    if (group) {
      const key = variant ? `${variant}|${group}` : group;
      if (groupSeen.has(key)) conflictTokens += 1;
      groupSeen.add(key);
    }
  }

  return { duplicateTokens, conflictTokens };
}

function cleanTokens(tokens) {
  let duplicatesRemoved = 0;
  let conflictsResolved = 0;
  const remove = new Set();
  const seen = new Map();
  const lastByGroup = new Map();

  tokens.forEach((token, idx) => {
    if (!token) return;

    if (seen.has(token)) {
      remove.add(seen.get(token));
      duplicatesRemoved += 1;
    }
    seen.set(token, idx);

    const { variant, base } = splitVariants(token);
    const group = groupKeyForBase(base);
    if (group) {
      const key = variant ? `${variant}|${group}` : group;
      if (lastByGroup.has(key)) {
        remove.add(lastByGroup.get(key));
        conflictsResolved += 1;
      }
      lastByGroup.set(key, idx);
    }
  });

  const cleaned = tokens.filter((token, idx) => token && !remove.has(idx));
  return { cleaned, duplicatesRemoved, conflictsResolved };
}

export function repairTailwindClasses(html) {
  const report = {
    fixes: [],
    warnings: [],
    stats: { elements: 0, tokens: 0, duplicatesRemoved: 0, conflictsResolved: 0 },
  };

  if (typeof html !== "string") return { html: "", report };

  const out = html.replace(CLASS_ATTR_RE, (match, quote, classValue) => {
    report.stats.elements += 1;
    const tokens = String(classValue || "").split(/\s+/).filter(Boolean);
    if (!tokens.length) return match;

    report.stats.tokens += tokens.length;
    const cleaned = cleanTokens(tokens);
    report.stats.duplicatesRemoved += cleaned.duplicatesRemoved;
    report.stats.conflictsResolved += cleaned.conflictsResolved;

    return `class=${quote}${cleaned.cleaned.join(" ")}${quote}`;
  });

  if (report.stats.duplicatesRemoved > 0) {
    report.fixes.push(`Removed ${report.stats.duplicatesRemoved} duplicate Tailwind class token(s).`);
  }
  if (report.stats.conflictsResolved > 0) {
    report.fixes.push(`Resolved ${report.stats.conflictsResolved} conflicting Tailwind class token(s).`);
  }

  return { html: out, report };
}

export function validateTailwindClasses(html) {
  const report = {
    warnings: [],
    stats: { elements: 0, tokens: 0, duplicateTokens: 0, conflictTokens: 0 },
  };

  if (typeof html !== "string") return report;

  let totalDuplicates = 0;
  let totalConflicts = 0;

  html.replace(CLASS_ATTR_RE, (match, quote, classValue) => {
    report.stats.elements += 1;
    const tokens = String(classValue || "").split(/\s+/).filter(Boolean);
    report.stats.tokens += tokens.length;
    const analyzed = analyzeTokens(tokens);
    totalDuplicates += analyzed.duplicateTokens;
    totalConflicts += analyzed.conflictTokens;
    return match;
  });

  report.stats.duplicateTokens = totalDuplicates;
  report.stats.conflictTokens = totalConflicts;

  if (totalDuplicates > 0) {
    report.warnings.push(`Found ${totalDuplicates} duplicate Tailwind class token(s).`);
  }
  if (totalConflicts > 0) {
    report.warnings.push(
      `Found ${totalConflicts} conflicting Tailwind class token(s) sharing the same modifier group.`
    );
  }

  return report;
}
