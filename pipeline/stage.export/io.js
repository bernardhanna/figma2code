const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const getInputArtifactPath = (slug) =>
  path.join(repoRoot, "fixtures.out", slug, "artifact.improve.json");

const readInputArtifact = (slug) => {
  const inputPath = getInputArtifactPath(slug);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input artifact: ${inputPath}`);
  }

  return JSON.parse(fs.readFileSync(inputPath, "utf8"));
};

module.exports = {
  getInputArtifactPath,
  readInputArtifact,
};
