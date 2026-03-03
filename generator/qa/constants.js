// generator/qa/constants.js — Breakpoints and config for Visual QA

export const BREAKPOINTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 900 },
  mobile: { width: 390, height: 900 },
};

export const DEFAULT_THRESHOLD = 0.1;
export const DEFAULT_PASS_DIFF_RATIO = 0.02;
export const DEFAULT_MAX_ITERATIONS = 8;
export const DEFAULT_PATCH_BUDGET = 20;
export const SCREENSHOT_SELECTOR = "#cmp_root";
export const SCREENSHOT_MIN_HEIGHT = 50;
export const SCREENSHOT_WAIT_MS = 200;
