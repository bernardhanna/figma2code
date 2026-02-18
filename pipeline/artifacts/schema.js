const PIPELINE_ARTIFACT_SCHEMA_VERSION = "1.0";

const PipelineArtifactSchemaV1 = {
  $id: "PipelineArtifactV1",
  type: "object",
  required: [
    "schemaVersion",
    "slug",
    "stage",
    "createdAt",
    "html",
    "patches",
    "assets",
    "diagnostics",
    "metrics",
  ],
  properties: {
    schemaVersion: { type: "string", const: PIPELINE_ARTIFACT_SCHEMA_VERSION },
    slug: { type: "string" },
    stage: { type: "string" },
    createdAt: { type: "string" },
    html: { type: "string" },
    patches: { type: "array" },
    assets: { type: "object" },
    diagnostics: { type: "object" },
    metrics: { type: "object" },
    nodeIndex: { type: "object" },
  },
  additionalProperties: true,
};

module.exports = {
  PIPELINE_ARTIFACT_SCHEMA_VERSION,
  PipelineArtifactSchemaV1,
};
