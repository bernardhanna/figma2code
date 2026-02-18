const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const getArtifactPath = (slug) =>
  path.join(repoRoot, "fixtures.out", slug, "artifact.codeit.json");

const getInputArtifactPath = (slug) =>
  path.join(repoRoot, "fixtures.out", slug, "artifact.generate.json");

const ensureOutDir = (slug) => {
  const outDir = path.dirname(getArtifactPath(slug));
  fs.mkdirSync(outDir, { recursive: true });
};

const readInputArtifact = (slug) => {
  const inputPath = getInputArtifactPath(slug);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input artifact: ${inputPath}`);
  }

  return JSON.parse(fs.readFileSync(inputPath, "utf8"));
};

const writeArtifact = (slug, artifact) => {
  ensureOutDir(slug);
  fs.writeFileSync(getArtifactPath(slug), JSON.stringify(artifact, null, 2));
};

module.exports = {
  getArtifactPath,
  getInputArtifactPath,
  readInputArtifact,
  writeArtifact,
};
