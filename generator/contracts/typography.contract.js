const MALFORMED_FONT_TOKEN = /^font-\[[^\]]*$/;
const CLASS_ATTR_REGEX = /\bclass\s*=\s*(["'])([\s\S]*?)\1/g;

function splitTokens(value) {
  return String(value || "")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isMalformedFontToken(token) {
  return MALFORMED_FONT_TOKEN.test(token);
}

const typographyContract = {
  id: "typography",
  stage: "html",
  order: 100,
  apply({ html }, ctx = {}) {
    let scannedElementsCount = 0;
    let malformedFontTokenCount = 0;
    let changed = false;

    const safeFix = ctx?.safeFix === true;

    const outputHtml = String(html || "").replace(
      CLASS_ATTR_REGEX,
      (match, quote, classValue) => {
        scannedElementsCount += 1;
        const tokens = splitTokens(classValue);
        const malformed = tokens.filter(isMalformedFontToken);
        if (malformed.length) malformedFontTokenCount += malformed.length;

        if (!safeFix || malformed.length === 0) return match;

        const cleaned = tokens.filter((token) => !isMalformedFontToken(token));
        changed = true;
        if (!cleaned.length) return "";
        return `class=${quote}${cleaned.join(" ")}${quote}`;
      }
    );

    const warnings = [];
    if (malformedFontTokenCount > 0) {
      warnings.push(`Detected ${malformedFontTokenCount} malformed font token(s).`);
    }

    return {
      output: { html: outputHtml },
      warnings,
      errors: [],
      metrics: {
        malformedFontTokenCount,
        scannedElementsCount,
      },
      changed,
    };
  },
};

export default typographyContract;
