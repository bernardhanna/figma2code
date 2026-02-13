"use strict";

/**
 * Canonical step labels for pipeline stages.
 * Used by progress reporter and UI so checklist matches log lines.
 */

const CODEIT = {
  LOAD_ARTIFACT: "Loading artifact.generate.json…",
  PREPARE_RUNNER: "Preparing contract runner…",
  CONTRACT_PREFIX: "Contract:",
  VALIDATION: "Running validation (post-clean)…",
  EVALUATE: "Running Evaluate (regression gate)…",
  WRITE_ARTIFACT: "Writing artifact.codeit.json…",
  DONE: "Done.",
};

const IMPROVE = {
  LOAD_ARTIFACT: "Loading artifact.codeit.json…",
  EVALUATE_OFFENDERS: "Running Evaluate (find offenders)…",
  SELECT_OFFENDERS: "Selecting top offenders (N=25)…",
  GENERATE_PLAN: "Generating patch plan…",
  VALIDATE_PLAN: "Validating patch plan (bounded ops only)…",
  APPLY_PATCHES: "Applying patches…",
  EVALUATE_VERIFY: "Running Evaluate (verify improvement)…",
  ACCEPT_GATE: "Accepting patches (score gate)…",
  WRITE_ARTIFACT: "Writing artifact.improve.json…",
  DONE: "Done.",
};

/** Build "Contract: <id>…" label for codeit. */
function codeitContractStep(contractId) {
  const id = String(contractId || "").trim();
  return id ? `Contract: ${id}…` : null;
}

/** Build "Selecting top offenders (N=<n>)…" for improve. Use IMPROVE.SELECT_OFFENDERS when n=25 for UI match. */
function improveSelectingStep(n) {
  const num = Number(n);
  return Number.isFinite(num) ? `Selecting top offenders (N=${num})…` : IMPROVE.SELECT_OFFENDERS;
}

module.exports = {
  CODEIT,
  IMPROVE,
  codeitContractStep,
  improveSelectingStep,
};
