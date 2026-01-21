// generator/auto/widgets/utils.js

export function parseWidgetDirective(name) {
  const sourceName = String(name || "").trim();
  if (!sourceName) return null;

  const lower = sourceName.toLowerCase();

  const scopeMatches = [...lower.matchAll(/@(desktop|tablet|mobile)\b/g)];
  const scope = scopeMatches.length
    ? scopeMatches[scopeMatches.length - 1][1]
    : "all";

  const hasDropdown = /\b(dropdown|select)\b/.test(lower);
  const enhanceNice = /\b(nice-select|niceselect)\b/.test(lower);

  const hasSlider = /\b(slider|carousel)\b/.test(lower);
  const enhanceSlick = /\b(slick|slick-slider|slick-carousel)\b/.test(lower);

  let type = null;
  let enhance = null;

  if (hasDropdown || enhanceNice) {
    type = "dropdown";
    enhance = enhanceNice ? "nice-select" : null;
  } else if (hasSlider || enhanceSlick) {
    type = "slider";
    enhance = "slick";
  }

  if (!type) return null;

  return { type, enhance, scope, sourceName };
}
