// generator/styleFingerprint/classifyInteractiveStyle.js
import { computeStyleFingerprint } from "./fingerprint.js";
import { STYLE_FP_THRESHOLDS as T } from "./constants.js";

function boolScore(ok, pts) {
  return ok ? pts : 0;
}

export function classifyInteractiveStyle(node) {
  const fp = computeStyleFingerprint(node);
  if (!fp) {
    return { style: "unknown", confidence: 0, reason: "no-fingerprint", fingerprint: null };
  }

  const hasText = !!fp.childComposition.hasText;
  const compLooksInteractive = fp.childComposition.isTextOnly || fp.childComposition.isTextPlusIcon;
  const compactComposition = fp.childComposition.childCount <= 2;
  const likelyInteractiveComposition = compLooksInteractive && compactComposition;
  const smallLinkLikePadding =
    (fp.paddingX <= T.TEXT_LINK_MAX_PAD_X && fp.paddingY <= T.TEXT_LINK_MAX_PAD_Y) ||
    fp.size.paddingRatio < T.LOW_PADDING_RATIO;
  const buttonLikePadding =
    (fp.paddingX >= T.BUTTON_MIN_PAD_X && fp.paddingY >= T.BUTTON_MIN_PAD_Y) ||
    fp.size.paddingRatio >= T.HIGH_PADDING_RATIO;
  const linkTypoSignal =
    fp.typography.textDecoration === "underline" || typeof fp.typography.textColor === "string";

  const textLinkScoreRaw =
    boolScore(hasText, 1.4) +
    boolScore(!fp.hasBackgroundFill || fp.bgOpacity < T.BG_NEAR_TRANSPARENT_MAX, 1.6) +
    boolScore(smallLinkLikePadding, 1.2) +
    boolScore(!fp.isPillRadius, 1.0) +
    boolScore(linkTypoSignal, 0.9) +
    boolScore(likelyInteractiveComposition, 1.0) +
    boolScore(fp.size.h < T.TEXT_LINK_MAX_HEIGHT_PX, 0.9);

  const buttonScoreRaw =
    boolScore(fp.hasBackgroundFill && fp.bgOpacity >= T.BG_VISIBLE_ALPHA_MIN, 1.8) +
    boolScore(buttonLikePadding, 1.2) +
    boolScore(fp.isPillRadius || !!fp.cornerRadius, 1.2) +
    boolScore(likelyInteractiveComposition, 0.8) +
    boolScore(fp.size.h >= T.BUTTON_MIN_HEIGHT_PX, 1.0);

  const textLinkScore = Math.max(0, Math.min(1, textLinkScoreRaw / 8));
  const buttonScore = Math.max(0, Math.min(1, buttonScoreRaw / 6));

  const delta = Math.abs(textLinkScore - buttonScore);
  const reasons = [
    `scores(text_link=${textLinkScore.toFixed(2)},button=${buttonScore.toFixed(2)})`,
    `bg=${fp.hasBackgroundFill ? fp.backgroundFillType : "none"}@${fp.bgOpacity.toFixed(2)}`,
    `pad=(${fp.paddingX.toFixed(1)},${fp.paddingY.toFixed(1)})`,
    `pill=${fp.isPillRadius ? "1" : "0"}`,
    `comp=${fp.childComposition.isTextPlusIcon ? "text+icon" : fp.childComposition.isTextOnly ? "text" : "other"}`,
    `h=${fp.size.h}`,
  ];

  if (
    textLinkScore >= T.TEXT_LINK_MIN_SCORE &&
    textLinkScore > buttonScore &&
    delta >= T.MIN_SCORE_DELTA
  ) {
    return {
      style: "text_link",
      confidence: textLinkScore,
      reason: reasons.join(";"),
      fingerprint: fp,
    };
  }

  if (
    buttonScore >= T.BUTTON_MIN_SCORE &&
    buttonScore > textLinkScore &&
    delta >= T.MIN_SCORE_DELTA
  ) {
    return {
      style: "button",
      confidence: buttonScore,
      reason: reasons.join(";"),
      fingerprint: fp,
    };
  }

  return {
    style: "unknown",
    confidence: Math.max(textLinkScore, buttonScore),
    reason: `${reasons.join(";")};ambiguous`,
    fingerprint: fp,
  };
}
