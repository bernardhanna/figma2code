const {
  PIPELINE_ARTIFACT_SCHEMA_VERSION,
  PipelineArtifactSchemaV1,
} = require("./schema");

const REQUIRED_FIELDS = PipelineArtifactSchemaV1.required;

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validateArtifact = (artifact) => {
  const errors = [];

  if (!isPlainObject(artifact)) {
    return { valid: false, errors: ["Artifact must be an object."] };
  }

  REQUIRED_FIELDS.forEach((field) => {
    if (!(field in artifact)) {
      errors.push(`Missing required field: ${field}`);
    }
  });

  if (artifact.schemaVersion !== PIPELINE_ARTIFACT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${PIPELINE_ARTIFACT_SCHEMA_VERSION}.`
    );
  }

  if (typeof artifact.slug !== "string") {
    errors.push("slug must be a string.");
  }

  if (typeof artifact.stage !== "string") {
    errors.push("stage must be a string.");
  }

  if (typeof artifact.createdAt !== "string") {
    errors.push("createdAt must be a string.");
  }

  if (typeof artifact.html !== "string") {
    errors.push("html must be a string.");
  }

  if (!Array.isArray(artifact.patches)) {
    errors.push("patches must be an array.");
  }

  if (!isPlainObject(artifact.assets)) {
    errors.push("assets must be an object.");
  }

  if (!isPlainObject(artifact.diagnostics)) {
    errors.push("diagnostics must be an object.");
  }

  if (!isPlainObject(artifact.metrics)) {
    errors.push("metrics must be an object.");
  }

  if ("nodeIndex" in artifact && !isPlainObject(artifact.nodeIndex)) {
    errors.push("nodeIndex must be an object when provided.");
  }

  return { valid: errors.length === 0, errors };
};

const assertValidArtifact = (artifact) => {
  const result = validateArtifact(artifact);

  if (!result.valid) {
    const error = new Error(
      `Invalid PipelineArtifact: ${result.errors.join(" ")}`
    );
    error.validationErrors = result.errors;
    throw error;
  }

  return artifact;
};

module.exports = {
  PIPELINE_ARTIFACT_SCHEMA_VERSION,
  validateArtifact,
  assertValidArtifact,
};
