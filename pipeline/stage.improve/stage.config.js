module.exports = {
  id: "improve",
  name: "Improve",
  inputArtifact: "artifact.codeit.json",
  outputArtifact: "artifact.improve.json",
  /** Canonical agent prompt / stage spec: pipeline/stage.improve/PROMPT.md */
  promptFile: "PROMPT.md",
  provider: "rules",
  maxOffenders: 25,
  gate: {
    enabled: true,
    maxVisualDelta: 0,
    requireImprovement: true,
  },
};
