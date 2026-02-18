// generator/qa/index.js — Visual QA + Auto-Fix loop entry

export { runVisualQALoop } from "./loop.js";
export { renderAtBreakpoints } from "./render.js";
export { computeDiffAtBreakpoint, resolveDesignRefPath } from "./diff.js";
export { clusterOffendersFromLayout } from "./cluster.js";
export { captureRectsAtBreakpoint, captureRectsAllBreakpoints } from "./rects.js";
export { expectedRectsFromAst, writeExpectedRects } from "./expected.js";
export { diagnose, ISSUE_TYPES } from "./diagnose.js";
export {
  createPatch,
  resolveToNodeId,
  mergePatchIntoMap,
  applyPatchesToMap,
  mergePatchesMap,
  readPatchesFile,
  writePatchesFile,
  rollbackPatchesFile,
} from "./patch.js";
export {
  validatePatchSchema,
  validateClassOnly,
  validatePatchKeyCount,
  buildAllowedKeys,
  selectFixWithAI,
} from "./aiTieBreaker.js";
export { shouldRollbackRegression } from "./loop.js";
export * from "./constants.js";
