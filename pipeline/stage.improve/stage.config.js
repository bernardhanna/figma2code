module.exports = {
  id: "improve",
  name: "Improve",
  inputArtifact: "artifact.codeit.json",
  outputArtifact: "artifact.improve.json",
  provider: "rules",
  maxOffenders: 25,
  gate: {
    enabled: true,
    maxVisualDelta: 0,
    requireImprovement: true,
  },
};
