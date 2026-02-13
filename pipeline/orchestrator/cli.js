const { runStage, STAGE_ORDER } = require("./runStage");

const printUsage = () => {
  console.log(
    "Usage: node pipeline/orchestrator/cli.js --slug <slug> --stage generate|codeit|improve|export|all"
  );
};

const parseArgs = (argv) => {
  const options = { slug: null, stage: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--slug") {
      options.slug = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--stage") {
      options.stage = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || !options.slug || !options.stage) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  if (options.stage === "all") {
    for (const stage of STAGE_ORDER) {
      await runStage({ slug: options.slug, stage });
      console.log(`Stage complete: ${stage}`);
    }
    return;
  }

  if (!STAGE_ORDER.includes(options.stage)) {
    console.error(`Unknown stage: ${options.stage}`);
    printUsage();
    process.exit(1);
  }

  await runStage({ slug: options.slug, stage: options.stage });
  console.log(`Stage complete: ${options.stage}`);
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
