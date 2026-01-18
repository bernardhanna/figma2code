// generator/server/variantDecision.js
// Named export: decideResponsiveStrategy

function isStr(x) {
  return typeof x === "string";
}

function getAttr(attrs, name) {
  const s = String(attrs || "");
  let m = s.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  if (m && m[1] != null) return m[1];
  m = s.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  if (m && m[1] != null) return m[1];
  return "";
}

function extractNodeList(html) {
  const out = [];
  const tokenRe = /<([a-zA-Z0-9:-]+)([^>]*?)>/g;

  const tagCount = new Map();

  let m;
  while ((m = tokenRe.exec(html))) {
    const tag = String(m[1] || "").toLowerCase();
    const attrs = m[2] || "";

    const dataKey = getAttr(attrs, "data-key");
    const dataNode = getAttr(attrs, "data-node");
    const id = getAttr(attrs, "id");

    let key = "";
    if (dataKey) key = `data-key:${dataKey}`;
    else if (dataNode) key = `data-node:${dataNode}`;
    else if (id) key = `id:${id}`;
    else {
      const n = (tagCount.get(tag) || 0) + 1;
      tagCount.set(tag, n);
      key = `tag:${tag}#${n}`;
    }

    out.push({ key, tag });
  }

  return out;
}

function toKeySet(list) {
  const s = new Set();
  for (const n of list) s.add(n.key);
  return s;
}

function intersectionSize(aSet, bSet) {
  let c = 0;
  for (const v of aSet) if (bSet.has(v)) c++;
  return c;
}

function commonKeySequences(baseList, varList) {
  const aKeys = baseList.map((n) => n.key);
  const bKeys = varList.map((n) => n.key);
  const bSet = new Set(bKeys);

  const aCommon = aKeys.filter((k) => bSet.has(k));

  const aSet = new Set(aKeys);
  const bCommon = bKeys.filter((k) => aSet.has(k));

  return { aCommon, bCommon };
}

function lcsLength(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;

  let prev = new Array(m + 1).fill(0);
  let cur = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    cur[0] = 0;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) cur[j] = prev[j - 1] + 1;
      else cur[j] = Math.max(prev[j], cur[j - 1]);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[m];
}

function countTags(list, tags) {
  const want = new Set((tags || []).map((t) => String(t).toLowerCase()));
  let c = 0;
  for (const n of list) if (want.has(n.tag)) c++;
  return c;
}

function hasHardFails(baseList, varList) {
  const reasons = [];

  const landmarkTags = ["section", "header", "main", "nav", "footer"];
  for (const t of landmarkTags) {
    const bc = countTags(baseList, [t]);
    const vc = countTags(varList, [t]);
    if (bc !== vc) reasons.push(`landmark-count-diff:${t}:${bc}!=${vc}`);
  }

  const bButtons = countTags(baseList, ["button"]);
  const vButtons = countTags(varList, ["button"]);
  if (bButtons !== vButtons) reasons.push(`button-count-diff:${bButtons}!=${vButtons}`);

  const bLinks = countTags(baseList, ["a"]);
  const vLinks = countTags(varList, ["a"]);
  if (bLinks !== vLinks) reasons.push(`link-count-diff:${bLinks}!=${vLinks}`);

  const bImgs = countTags(baseList, ["img"]);
  const vImgs = countTags(varList, ["img"]);
  if (bImgs !== vImgs) reasons.push(`img-count-diff:${bImgs}!=${vImgs}`);

  return reasons;
}

function scorePair(baseHtml, variantHtml) {
  const baseList = extractNodeList(baseHtml);
  const varList = extractNodeList(variantHtml);

  const baseSet = toKeySet(baseList);
  const varSet = toKeySet(varList);

  const matched = intersectionSize(baseSet, varSet);
  const denom = Math.max(baseSet.size, varSet.size) || 1;
  const keyMatchRatio = matched / denom;

  const { aCommon, bCommon } = commonKeySequences(baseList, varList);
  const commonLen = Math.min(aCommon.length, bCommon.length);
  const lcs = commonLen ? lcsLength(aCommon, bCommon) : 0;
  const orderScore = commonLen ? lcs / commonLen : 0;

  const hardFailReasons = hasHardFails(baseList, varList);

  return {
    baseCount: baseSet.size,
    variantCount: varSet.size,
    matched,
    keyMatchRatio: Number(keyMatchRatio.toFixed(4)),
    commonLen,
    lcs,
    orderScore: Number(orderScore.toFixed(4)),
    hardFailReasons,
  };
}

export function decideResponsiveStrategy({
  mobileHtml,
  tabletHtml,
  desktopHtml,
  thresholds = {
    mergeRatioMin: 0.9,
    mergeOrderMin: 0.85,
    swapRatioMax: 0.75,
  },
} = {}) {
  const scores = {};
  const reasons = [];
  const t = thresholds || {};

  const hasMobile = isStr(mobileHtml) && mobileHtml.trim();
  const hasTablet = isStr(tabletHtml) && tabletHtml.trim();
  const hasDesktop = isStr(desktopHtml) && desktopHtml.trim();

  const baseHtml = hasMobile ? mobileHtml : hasTablet ? tabletHtml : hasDesktop ? desktopHtml : "";

  if (!baseHtml || !String(baseHtml).trim()) {
    return { strategy: "swap", scores, reasons: ["no-base-html"] };
  }

  if (hasTablet) scores.tablet = scorePair(baseHtml, tabletHtml);
  if (hasDesktop) scores.desktop = scorePair(baseHtml, desktopHtml);

  for (const k of Object.keys(scores)) {
    const s = scores[k];
    if (s.hardFailReasons && s.hardFailReasons.length) {
      reasons.push(`hard-fail:${k}:${s.hardFailReasons.join(",")}`);
    }
  }
  if (reasons.length) return { strategy: "swap", scores, reasons };

  for (const k of Object.keys(scores)) {
    const s = scores[k];
    if (s.keyMatchRatio <= (t.swapRatioMax ?? 0.75)) {
      reasons.push(`low-overlap:${k}:${s.keyMatchRatio}<=${t.swapRatioMax ?? 0.75}`);
    }
  }
  if (reasons.length) return { strategy: "swap", scores, reasons };

  let allOk = true;
  for (const k of Object.keys(scores)) {
    const s = scores[k];
    const ok =
      s.keyMatchRatio >= (t.mergeRatioMin ?? 0.9) &&
      s.orderScore >= (t.mergeOrderMin ?? 0.85);

    if (!ok) {
      allOk = false;
      reasons.push(
        `not-safe:${k}:ratio=${s.keyMatchRatio} order=${s.orderScore} (need >=${t.mergeRatioMin ?? 0.9} and >=${t.mergeOrderMin ?? 0.85})`
      );
    }
  }

  if (allOk && Object.keys(scores).length) {
    return { strategy: "merge", scores, reasons: ["all-variants-pass-merge-thresholds"] };
  }

  return { strategy: "swap", scores, reasons: reasons.length ? reasons : ["default-conservative-swap"] };
}
