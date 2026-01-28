// generator/server/previewResponse.js

export function buildPreviewResponse({
  previewUrl,
  screenshotUrl,
  screenshotUrls,
  report,
  contractsSummary,
  paths,
  result,
}) {
  return {
    ok: true,
    previewUrl: previewUrl || null,
    screenshotUrl: screenshotUrl || null,
    screenshotUrls: screenshotUrls || null,
    report: report || { warnings: [], errors: [], fixes: [] },
    contractsSummary: contractsSummary || null,
    paths: paths || null,
    phase2Report: result?.phase2Report || null,
    phase2Reports: result?.phase2Reports || null,
    phase2NormalizedPath: result?.phase2NormalizedPath || null,
    phase3IntentPath: result?.phase3IntentPath || null,
    rasterCtaOffenders: result?.rasterCtaOffenders || null,
    phase3: result?.phase3 || null,
    responsive: result?.responsive || null,
  };
}
