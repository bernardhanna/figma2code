const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const getArtifactPath = (slug) =>
  path.join(repoRoot, "fixtures.out", slug, "artifact.improve.json");

const getInputArtifactPath = (slug) =>
  path.join(repoRoot, "fixtures.out", slug, "artifact.codeit.json");

const getHistoryDir = (slug) => path.join(repoRoot, "fixtures.out", slug, "history");

const getHistoryPath = (slug, iteration) => {
  const safeIteration = Number(iteration) || 0;
  const suffix = String(safeIteration).padStart(3, "0");
  return path.join(getHistoryDir(slug), `improve-${suffix}.json`);
};

const ensureOutDir = (slug) => {
  const outDir = path.dirname(getArtifactPath(slug));
  fs.mkdirSync(outDir, { recursive: true });
};

const ensureHistoryDir = (slug) => {
  fs.mkdirSync(getHistoryDir(slug), { recursive: true });
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

const writeHistorySnapshot = (slug, iteration, snapshot) => {
  ensureHistoryDir(slug);
  fs.writeFileSync(getHistoryPath(slug, iteration), JSON.stringify(snapshot, null, 2));
};

module.exports = {
  getArtifactPath,
  getInputArtifactPath,
  getHistoryPath,
  readInputArtifact,
  writeArtifact,
  writeHistorySnapshot,
};
