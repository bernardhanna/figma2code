// generator/styleFingerprint/constants.js

export const STYLE_FP_THRESHOLDS = {
  // Geometry
  PILL_TOLERANCE_PX: 2,
  BUTTON_MIN_HEIGHT_PX: 32,
  TEXT_LINK_MAX_HEIGHT_PX: 56,

  // Padding
  TEXT_LINK_MAX_PAD_X: 12,
  TEXT_LINK_MAX_PAD_Y: 8,
  BUTTON_MIN_PAD_X: 12,
  BUTTON_MIN_PAD_Y: 8,

  // Ratios
  LOW_PADDING_RATIO: 0.2,
  HIGH_PADDING_RATIO: 0.2,

  // Background
  BG_VISIBLE_ALPHA_MIN: 0.2,
  BG_NEAR_TRANSPARENT_MAX: 0.05,

  // Classifier thresholds
  TEXT_LINK_MIN_SCORE: 0.72,
  BUTTON_MIN_SCORE: 0.72,
  MIN_SCORE_DELTA: 0.12,
};
