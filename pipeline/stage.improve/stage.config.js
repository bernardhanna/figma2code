module.exports = {
  id: "improve",
  name: "Improve",
  inputArtifact: "artifact.codeit.json",
  outputArtifact: "artifact.improve.json",
  /** Canonical agent prompt / stage spec: pipeline/stage.improve/PROMPT.md */
  promptFile: "PROMPT.md",
  provider: "rules",
  requireVisualDiff: true,
  maxOffenders: 25,
  maxProposedTrialsPerNode: 2,
  maxRejectedTrialsPerNode: 2,
  maxTotalTrialsPerRun: 24,
  nodeStrategyCooldownLookbackEntries: 3,
  gate: {
    enabled: true,
    maxVisualDelta: 0,
    requireImprovement: true,
  },
};
