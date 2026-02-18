const path = require("path");

const STAGE_ORDER = ["generate", "codeit", "improve", "export"];

const STAGE_MODULES = {
  generate: "../stage.generate",
  codeit: "../stage.codeit",
  improve: "../stage.improve",
  export: "../stage.export",
};

const loadStageModule = (stage) => {
  const modulePath = STAGE_MODULES[stage];
  if (!modulePath) {
    throw new Error(`Unknown stage: ${stage}`);
  }

  return require(path.join(__dirname, modulePath));
};

const runStage = async ({ slug, stage, log, ...rest }) => {
  if (!slug) {
    throw new Error("slug is required.");
  }

  const stageModule = loadStageModule(stage);

  if (!stageModule || typeof stageModule.run !== "function") {
    throw new Error(`Stage ${stage} is missing a run() implementation.`);
  }

  const logFn = typeof log === "function" ? log : (line) => console.log(line);
  return await stageModule.run({ slug, log: logFn, ...rest });
};

module.exports = {
  runStage,
  STAGE_ORDER,
};
