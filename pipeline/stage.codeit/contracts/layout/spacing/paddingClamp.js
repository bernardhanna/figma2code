"use strict";

const {
  applyPatches,
  buildOpenTag,
  createPatch,
  getAttrValue,
  getClassTokens,
  parseHtmlNodes,
  setClassTokens,
} = require("../../utils/html");
const { getNodeMeta } = require("../../utilities/select");

const id = "layout/spacing/paddingClamp";

const normalizeToken = (token) => String(token || "").split(":").pop();

const trimZeros = (value) =>
  String(Number(value.toFixed(6)))
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");

const isHeroLike = (node) => {
  if (!node?.attrs) return false;
  const role = String(getAttrValue(node.attrs, "role") || "").toLowerCase();
  if (role === "banner") return true;
  const bgType = String(getAttrValue(node.attrs, "data-bg-type") || "").toLowerCase();
  if (bgType === "video" || bgType === "image") return true;
  const dataKey = String(getAttrValue(node.attrs, "data-key") || "").toLowerCase();
  const dataNode = String(getAttrValue(node.attrs, "data-node") || "").toLowerCase();
  return /hero|banner/.test(dataKey) || /hero|banner/.test(dataNode);
};

const parsePaddingToken = (token) => {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  const core = parts.pop() || "";
  const prefix = parts.join(":");
  const m = core.match(/^(p[trblxy]?)-\[([0-9.]+)rem\]$/);
  if (!m) return null;
  const prop = m[1];
  const remValue = Number(m[2]);
  if (!Number.isFinite(remValue)) return null;
  return { token: raw, prefix, prop, remValue };
};

const formatToken = (prefix, prop, remValue) => {
  const core = `${prop}-[${trimZeros(remValue)}rem]`;
  return prefix ? `${prefix}:${core}` : core;
};

const remapSuspiciousPadding = (parsed) => {
  // Likely px->rem copy bug: integer rem between 12 and 64 (e.g. 20rem from 20px intent).
  if (Number.isInteger(parsed.remValue) && parsed.remValue >= 12 && parsed.remValue <= 64) {
    const correctedRem = parsed.remValue / 16;
    return {
      token: formatToken(parsed.prefix, parsed.prop, correctedRem),
      mode: "reinterpret-px-as-rem",
    };
  }
  // Hard safety cap for pathological values.
  if (parsed.remValue > 10) {
    return {
      token: formatToken(parsed.prefix, parsed.prop, 10),
      mode: "cap-rem",
    };
  }
  return null;
};

const apply = ({ html }) => {
  const source = String(html || "");
  if (!source) return { html: source, changes: [], warnings: [], stats: { clamped: 0 } };

  const nodes = parseHtmlNodes(source);
  const patches = [];
  const changes = [];
  const warnings = [];
  let clamped = 0;

  nodes.forEach((node) => {
    if (!node?.attrs) return;
    if (isHeroLike(node)) return;

    const tokens = getClassTokens(node.attrs);
    if (!tokens.length) return;
    const next = [...tokens];
    let changed = false;

    tokens.forEach((token, idx) => {
      const parsed = parsePaddingToken(token);
      if (!parsed) return;
      if (parsed.remValue <= 10) return;
      const remap = remapSuspiciousPadding(parsed);
      if (!remap) return;
      if (remap.token === token) return;
      next[idx] = remap.token;
      changed = true;
      const meta = getNodeMeta(node);
      changes.push({
        contractId: id,
        nodeId: meta.nodeId,
        selector: meta.selector,
        op: "classReplace",
        value: `${token} -> ${remap.token}`,
        reason:
          remap.mode === "reinterpret-px-as-rem"
            ? "Suspicious large rem padding interpreted as px input"
            : "Large non-hero rem padding clamped to stability cap",
      });
      warnings.push(
        `[${id}] ${remap.mode} on ${meta.selector || meta.nodeId || "<node>"}: ${token} -> ${remap.token}`
      );
      clamped += 1;
    });

    if (!changed) return;
    setClassTokens(node.attrs, node.attrOrder, next);
    patches.push(
      createPatch(
        node.openStart,
        node.openEnd,
        buildOpenTag(node.tag, node.attrs, node.attrOrder, node.isSelfClosing)
      )
    );
  });

  return {
    html: applyPatches(source, patches),
    changes,
    warnings,
    stats: { clamped },
  };
};

module.exports = {
  id,
  apply,
};
