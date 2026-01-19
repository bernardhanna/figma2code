// generator/componentLibrary/match.js
//
// Scaffolding matcher: best-effort match of an incoming AST/frame to a canonical component
// in /components/<type>/<id>/. This does NOT change preview output; it only stamps meta.

function str(v) {
  return String(v || "").trim();
}

function lower(v) {
  return str(v).toLowerCase();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

export function inferSectionTypeFromAst(ast) {
  const name = lower(
    firstNonEmpty(ast?.meta?.figma?.frameName, ast?.tree?.name, ast?.frame?.name, ast?.slug)
  );

  // Simple heuristics; keep conservative.
  if (/\bhero\b/.test(name)) return "hero";
  if (/\btitle\b/.test(name)) return "title";
  if (/\bcta\b/.test(name)) return "cta";
  if (/\bfaq\b/.test(name)) return "faq";
  if (/\btestimonial/.test(name)) return "testimonials";
  if (/\bteam\b/.test(name)) return "team";
  if (/\bpartner\b/.test(name)) return "partners";
  if (/\bservice\b/.test(name)) return "services";
  if (/\bcontent\b/.test(name)) return "content";
  if (/\bcontact\b/.test(name)) return "contact";
  if (/\bgallery\b/.test(name)) return "gallery";
  if (/\bbrand\b/.test(name)) return "brands";
  if (/\baccredit/.test(name)) return "accreditations";

  // Fallback: ast.type sometimes equals "navbar"/"footer"/etc; keep it if it looks like a component folder name.
  const t = lower(ast?.type);
  if (t && /^[a-z0-9-]+$/.test(t)) return t;

  return "";
}

function parseExplicitComponentHint(frameName) {
  const s = lower(frameName);

  // Examples:
  // - hero_001
  // - hero/001
  // - hero-001
  // - "Hero 001"
  const m =
    s.match(/\b([a-z0-9-]+)[/_\s-]+(\d{1,4})\b/) ||
    s.match(/\b([a-z0-9-]+)\s*[_/:-]\s*(\d{1,4})\b/);

  if (!m) return null;

  const type = String(m[1] || "").trim();
  const idRaw = String(m[2] || "").trim();
  const id = idRaw ? idRaw.padStart(3, "0") : "";
  if (!type || !id) return null;
  return { type, id };
}

export function matchComponentForAst(ast, componentLibrary, { debug = false } = {}) {
  const lib = componentLibrary;
  const frameName = firstNonEmpty(ast?.meta?.figma?.frameName, ast?.tree?.name, ast?.frame?.name, ast?.slug);

  if (!lib || !lib.byType) {
    return { type: "", id: "", confidence: 0, reason: "componentLibrary_missing" };
  }

  // 1) Direct explicit match in frame name
  const explicit = parseExplicitComponentHint(frameName);
  if (explicit) {
    const variants = lib.byType?.[explicit.type]?.variants || [];
    const found = variants.find((v) => String(v.id) === String(explicit.id));
    if (found) {
      return {
        type: explicit.type,
        id: explicit.id,
        confidence: 0.98,
        reason: `explicit_hint:${explicit.type}_${explicit.id}`,
      };
    }

    // Type exists but id not found: fallback to type default
    if (variants.length) {
      return {
        type: explicit.type,
        id: variants[0].id,
        confidence: 0.6,
        reason: `explicit_type_only_missing_id:${explicit.type}_${explicit.id}`,
      };
    }
  }

  // 2) Infer type and pick lowest id
  const inferredType = inferSectionTypeFromAst(ast);
  if (inferredType) {
    const variants = lib.byType?.[inferredType]?.variants || [];
    if (variants.length) {
      return {
        type: inferredType,
        id: variants[0].id,
        confidence: 0.4,
        reason: `inferred_type_default_lowest_id:${inferredType}`,
      };
    }
  }

  if (debug) {
    console.log("[componentLibrary] no match", { frameName, inferredType });
  }

  return { type: "", id: "", confidence: 0, reason: "no_match" };
}

export function annotateAstWithComponentMatch(ast, componentLibrary, { debug = false } = {}) {
  if (!ast || typeof ast !== "object") return ast;

  const m = matchComponentForAst(ast, componentLibrary, { debug });
  if (!m || !m.type || !m.id) {
    // Still stamp a structured miss, so Phase 2 exporter can see it.
    const next = {
      ...ast,
      meta: {
        ...(ast.meta || {}),
        componentMatch: { ...(m || {}), type: m?.type || "", id: m?.id || "" },
      },
    };
    return next;
  }

  const next = {
    ...ast,
    meta: {
      ...(ast.meta || {}),
      componentMatch: m,
    },
  };

  if (debug) {
    const frameName = firstNonEmpty(
      ast?.meta?.figma?.frameName,
      ast?.tree?.name,
      ast?.frame?.name,
      ast?.slug
    );
    console.log("[componentLibrary] match", { frameName, match: m });
  }

  return next;
}


