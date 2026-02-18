// generator/server/routesVisualDiffAndAutofix.js

import fs from "node:fs";
import path from "node:path";

import { VDIFF_DIR } from "./runtimePaths.js";
import { readStage, writeStage } from "./stageStore.js";

import { loadCompareDeps } from "./visualDiffDeps.js";
import { stableElementScreenshot, absUrl } from "./visualDiffScreenshot.js";
import { captureLayoutJson } from "./visualDiffLayoutCapture.js";
import { readRules, findClassReplaceRule } from "./learnedRulesStore.js";
import { ensurePatchesFile } from "./patchesStore.js";
import { getConfig, getAiClient } from "../config/env.js";
import { runBuildAndPreview } from "./buildOrchestrator.js";
import {
  mergePatchMaps,
  patchesFilePath,
  readPatchMap,
  writePatchMap,
  proposeRefinePatchMap,
} from "../ai/refineByDiff.js";
import { runVisualOptimizer, isRealVisualDiff } from "../ai/visualOptimizer.js";
import {
  parseAiRecodeJsonStrict,
  summarizeLayoutForPrompt,
  validateAiRecodeCandidate,
  shouldAcceptAiRecode,
} from "../ai/aiRecode.js";
import {
  applyStructureEdits,
  buildSubtreeTreeView,
  extractSubtreeHtmlByNodeId,
} from "../ai/structureRepair.js";
import { evaluateImprovement } from "./refineGate.js";
import { buildSseEvent } from "./sse.js";
import {
  classifyFailure,
  computeLayoutDiff,
  estimateWrongLayoutModel,
  findBestAlignment,
} from "./compareMetrics.js";

import { computeElementDiff } from "../auto/elementDiff.js";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function baseSlugFrom(slug) {
  const s = String(slug || "").trim();
  if (!s) return "";
  return s.replace(/(_|-|@)(desktop|tablet|mobile)$/i, "").trim();
}

function hasAnyFigmaInDir(dir) {
  if (!fs.existsSync(dir)) return false;
  const candidates = [
    "figma.png",
    "figma.desktop.png",
    "figma.mobile.png",
    "figma.tablet.png",
  ];
  return candidates.some((f) => fs.existsSync(path.join(dir, f)));
}

function resolveOutDirForCompare(slugRaw) {
  const base = baseSlugFrom(slugRaw);
  const dirRaw = path.join(VDIFF_DIR, slugRaw);
  const dirBase = base ? path.join(VDIFF_DIR, base) : dirRaw;

  // Prefer base dir if it contains the new overlay convention or any figma assets
  if (base && hasAnyFigmaInDir(dirBase)) return { outDir: dirBase, publicSlug: base };
  return { outDir: dirRaw, publicSlug: slugRaw };
}

function viewportPresets(figmaW, figmaH, tabletMax = 1024) {
  const desktopW = Math.max(1, Math.round(figmaW || 1440));
  const desktopH = Math.max(1, Math.round(figmaH || 900));

  const baseH = Math.max(desktopH + 140, 900);

  return [
    { key: "mobile", viewport: { width: Math.min(768, desktopW), height: baseH } },
    { key: "tablet", viewport: { width: Math.min(tabletMax, desktopW), height: baseH } },
    { key: "desktop", viewport: { width: desktopW, height: baseH } },
  ];
}

function resolveLocalFigmaPath(outDir, mode) {
  const m = String(mode || "").trim().toLowerCase();
  const modePath = path.join(outDir, `figma.${m}.png`);
  if (fs.existsSync(modePath)) return modePath;

  const legacy = path.join(outDir, "figma.png");
  if (fs.existsSync(legacy)) return legacy;

  const desktop = path.join(outDir, "figma.desktop.png");
  if (fs.existsSync(desktop)) return desktop;

  const mobile = path.join(outDir, "figma.mobile.png");
  if (fs.existsSync(mobile)) return mobile;

  return "";
}

function readJsonIfExists(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function scorePathForBucket(outDir, bucket) {
  const b = String(bucket || "").toLowerCase();
  if (b === "desktop") return path.join(outDir, "score.desktop.json");
  if (b === "tablet") return path.join(outDir, "score.tablet.json");
  if (b === "mobile") return path.join(outDir, "score.mobile.json");
  return path.join(outDir, "score.json");
}

function diffPathForBucket(outDir, bucket) {
  const b = String(bucket || "").toLowerCase();
  if (b === "desktop") return path.join(outDir, "diff.desktop.png");
  if (b === "tablet") return path.join(outDir, "diff.tablet.png");
  if (b === "mobile") return path.join(outDir, "diff.mobile.png");
  return path.join(outDir, "diff.png");
}

function layoutScoreFromArtifacts(outDir) {
  const candidates = [
    path.join(outDir, "artifact.improve.json"),
    path.join(outDir, "artifact.codeit.json"),
    path.join(outDir, "artifact.generate.json"),
  ];
  for (const file of candidates) {
    const parsed = readJsonIfExists(file, null);
    if (!parsed) continue;
    const bp =
      parsed?.metrics?.breakpoints?.desktop?.layout ||
      parsed?.metrics?.breakpoints?.mobile?.layout ||
      parsed?.metrics?.breakpoints?.tablet?.layout ||
      null;
    if (bp) {
      return {
        conflictingWidthCount: Number(bp?.conflictingWidthCount || 0),
      };
    }
  }
  return { conflictingWidthCount: 0 };
}

function bestArtifactStage(outDir) {
  const order = ["improve", "codeit", "generate"];
  for (const stage of order) {
    const file = path.join(outDir, `artifact.${stage}.json`);
    const artifact = readJsonIfExists(file, null);
    if (artifact && typeof artifact?.html === "string") {
      return { stage, file, artifact };
    }
  }
  return null;
}

function formatAiProviderError(error, cfg) {
  const msg = String(error?.message || error || "").trim() || "Unknown AI error.";
  const provider = String(cfg?.provider || "unknown");
  const model =
    provider === "openai"
      ? String(cfg?.openai?.model || "")
      : provider === "gemini"
        ? String(cfg?.gemini?.model || "")
        : "";
  if (/connection error/i.test(msg) || /network/i.test(msg) || /fetch failed/i.test(msg)) {
    return `AI provider connection failed (${provider}${model ? `:${model}` : ""}). Check internet/VPN/proxy and API endpoint reachability. Raw: ${msg}`;
  }
  if (/unauthorized|invalid api key|auth/i.test(msg)) {
    return `AI provider auth failed (${provider}${model ? `:${model}` : ""}). Check API key and provider selection. Raw: ${msg}`;
  }
  if (/rate limit|quota|429/i.test(msg)) {
    return `AI provider rate limit/quota issue (${provider}${model ? `:${model}` : ""}). Raw: ${msg}`;
  }
  return `AI provider error (${provider}${model ? `:${model}` : ""}): ${msg}`;
}

const refineJobs = new Map();
const REFINE_JOB_TTL_MS = 10 * 60 * 1000;
const refineJobStreams = new Map();

function createRefineJob({ slug, mode }) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const job = {
    jobId: id,
    slug,
    mode,
    status: "running",
    iter: 0,
    message: "queued",
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  };
  refineJobs.set(id, job);
  return job;
}

function getLatestIterationMetrics(result) {
  const iterations = Array.isArray(result?.iterations) ? result.iterations : [];
  const latest = iterations.length ? iterations[iterations.length - 1] : null;
  if (!latest) return null;
  const bucket =
    String(result?.bucket || "") ||
    String(Object.keys(latest?.after || {})[0] || Object.keys(latest?.before || {})[0] || "");
  const beforeObj = (bucket && latest?.before && latest.before[bucket]) || latest?.scoreBefore || {};
  const afterObj = (bucket && latest?.after && latest.after[bucket]) || latest?.scoreAfter || {};
  return {
    iter: Number(latest?.iteration || latest?.iter || 0),
    bucket: bucket || "desktop",
    provider: String(result?.provider || latest?.provider || ""),
    diffRatioBefore: Number(beforeObj?.diffRatio || 0),
    diffRatioAfter: Number(afterObj?.diffRatio || 0),
    layoutDiffRatioBefore: Number(beforeObj?.layoutDiffRatio ?? beforeObj?.diffRatio ?? 0),
    layoutDiffRatioAfter: Number(afterObj?.layoutDiffRatio ?? afterObj?.diffRatio ?? 0),
    bestDx: Number(afterObj?.bestDx ?? beforeObj?.bestDx ?? 0),
    bestDy: Number(afterObj?.bestDy ?? beforeObj?.bestDy ?? 0),
    failureMode: String(afterObj?.failureMode || beforeObj?.failureMode || latest?.failureMode || "none"),
    activeMetric: String(latest?.activeMetric || latest?.metricUsed || "diffRatio"),
    accepted: latest?.accepted === true || latest?.pass === true,
    candidateType: String(latest?.candidateType || ""),
    changedNodeIds: Array.isArray(latest?.changedNodeIds) ? latest.changedNodeIds : [],
  };
}

function emitRefineStream(jobId, eventName, payload) {
  const set = refineJobStreams.get(String(jobId || ""));
  if (!set || !set.size) return;
  const body = buildSseEvent(eventName, payload);
  for (const res of set) {
    try {
      res.write(body);
    } catch {
      // Ignore broken stream writes.
    }
  }
}

function getRefineJob(id) {
  const job = refineJobs.get(String(id || ""));
  if (!job) return null;
  if (Date.now() - Number(job.updatedAt || job.createdAt || 0) > REFINE_JOB_TTL_MS) {
    refineJobs.delete(String(id || ""));
    const streams = refineJobStreams.get(String(id || ""));
    if (streams) {
      for (const res of streams) {
        try { res.end(); } catch {}
      }
    }
    refineJobStreams.delete(String(id || ""));
    return null;
  }
  return job;
}

function updateRefineJob(id, patch = {}) {
  const job = getRefineJob(id);
  if (!job) return null;
  const prevIter = Number(job.iter || 0);
  const prevStatus = String(job.status || "");
  Object.assign(job, patch);
  job.updatedAt = Date.now();
  refineJobs.set(id, job);
  const nextStatus = String(job.status || "");
  const result = job.result || {};
  const metrics = getLatestIterationMetrics(result);
  const nextIter = Number(job.iter || metrics?.iter || 0);
  if (nextIter > prevIter || (nextStatus === "running" && metrics && nextIter > 0 && prevStatus !== "running")) {
    emitRefineStream(id, "iter", {
      iter: nextIter,
      bucket: String(metrics?.bucket || result?.bucket || ""),
      provider: String(metrics?.provider || result?.provider || ""),
      diffRatioBefore: Number(metrics?.diffRatioBefore || 0),
      diffRatioAfter: Number(metrics?.diffRatioAfter || 0),
      layoutDiffRatioBefore: Number(metrics?.layoutDiffRatioBefore || 0),
      layoutDiffRatioAfter: Number(metrics?.layoutDiffRatioAfter || 0),
      bestDx: Number(metrics?.bestDx || 0),
      bestDy: Number(metrics?.bestDy || 0),
      failureMode: String(metrics?.failureMode || "none"),
      activeMetric: String(metrics?.activeMetric || "diffRatio"),
      accepted: Boolean(metrics?.accepted),
      candidateType: String(metrics?.candidateType || ""),
      changedNodeIds: Array.isArray(metrics?.changedNodeIds) ? metrics.changedNodeIds : [],
      message: String(job.message || ""),
    });
  }
  if (nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled") {
    emitRefineStream(id, "done", {
      ok: nextStatus === "done",
      status: nextStatus,
      error: job.error || null,
      final: result || null,
    });
    const streams = refineJobStreams.get(String(id || ""));
    if (streams) {
      for (const res of streams) {
        try { res.end(); } catch {}
      }
    }
    refineJobStreams.delete(String(id || ""));
  }
  return job;
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function resolveBucketViewport(bucket, scores = {}) {
  const b = String(bucket || "desktop").toLowerCase();
  const score = scores?.[b];
  const w = Number(score?.viewport?.width || 0);
  const h = Number(score?.viewport?.height || 0);
  if (w > 0 && h > 0) return { width: w, height: h };
  if (b === "mobile") return { width: 390, height: 900 };
  if (b === "tablet") return { width: 1084, height: 900 };
  return { width: 1440, height: 900 };
}

function chooseTargetRootFromHotZones(offenders, layout) {
  const rows = Array.isArray(offenders) ? offenders : [];
  const layoutArr = Array.isArray(layout) ? layout : [];
  if (!rows.length) return "";
  const byId = new Map(layoutArr.map((r) => [String(r?.nodeId || ""), r]));
  const top = rows[0];
  const topId = String(top?.nodeId || "").trim();
  if (!topId) return "";
  const topBox = byId.get(topId)?.bbox || null;
  if (!topBox) return topId;

  // Approximate 1-3 hot zones by bbox containment and weighted offender pixels.
  const zoneCandidates = [];
  for (const row of rows.slice(0, 12)) {
    const id = String(row?.nodeId || "").trim();
    const box = byId.get(id)?.bbox;
    if (!id || !box) continue;
    let covered = 0;
    for (const o of rows.slice(0, 20)) {
      const ob = byId.get(String(o?.nodeId || ""))?.bbox;
      if (!ob) continue;
      const inside =
        ob.x >= box.x &&
        ob.y >= box.y &&
        ob.x + ob.w <= box.x + box.w &&
        ob.y + ob.h <= box.y + box.h;
      if (inside) covered += Number(o?.pixels || 0);
    }
    zoneCandidates.push({ id, covered });
  }
  zoneCandidates.sort((a, b) => b.covered - a.covered);
  return zoneCandidates[0]?.id || topId;
}

function publicFigmaUrl(publicSlug, mode) {
  const base = `/fixtures.out/${encodeURIComponent(publicSlug)}`;
  const m = String(mode || "").trim().toLowerCase();
  return `${base}/figma.${m}.png`;
}

function selfBaseUrl(req, port) {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const reqHost = String((typeof req?.get === "function" ? req.get("host") : "") || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || String(req?.protocol || "http");
  const host = forwardedHost || reqHost;
  if (host) return `${proto}://${host}`;
  return `http://127.0.0.1:${port}`;
}

function internalBaseCandidates(req, port) {
  const primary = selfBaseUrl(req, port);
  const out = [primary, `http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return Array.from(new Set(out.filter(Boolean)));
}

async function fetchJsonInternal(req, port, pathname, init = {}) {
  const candidates = internalBaseCandidates(req, port);
  let lastErr = null;
  for (const base of candidates) {
    const url = `${String(base).replace(/\/$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    try {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({}));
      return { response, data, url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Internal fetch failed for "${pathname}". Tried: ${candidates.join(", ")}. Last error: ${String(lastErr?.message || lastErr || "unknown")}`
  );
}

function clampPassDiffRatio(raw, fallback = 0.01) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // Keep pass gate meaningful for visual fidelity.
  return Math.min(0.03, Math.max(0.01, n));
}

function snapshotCompareArtifacts(outDir, publicSlug, iter, phase, buckets) {
  const safeIter = Math.max(1, Number(iter || 1));
  const safePhase = String(phase || "after").toLowerCase();
  const out = {};
  for (const bRaw of buckets || []) {
    const b = String(bRaw || "").toLowerCase();
    if (!b) continue;
    const renderSrc = path.join(outDir, `render.${b}.png`);
    const diffSrc = path.join(outDir, `diff.${b}.png`);
    const scoreSrc = path.join(outDir, `score.${b}.json`);
    const renderName = `iter-${safeIter}.${safePhase}.${b}.render.png`;
    const diffName = `iter-${safeIter}.${safePhase}.${b}.diff.png`;
    const scoreName = `iter-${safeIter}.${safePhase}.${b}.score.json`;
    const renderDst = path.join(outDir, renderName);
    const diffDst = path.join(outDir, diffName);
    const scoreDst = path.join(outDir, scoreName);
    const figmaModePath = path.join(outDir, `figma.${b}.png`);
    const figmaDesktopPath = path.join(outDir, "figma.desktop.png");
    const figmaLegacyPath = path.join(outDir, "figma.png");
    const figmaPublic = fs.existsSync(figmaModePath)
      ? `/fixtures.out/${encodeURIComponent(publicSlug)}/figma.${b}.png`
      : fs.existsSync(figmaDesktopPath)
        ? `/fixtures.out/${encodeURIComponent(publicSlug)}/figma.desktop.png`
        : fs.existsSync(figmaLegacyPath)
          ? `/fixtures.out/${encodeURIComponent(publicSlug)}/figma.png`
          : "";
    if (fs.existsSync(renderSrc)) fs.copyFileSync(renderSrc, renderDst);
    if (fs.existsSync(diffSrc)) fs.copyFileSync(diffSrc, diffDst);
    if (fs.existsSync(scoreSrc)) fs.copyFileSync(scoreSrc, scoreDst);
    out[b] = {
      figma: figmaPublic,
      render: `/fixtures.out/${encodeURIComponent(publicSlug)}/${renderName}`,
      diff: `/fixtures.out/${encodeURIComponent(publicSlug)}/${diffName}`,
      score: `/fixtures.out/${encodeURIComponent(publicSlug)}/${scoreName}`,
    };
  }
  return out;
}

export function registerVisualDiffAndAutofixRoutes(app, { port }) {
  app.get("/api/refine-status/:jobId", (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });
    const job = getRefineJob(jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
    return res.json({ ok: true, job });
  });

  app.get("/api/refine/stream/:jobId", (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });
    const job = getRefineJob(jobId);
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const set = refineJobStreams.get(jobId) || new Set();
    set.add(res);
    refineJobStreams.set(jobId, set);

    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch {}
    }, 15000);

    const metrics = getLatestIterationMetrics(job.result || {});
    if (metrics?.iter) {
      emitRefineStream(jobId, "iter", {
        iter: Number(metrics.iter || job.iter || 0),
        bucket: String(metrics.bucket || job?.result?.bucket || ""),
        diffRatioBefore: Number(metrics.diffRatioBefore || 0),
        diffRatioAfter: Number(metrics.diffRatioAfter || 0),
        accepted: Boolean(metrics.accepted),
        message: String(job.message || ""),
      });
    }

    if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
      emitRefineStream(jobId, "done", {
        ok: job.status === "done",
        status: job.status,
        error: job.error || null,
        final: job.result || null,
      });
    }

    req.on("close", () => {
      clearInterval(heartbeat);
      const streams = refineJobStreams.get(jobId);
      if (!streams) return;
      streams.delete(res);
      if (!streams.size) refineJobStreams.delete(jobId);
    });
  });

  app.post("/api/refine-stop/:jobId", (req, res) => {
    const jobId = String(req.params.jobId || "").trim();
    if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });
    const job = updateRefineJob(jobId, { cancelRequested: true, message: "stop requested" });
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
    return res.json({ ok: true, jobId, status: "stop-requested" });
  });

  app.post("/api/refine-job/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    const job = createRefineJob({ slug, mode: "layout" });
    const baseUrl = selfBaseUrl(req, port);
    const payload = {
      ...req.body,
      _jobId: job.jobId,
      _jobWorker: true,
    };
    Promise.resolve()
      .then(async () => {
        const { response, data: result } = await fetchJsonInternal(
          req,
          port,
          `/api/refine/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (!response.ok) {
          const softDone = response.status === 409 && result && typeof result === "object";
          if (softDone) {
            updateRefineJob(job.jobId, {
              status: "done",
              result,
              message: String(result?.stoppedReason || "no-improvement"),
            });
            return;
          }
          updateRefineJob(job.jobId, {
            status: "failed",
            error: result?.error || "refine failed",
            result,
            message: "failed",
          });
          return;
        }
        updateRefineJob(job.jobId, {
          status: "done",
          result,
          message: "done",
        });
      })
      .catch((e) => {
        const target = `${baseUrl}/api/refine/${encodeURIComponent(slug)}`;
        updateRefineJob(job.jobId, {
          status: "failed",
          error: `Internal refine worker call failed (${target}): ${String(e?.message || e)}`,
          message: "failed",
        });
      });

    return res.json({ ok: true, jobId: job.jobId });
  });

  app.post("/api/refine-structure-job/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    const job = createRefineJob({ slug, mode: "structure" });
    const baseUrl = selfBaseUrl(req, port);
    const payload = {
      ...req.body,
      _jobId: job.jobId,
      _jobWorker: true,
    };
    Promise.resolve()
      .then(async () => {
        const { response, data: result } = await fetchJsonInternal(
          req,
          port,
          `/api/refine-structure/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (!response.ok) {
          const softDone = response.status === 409 && result && typeof result === "object";
          if (softDone) {
            updateRefineJob(job.jobId, {
              status: "done",
              result,
              message: String(result?.stoppedReason || "no-improvement"),
            });
            return;
          }
          updateRefineJob(job.jobId, {
            status: "failed",
            error: result?.error || "refine-structure failed",
            result,
            message: "failed",
          });
          return;
        }
        updateRefineJob(job.jobId, {
          status: "done",
          result,
          message: "done",
        });
      })
      .catch((e) => {
        const target = `${baseUrl}/api/refine-structure/${encodeURIComponent(slug)}`;
        updateRefineJob(job.jobId, {
          status: "failed",
          error: `Internal structure worker call failed (${target}): ${String(e?.message || e)}`,
          message: "failed",
        });
      });

    return res.json({ ok: true, jobId: job.jobId });
  });

  app.post("/api/layout/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const { chromium } = await loadCompareDeps();

      const { outDir } = resolveOutDirForCompare(slug);
      ensureDir(outDir);

      const viewport =
        req.body?.viewport && typeof req.body.viewport === "object" ? req.body.viewport : null;
      const waitMs = typeof req.body?.waitMs === "number" ? req.body.waitMs : 200;

      const layout = await captureLayoutJson({ chromium, slug, port, outDir, viewport, waitMs });
      return res.json({ ok: true, count: layout.length, path: `//${slug}/layout.json` });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/compare/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const staged = readStage(slug);
      if (!staged?.ast) {
        return res.status(404).json({
          ok: false,
          error: `No staged AST for "${slug}". Run preview once so ../.preview/staging/${slug}.json exists.`,
        });
      }

      const { PNG, pixelmatch, chromium } = await loadCompareDeps();

      const serverUrl = selfBaseUrl(req, port);

      // selector/minHeight/waitMs (same as before)
      const shotCfg =
        req.body?.screenshot && typeof req.body.screenshot === "object" ? req.body.screenshot : null;
      const selector = String(shotCfg?.selector || req.body?.selector || req.query?.selector || "#cmp_root");

      const minHeight =
        typeof shotCfg?.minHeight === "number"
          ? shotCfg.minHeight
          : typeof req.body?.minHeight === "number"
            ? req.body.minHeight
            : typeof req.query?.minHeight === "string"
              ? Number(req.query.minHeight)
              : 200;

      const waitMs =
        typeof req.body?.waitMs === "number"
          ? req.body.waitMs
          : typeof req.query?.waitMs === "string"
            ? Number(req.query.waitMs)
            : 200;

      const threshold = typeof req.body?.threshold === "number" ? req.body.threshold : 0.1;
      const includeAA = req.body?.includeAA !== false;
      const passDiffRatio = typeof req.body?.passDiffRatio === "number" ? req.body.passDiffRatio : 0.03;
      const alignWindow = Math.max(0, Math.min(20, Number(req.body?.alignWindow ?? 12) || 12));
      const alignStep = Math.max(1, Math.min(4, Number(req.body?.alignStep ?? 2) || 2));

      const multi = req.body?.multi === true || req.body?.viewports === "all";
      const tabletMax =
        typeof req.body?.tabletMax === "number" && req.body.tabletMax > 0 ? req.body.tabletMax : 1024;

      // IMPORTANT: Use base/group dir for overlays if present
      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      ensureDir(outDir);
      ensurePatchesFile(outDir);

      const elementDiffPath = path.join(outDir, "element-diff.json");

      const renderPath = path.join(outDir, "render.png");
      const diffPath = path.join(outDir, "diff.png");
      const scorePath = path.join(outDir, "score.json");

      // Legacy overlaySrc (optional now)
      const overlaySrc = String(staged?.ast?.meta?.overlay?.src || "").trim();

      // If we have no local figma assets AND no overlay src, we cannot compare.
      const anyLocalFigma = hasAnyFigmaInDir(outDir);
      if (!anyLocalFigma && !overlaySrc) {
        return res.status(400).json({
          ok: false,
          error:
            `Missing overlay for "${slug}". Provide ast.meta.overlay.src OR write overlays to ` +
            `"${outDir}/figma.desktop.png" (and optionally figma.mobile.png).`,
        });
      }

      // If overlaySrc exists and we don't already have a legacy figma.png, materialize it to figma.png for caching.
      // If overlaySrc exists, materialize it into the new convention:
      // - figma.desktop.png (primary)
      // - figma.png (legacy/back-compat)
      async function ensureDesktopOverlayDownloadedIfNeeded() {
        const desktopPath = path.join(outDir, "figma.desktop.png");
        const legacyPath = path.join(outDir, "figma.png");

        // If either exists, we are good. Prefer desktop as the canonical file.
        if (fs.existsSync(desktopPath)) return desktopPath;
        if (fs.existsSync(legacyPath)) return legacyPath;

        if (!overlaySrc) return "";

        const figmaUrl = absUrl(serverUrl, overlaySrc);
        const figmaResp = await fetch(figmaUrl);
        if (!figmaResp.ok) {
          throw new Error(`Failed to fetch overlay image: ${figmaUrl} (status ${figmaResp.status})`);
        }

        const buf = Buffer.from(await figmaResp.arrayBuffer());

        // Write both: primary + legacy
        fs.writeFileSync(desktopPath, buf);
        fs.writeFileSync(legacyPath, buf);

        return desktopPath;
      }


      async function loadFigmaPngForMode(mode) {
        const local = resolveLocalFigmaPath(outDir, mode);
        if (local) {
          return {
            path: local,
            src: publicFigmaUrl(publicSlug, mode),
            png: PNG.sync.read(fs.readFileSync(local)),
          };
        }

        // fallback: download legacy overlay if we have overlaySrc
        // fallback: download desktop overlay if we have overlaySrc
        const downloaded = await ensureDesktopOverlayDownloadedIfNeeded();
        if (!downloaded || !fs.existsSync(downloaded)) {
          throw new Error(`No figma overlay file found for mode "${mode}" in ${outDir}`);
        }

        return {
          path: downloaded,
          // Once downloaded, always prefer the public fixtures path (stable for UI links)
          src: publicFigmaUrl(publicSlug, "desktop"),
          png: PNG.sync.read(fs.readFileSync(downloaded)),
        };

      }

      // Single run: choose desktop mode by default
      async function runCompareOne({ key, viewport }) {
        const mode = String(key || "desktop").toLowerCase();
        const figma = await loadFigmaPngForMode(mode);

        // IMPORTANT: force overlay OFF and force viewport width via vpw
        const previewUrl =
          `${serverUrl}/preview/${encodeURIComponent(slug)}` +
          `?ov=0&vpw=${encodeURIComponent(viewport.width)}`;

        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();

          const shot = await stableElementScreenshot(
            page,
            previewUrl,
            selector,
            viewport,
            waitMs,
            minHeight
          );

          const rPath = key ? path.join(outDir, `render.${key}.png`) : renderPath;
          const dPath = key ? path.join(outDir, `diff.${key}.png`) : diffPath;
          const sPath = key ? path.join(outDir, `score.${key}.json`) : scorePath;

          fs.writeFileSync(rPath, shot.buffer);

          const renderPng = PNG.sync.read(fs.readFileSync(rPath));
          const aligned = findBestAlignment(renderPng, figma.png, {
            searchPx: alignWindow,
            searchStep: alignStep,
            searchScale: 0.5,
            threshold,
            includeAA,
            pixelmatch,
          });
          if (aligned?.diffPng) fs.writeFileSync(dPath, PNG.sync.write(aligned.diffPng));
          const totalPixels = Math.max(1, Number(aligned?.compared?.width || 0) * Number(aligned?.compared?.height || 0));
          const diffPixels = Number(aligned?.diffPixels || 0);
          const diffRatio = Number(aligned?.diffRatio ?? (diffPixels / totalPixels));
          const layoutMetric = computeLayoutDiff(renderPng, figma.png, aligned.bestDx, aligned.bestDy, {
            layoutScale: 0.35,
            blurRadius: 0,
            threshold,
            includeAA,
            pixelmatch,
          });
          const layoutScore = layoutScoreFromArtifacts(outDir);
          const failure = classifyFailure({
            bestDx: aligned.bestDx,
            bestDy: aligned.bestDy,
            diffRatio,
            layoutDiffRatio: Number(layoutMetric?.layoutDiffRatio ?? diffRatio),
            layoutScore,
            wrongLayoutModel: false,
          });

          const score = {
            slug: publicSlug, // store public slug (group-aware)
            url: previewUrl,
            viewport,
            screenshot: shot.meta,
            figma: { path: figma.path, width: figma.png.width, height: figma.png.height, src: figma.src, mode },
            render: { path: rPath, width: renderPng.width, height: renderPng.height },
            compared: {
              width: Number(aligned?.compared?.width || 0),
              height: Number(aligned?.compared?.height || 0),
            },
            compare: { threshold, includeAA, passDiffRatio, alignWindow, alignStep },
            alignment: { dx: Number(aligned.bestDx || 0), dy: Number(aligned.bestDy || 0) },
            bestDx: Number(aligned.bestDx || 0),
            bestDy: Number(aligned.bestDy || 0),
            alignmentSearched: true,
            searchRadiusPx: Number(aligned.searchRadiusPx || alignWindow || 16),
            alignmentDownscale: Number(aligned.alignmentDownscale || 0.5),
            alignmentDiffRatio: Number(aligned.alignmentDiffRatio ?? diffRatio),
            diffPixels,
            totalPixels,
            diffRatio,
            layoutDiffPixels: Number(layoutMetric?.layoutDiffPixels || 0),
            layoutDiffRatio: Number(layoutMetric?.layoutDiffRatio ?? diffRatio),
            layoutDownscale: Number(layoutMetric?.layoutDownscale || 0.35),
            layoutBlurRadius: Number(layoutMetric?.layoutBlurRadius || 0),
            layoutScore,
            failureMode: String(failure?.failureMode || "none"),
            failureSignals: failure?.failureSignals || {},
            pass: diffRatio <= passDiffRatio,
            at: new Date().toISOString(),
            mode: key || "single",
          };

          fs.writeFileSync(sPath, JSON.stringify(score, null, 2), "utf8");

          return {
            score,
            scorePath: sPath,
            artifacts: {
              figma: figma.src,
              render: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `render.${key}.png` : "render.png"}`,
              diff: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `diff.${key}.png` : "diff.png"}`,
              score: `/fixtures.out/${encodeURIComponent(publicSlug)}/${key ? `score.${key}.json` : "score.json"}`,
            },
          };
        } finally {
          await browser.close();
        }
      }

      // --- Run ---
      if (!multi) {
        const figmaDesktop = await loadFigmaPngForMode("desktop");

        const viewport =
          req.body?.viewport && typeof req.body.viewport === "object" && Number(req.body.viewport.width) > 0
            ? req.body.viewport
            : {
                width: figmaDesktop.png.width,
                height: Math.max(figmaDesktop.png.height + 140, 900),
              };

        const result = await runCompareOne({ key: null, viewport });

        try {
          const { chromium } = await loadCompareDeps();
          const layout = await captureLayoutJson({
            chromium,
            slug,
            port,
            outDir,
            viewport,
            waitMs: 50,
          });
          computeElementDiff(diffPath, layout, elementDiffPath);
          const offenders = readJsonIfExists(elementDiffPath, []) || [];
          const wrongLayoutModel = estimateWrongLayoutModel({
            offenders,
            layout,
          });
          if (wrongLayoutModel) {
            const scoreFresh = readJsonIfExists(result.scorePath, result.score) || result.score;
            const failure = classifyFailure({
              ...scoreFresh,
              wrongLayoutModel: true,
            });
            scoreFresh.wrongLayoutModel = true;
            scoreFresh.failureMode = String(failure?.failureMode || scoreFresh.failureMode || "none");
            scoreFresh.failureSignals = failure?.failureSignals || scoreFresh.failureSignals || {};
            fs.writeFileSync(result.scorePath, JSON.stringify(scoreFresh, null, 2), "utf8");
            result.score = scoreFresh;
          }
        } catch (e) {
          console.warn("[autofix] element-diff computation failed:", String(e?.message || e));
        }

        return res.json({
          ok: true,
          score: result.score,
          artifacts: {
            ...result.artifacts,
            layout: `/fixtures.out/${encodeURIComponent(publicSlug)}/layout.json`,
            elementDiff: `/fixtures.out/${encodeURIComponent(publicSlug)}/element-diff.json`,
            patches: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
          },
        });
      }

      // multi
      const figmaDesktop = await loadFigmaPngForMode("desktop");
      const presets = viewportPresets(figmaDesktop.png.width, figmaDesktop.png.height, tabletMax);
      const results = {};

      for (const p of presets) {
        results[p.key] = await runCompareOne({ key: p.key, viewport: p.viewport });
      }

      // Back-compat alias => desktop
      if (fs.existsSync(path.join(outDir, "render.desktop.png"))) fs.copyFileSync(path.join(outDir, "render.desktop.png"), renderPath);
      if (fs.existsSync(path.join(outDir, "diff.desktop.png"))) fs.copyFileSync(path.join(outDir, "diff.desktop.png"), diffPath);
      if (fs.existsSync(path.join(outDir, "score.desktop.json"))) fs.copyFileSync(path.join(outDir, "score.desktop.json"), scorePath);

      fs.writeFileSync(
        path.join(outDir, "score.all.json"),
        JSON.stringify({ slug: publicSlug, at: new Date().toISOString(), results }, null, 2),
        "utf8"
      );

      return res.json({
        ok: true,
        slug: publicSlug,
        results,
        artifacts: {
          all: `/fixtures.out/${encodeURIComponent(publicSlug)}/score.all.json`,
          figma: publicFigmaUrl(publicSlug, "desktop"),
          render: `/fixtures.out/${encodeURIComponent(publicSlug)}/render.png`,
          diff: `/fixtures.out/${encodeURIComponent(publicSlug)}/diff.png`,
          score: `/fixtures.out/${encodeURIComponent(publicSlug)}/score.json`,
          patches: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/refine/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
      const baseUrl = selfBaseUrl(req, port);
      const isWorker = Boolean(req.body?._jobWorker);
      if (!isWorker) {
        const job = createRefineJob({ slug, mode: "layout" });
        const payload = {
          ...req.body,
          _jobId: job.jobId,
          _jobWorker: true,
        };
        Promise.resolve()
          .then(async () => {
            const { response, data: result } = await fetchJsonInternal(
              req,
              port,
              `/api/refine/${encodeURIComponent(slug)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }
            );
            if (!response.ok) {
              const softDone = response.status === 409 && result && typeof result === "object";
              if (softDone) {
                updateRefineJob(job.jobId, {
                  status: "done",
                  result,
                  message: String(result?.stoppedReason || "no-improvement"),
                });
                return;
              }
              updateRefineJob(job.jobId, {
                status: "failed",
                error: result?.error || "refine failed",
                result,
                message: "failed",
              });
              return;
            }
            updateRefineJob(job.jobId, {
              status: "done",
              result,
              message: "done",
            });
          })
          .catch((e) => {
            const target = `${baseUrl}/api/refine/${encodeURIComponent(slug)}`;
            updateRefineJob(job.jobId, {
              status: "failed",
              error: `Internal refine worker call failed (${target}): ${String(e?.message || e)}`,
              message: "failed",
            });
          });
        return res.json({ ok: true, jobId: job.jobId });
      }
      const jobId = String(req.body?._jobId || "").trim();
      const job = jobId ? getRefineJob(jobId) : null;
      if (job) updateRefineJob(jobId, { status: "running", message: "starting", iter: 0 });

      const maxIters = Math.max(1, Math.min(8, Number(req.body?.maxIters || 3)));
      const passDiffRatio = clampPassDiffRatio(req.body?.passDiffRatio, 0.02);
      const topOffenders = Math.max(1, Math.min(40, Number(req.body?.topOffenders || 12)));
      const epsilon = Math.max(0, Number(req.body?.epsilon || 0.0005));
      const provider = String(req.body?.provider || "visual-optimizer").trim().toLowerCase();
      const bucketRaw = String(req.body?.bucket || "desktop").trim().toLowerCase();
      const dryRun = Boolean(req.body?.dryRun);
      const targetBuckets =
        bucketRaw === "all" ? ["desktop", "tablet", "mobile"] : [bucketRaw];

      const allowedBuckets = new Set(["desktop", "tablet", "mobile", "all"]);
      if (!allowedBuckets.has(bucketRaw)) {
        return res.status(400).json({ ok: false, error: "Invalid bucket value" });
      }

      // Ensure deterministic build exists and is source-of-truth.
      const build = await runBuildAndPreview({ slug });
      if (!build.ok) {
        return res.status(500).json({
          ok: false,
          error: build.error || "Build failed before refine",
          stage: build.stage,
          reportPath: build.reportPath ?? undefined,
        });
      }

      const { chromium } = await loadCompareDeps();

      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      ensureDir(outDir);
      ensurePatchesFile(outDir);
      const reportPath =
        provider === "visual-optimizer"
          ? path.join(outDir, `visual-opt-report.${bucketRaw}.json`)
          : provider === "ai-recode"
            ? path.join(outDir, `recode-report.${bucketRaw}.json`)
          : path.join(outDir, `refine-report.${bucketRaw}.json`);

      const report = {
        ok: true,
        slug: publicSlug,
        bucket: bucketRaw,
        previewUrl: `/preview/${encodeURIComponent(publicSlug)}`,
        dryRun,
        passDiffRatio,
        maxIters,
        topOffenders,
        iterations: [],
        stoppedReason: "",
      };

      const compareBody = {
        waitMs: 300,
        passDiffRatio,
        screenshot: { mode: "element", selector: "#cmp_root", minHeight: 50 },
        multi: true,
        viewports: "all",
      };

      const compareNow = async () => {
        const { response: compareRes, data: compareJson } = await fetchJsonInternal(
          req,
          port,
          `/api/compare/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(compareBody),
          }
        );
        if (!compareRes.ok || !compareJson?.ok) {
          throw new Error(compareJson?.error || "Compare failed during refine");
        }
        return compareJson;
      };

      if (provider === "visual-optimizer") {
        let iterForJob = 0;
        const streamedIterations = [];
        const readScore = (b) => readJsonIfExists(scorePathForBucket(outDir, b), {}) || {};
        const captureLayoutForBucket = async (b, score) => {
          const viewport =
            score?.viewport && score.viewport.width && score.viewport.height
              ? { width: Number(score.viewport.width), height: Number(score.viewport.height) }
              : { width: b === "mobile" ? 390 : b === "tablet" ? 1084 : 1440, height: 900 };
          const layout = await captureLayoutJson({
            chromium,
            slug,
            port,
            outDir,
            viewport,
            waitMs: 80,
          });
          const layoutPath = path.join(outDir, `layout.${b}.json`);
          fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), "utf8");
          return layout;
        };
        const visualReport = await runVisualOptimizer({
          slug,
          publicSlug,
          outDir,
          bucket: bucketRaw,
          maxIters,
          passDiffRatio,
          topOffenders,
          epsilon,
          dryRun,
          compareFn: compareNow,
          readScoreFn: readScore,
          captureLayoutFn: captureLayoutForBucket,
          snapshotArtifactsFn: (iter, phase, buckets) =>
            snapshotCompareArtifacts(outDir, publicSlug, iter, phase, buckets),
          shouldStop: () => Boolean(job?.cancelRequested),
          onIteration: (it) => {
            if (!job) return;
            streamedIterations.push(it);
            iterForJob += 1;
            updateRefineJob(jobId, {
              status: "running",
              message: `iter ${it?.iteration || iterForJob} scored`,
              iter: iterForJob,
              result: {
                ok: true,
                slug: publicSlug,
                bucket: bucketRaw,
                provider: "visual-optimizer",
                iterations: [...streamedIterations],
              },
            });
          },
        });

        // Hard gate: if compare still placeholder/null, keep result actionable and non-destructive.
        const noVisual = targetBuckets.some((b) => !isRealVisualDiff(readScore(b)));
        if (noVisual) {
          visualReport.ok = false;
          visualReport.error = "no-visual-diff";
          visualReport.warning =
            "Visual optimizer skipped because compare did not produce real pixelDiffRatio values.";
        }

        // Escalate to secondary lane when visual optimization plateaus or remains high.
        if (!dryRun && visualReport.ok !== false && visualReport.escalationSuggestion?.bucket) {
          const escalateBucket = String(visualReport.escalationSuggestion.bucket || "").toLowerCase();
          const lane = String(visualReport.escalationSuggestion?.lane || "ai-recode");
          if (["desktop", "tablet", "mobile"].includes(escalateBucket)) {
            try {
              const escEndpoint =
                lane === "structure-repair"
                  ? `/api/refine-structure/${encodeURIComponent(slug)}`
                  : `/api/refine/${encodeURIComponent(slug)}`;
              const escBody =
                lane === "structure-repair"
                  ? {
                      bucket: escalateBucket,
                      maxIters: 2,
                      topOffenders: Math.max(6, topOffenders),
                      passDiffRatio,
                      _jobWorker: true,
                    }
                  : {
                      provider: "ai-recode",
                      bucket: escalateBucket,
                      maxAttempts: 2,
                      passDiffRatio,
                      _jobWorker: true,
                    };
              const { response: escRes, data: escJson } = await fetchJsonInternal(req, port, escEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(escBody),
              });
              visualReport.escalation = {
                attempted: true,
                lane,
                bucket: escalateBucket,
                ok: escRes.ok && Boolean(escJson?.ok),
                result: escJson,
              };
            } catch (error) {
              visualReport.escalation = {
                attempted: true,
                lane,
                bucket: escalateBucket,
                ok: false,
                error: String(error?.message || error),
              };
            }
          }
        }

        fs.writeFileSync(reportPath, JSON.stringify(visualReport, null, 2), "utf8");
        if (job) {
          updateRefineJob(jobId, {
            status: visualReport.ok ? "done" : "failed",
            message: visualReport.stoppedReason || (visualReport.ok ? "done" : "failed"),
            result: visualReport,
            iter: Math.max(iterForJob, Number(visualReport?.iterations?.length || 0)),
            error: visualReport.ok ? null : String(visualReport.error || "visual-optimizer failed"),
          });
        }
        return res.status(visualReport.ok ? 200 : 409).json(visualReport);
      }

      if (provider === "ai-recode") {
        if (bucketRaw === "all") {
          return res.status(400).json({ ok: false, error: "ai-recode requires a single bucket (desktop|tablet|mobile)" });
        }
        const cfg = getConfig();
        const aiClient = await getAiClient(cfg);
        const epsilon = Math.max(0, Number(req.body?.epsilon || 0.0005));
        const maxAttempts = Math.max(1, Math.min(2, Number(req.body?.maxAttempts || 1)));
        const stageEntry = bestArtifactStage(outDir);
        if (!stageEntry) {
          return res.status(404).json({ ok: false, error: "No artifact html found for ai-recode source." });
        }
        const baselineGuardHtml = String(stageEntry.artifact?.html || "");
        let workingHtml = baselineGuardHtml;
        const promptPath = path.join(outDir, `recode-prompt.${bucketRaw}.json`);
        const rawPath = path.join(outDir, `recode-raw.${bucketRaw}.txt`);
        const recodePath = path.join(outDir, `recode.${bucketRaw}.html`);
        const iterations = [];
        let acceptedAny = false;
        let stoppedReason = "";
        let firstBeforeScore = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (job && job.cancelRequested) {
            stoppedReason = "cancelled";
            break;
          }
          if (job) updateRefineJob(jobId, { status: "running", message: `attempt ${attempt} start`, iter: attempt });
          await compareNow();
          const scoreBefore = readJsonIfExists(scorePathForBucket(outDir, bucketRaw), {}) || {};
          if (!firstBeforeScore) firstBeforeScore = scoreBefore;
          const viewport =
            scoreBefore?.viewport && scoreBefore.viewport.width && scoreBefore.viewport.height
              ? { width: Number(scoreBefore.viewport.width), height: Number(scoreBefore.viewport.height) }
              : { width: bucketRaw === "mobile" ? 390 : bucketRaw === "tablet" ? 1084 : 1440, height: 900 };
          const layout = await captureLayoutJson({
            chromium,
            slug,
            port,
            outDir,
            viewport,
            waitMs: 80,
          });
          const payload = {
            slug: publicSlug,
            bucket: bucketRaw,
            figma: scoreBefore?.figma || {},
            render: scoreBefore?.render || {},
            currentHtml: workingHtml,
            layoutSummary: summarizeLayoutForPrompt(layout),
          };
          fs.writeFileSync(promptPath, JSON.stringify(payload, null, 2), "utf8");
          const system = [
            "Output JSON ONLY, no markdown.",
            "Act as a senior front-end coder rebuilding the section to match Figma visually.",
            "Use Tailwind utility classes only in markup.",
            "Do not include <style>, <script>, inline style, or JS handlers.",
            "Preserve all text content, href URLs, and src URLs exactly.",
            "Return schema: {html, notes, constraintsRespected:{keptText,keptLinks,keptAssetUrls,tailwindOnly}}",
          ].join("\n");
          let aiText = "";
          try {
            const ai = await aiClient.complete({
              system,
              user: JSON.stringify(payload),
              maxOutputTokens: 3500,
              temperature: 0.1,
            });
            aiText = String(ai?.text || "");
          } catch (e) {
            throw new Error(formatAiProviderError(e, cfg));
          }
          fs.appendFileSync(rawPath, `\n\n=== attempt ${attempt} ===\n${aiText}\n`, "utf8");
          const parsed = parseAiRecodeJsonStrict(aiText);
          if (!parsed.ok) {
            iterations.push({
              iteration: attempt,
              bucket: bucketRaw,
              provider: "ai-recode",
              accepted: false,
              reason: parsed.error,
              before: { [bucketRaw]: scoreBefore },
              after: { [bucketRaw]: scoreBefore },
            });
            continue;
          }
          const candidateHtml = String(parsed.value?.html || "").trim();
          const validation = validateAiRecodeCandidate({
            baselineHtml: baselineGuardHtml,
            candidateHtml,
          });
          if (!validation.ok) {
            iterations.push({
              iteration: attempt,
              bucket: bucketRaw,
              provider: "ai-recode",
              accepted: false,
              reason: "constraints-violated",
              rejectReasons: validation.reasons,
              before: { [bucketRaw]: scoreBefore },
              after: { [bucketRaw]: scoreBefore },
            });
            continue;
          }

          fs.writeFileSync(recodePath, candidateHtml, "utf8");
          const previousHtml = String(stageEntry.artifact?.html || "");
          stageEntry.artifact.html = candidateHtml;
          fs.writeFileSync(stageEntry.file, JSON.stringify(stageEntry.artifact, null, 2), "utf8");
          const rebuild = await runBuildAndPreview({ slug });
          if (!rebuild.ok) {
            stageEntry.artifact.html = previousHtml;
            fs.writeFileSync(stageEntry.file, JSON.stringify(stageEntry.artifact, null, 2), "utf8");
            await runBuildAndPreview({ slug });
            iterations.push({
              iteration: attempt,
              bucket: bucketRaw,
              provider: "ai-recode",
              accepted: false,
              reason: `rebuild-failed:${rebuild.stage || rebuild.error || "unknown"}`,
              before: { [bucketRaw]: scoreBefore },
              after: { [bucketRaw]: scoreBefore },
            });
            continue;
          }

          await compareNow();
          const scoreAfter = readJsonIfExists(scorePathForBucket(outDir, bucketRaw), {}) || {};
          const gate = shouldAcceptAiRecode({
            beforeDiff: Number(scoreBefore?.diffRatio ?? 1),
            afterDiff: Number(scoreAfter?.diffRatio ?? 1),
            epsilon,
            meaningfulDelta: 0.001,
          });
          const accepted = Boolean(gate.accept);
          if (!accepted) {
            stageEntry.artifact.html = previousHtml;
            fs.writeFileSync(stageEntry.file, JSON.stringify(stageEntry.artifact, null, 2), "utf8");
            await runBuildAndPreview({ slug });
          } else {
            acceptedAny = true;
            workingHtml = candidateHtml;
          }
          const iterEntry = {
            iteration: attempt,
            bucket: bucketRaw,
            provider: "ai-recode",
            accepted,
            improvedBy: Number(gate.improvedBy || 0),
            reason: gate.reason,
            before: { [bucketRaw]: scoreBefore },
            after: { [bucketRaw]: accepted ? scoreAfter : scoreBefore },
            constraints: validation.checks,
            files: {
              prompt: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode-prompt.${bucketRaw}.json`,
              raw: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode-raw.${bucketRaw}.txt`,
              recode: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode.${bucketRaw}.html`,
            },
          };
          iterations.push(iterEntry);
          if (job) {
            updateRefineJob(jobId, {
              status: "running",
              message: `attempt ${attempt} scored`,
              iter: attempt,
              result: {
                ok: true,
                slug: publicSlug,
                bucket: bucketRaw,
                provider: "ai-recode",
                iterations: [...iterations],
              },
            });
          }
          if (accepted && Number(scoreAfter?.diffRatio ?? 1) <= passDiffRatio) {
            stoppedReason = "pass";
            break;
          }
        }

        await compareNow();
        const finalScore = readJsonIfExists(scorePathForBucket(outDir, bucketRaw), {}) || {};
        if (!stoppedReason) stoppedReason = acceptedAny ? "improved" : "no-improvement";
        const response = {
          ok: acceptedAny,
          slug: publicSlug,
          provider: "ai-recode",
          bucket: bucketRaw,
          previewUrl: `/preview/${encodeURIComponent(publicSlug)}`,
          before: firstBeforeScore || {},
          after: finalScore,
          iterations,
          stoppedReason,
          files: {
            prompt: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode-prompt.${bucketRaw}.json`,
            raw: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode-raw.${bucketRaw}.txt`,
            recode: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode.${bucketRaw}.html`,
            report: `/fixtures.out/${encodeURIComponent(publicSlug)}/recode-report.${bucketRaw}.json`,
          },
        };
        fs.writeFileSync(reportPath, JSON.stringify(response, null, 2), "utf8");
        if (job) {
          updateRefineJob(jobId, {
            status: response.ok ? "done" : "failed",
            message: stoppedReason,
            result: response,
            iter: iterations.length,
            error: response.ok ? null : "ai-recode did not produce an accepted improvement",
          });
        }
        return res.status(response.ok ? 200 : 409).json(response);
      }

      const cfg = getConfig();
      const aiClient = await getAiClient(cfg);

      const IMPROVE_EPSILON = 0.0005;
      let previousMetric = null;
      let lowImproveStreak = 0;
      let rejectStreak = 0;
      for (let iter = 1; iter <= maxIters; iter += 1) {
        if (job && job.cancelRequested) {
          report.stoppedReason = "cancelled";
          updateRefineJob(jobId, { status: "cancelled", message: "cancelled", iter });
          return res.status(409).json({ ...report, ok: false, cancelled: true });
        }
        if (job) updateRefineJob(jobId, { status: "running", message: `iter ${iter} start`, iter });
        const { response: compareRes, data: compareJson } = await fetchJsonInternal(
          req,
          port,
          `/api/compare/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(compareBody),
          }
        );
        if (!compareRes.ok || !compareJson?.ok) {
          return res.status(500).json({
            ok: false,
            error: compareJson?.error || "Compare failed during refine",
            iteration: iter,
          });
        }

        const scores = {};
        const offendersByBucket = {};
        const acceptedByBucket = {};
        const rejectedByBucket = {};
        const patchWrites = [];
        const previousPatchMapsByBucket = {};

        for (const b of targetBuckets) {
          const score = readJsonIfExists(scorePathForBucket(outDir, b), null) || {};
          scores[b] = score;
          const viewport = score?.viewport && score.viewport.width && score.viewport.height
            ? { width: Number(score.viewport.width), height: Number(score.viewport.height) }
            : { width: b === "mobile" ? 390 : b === "tablet" ? 1084 : 1440, height: 900 };

          const layout = await captureLayoutJson({
            chromium,
            slug,
            port,
            outDir,
            viewport,
            waitMs: 80,
          });
          const layoutPath = path.join(outDir, `layout.${b}.json`);
          fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), "utf8");

          const diffPath = diffPathForBucket(outDir, b);
          const elementDiffPath = path.join(outDir, `element-diff.${b}.json`);
          computeElementDiff(diffPath, layout, elementDiffPath);
          const offenders = readJsonIfExists(elementDiffPath, []) || [];
          const byNode = new Map((Array.isArray(layout) ? layout : []).map((el) => [String(el?.nodeId || ""), el]));
          const top = (Array.isArray(offenders) ? offenders : [])
            .slice(0, topOffenders)
            .map((o) => {
              const meta = byNode.get(String(o?.nodeId || "")) || {};
              return {
                nodeId: String(o?.nodeId || ""),
                pixels: Number(o?.pixels || 0),
                ratio: Number(o?.ratio || 0),
                bbox: meta?.bbox || null,
                className: String(meta?.className || ""),
                parentClassName: String(meta?.parentClassName || ""),
              };
            });
          offendersByBucket[b] = top;

          let aiOut;
          try {
            aiOut = await proposeRefinePatchMap({
              aiClient,
              bucket: b,
              offenders: top,
              passDiffRatio,
              currentDiffRatio: Number(score?.diffRatio || 0),
            });
          } catch (e) {
            throw new Error(formatAiProviderError(e, cfg));
          }
          acceptedByBucket[b] = aiOut.accepted || {};
          rejectedByBucket[b] = Array.isArray(aiOut.rejected) ? aiOut.rejected : [];

          if (!dryRun) {
            const patchPath = patchesFilePath(outDir, bucketRaw === "all" ? b : b);
            const existing = readPatchMap(patchPath);
            previousPatchMapsByBucket[b] = existing;
            const merged = mergePatchMaps(existing, aiOut.accepted || {});
            writePatchMap(patchPath, merged);
            patchWrites.push(`/fixtures.out/${encodeURIComponent(publicSlug)}/${path.basename(patchPath)}`);
          }
        }
        const beforeArtifacts = snapshotCompareArtifacts(outDir, publicSlug, iter, "before", targetBuckets);
        if (job) updateRefineJob(jobId, { status: "running", message: `iter ${iter} applied`, iter });

        // Re-compare after applying patches
        const { response: afterRes, data: afterJson } = await fetchJsonInternal(
          req,
          port,
          `/api/compare/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(compareBody),
          }
        );
        if (!afterRes.ok || !afterJson?.ok) {
          return res.status(500).json({
            ok: false,
            error: afterJson?.error || "Compare-after failed during refine",
            iteration: iter,
          });
        }

        let scoreAfter = {};
        for (const b of targetBuckets) {
          scoreAfter[b] = readJsonIfExists(scorePathForBucket(outDir, b), {}) || {};
        }

        const beforeMetric = Math.max(...targetBuckets.map((b) => Number(scores[b]?.diffRatio || 1)));
        let afterMetric = Math.max(...targetBuckets.map((b) => Number(scoreAfter[b]?.diffRatio || 1)));
        let gate = evaluateImprovement({
          beforeDiff: beforeMetric,
          afterDiff: afterMetric,
          epsilon: IMPROVE_EPSILON,
        });
        let improvedBy = gate.improvedBy;
        let improved = gate.accept;

        if (!dryRun && !improved) {
          for (const b of targetBuckets) {
            const patchPath = patchesFilePath(outDir, bucketRaw === "all" ? b : b);
            writePatchMap(patchPath, previousPatchMapsByBucket[b] || {});
          }

          const { response: rollbackRes, data: rollbackJson } = await fetchJsonInternal(
            req,
            port,
            `/api/compare/${encodeURIComponent(slug)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(compareBody),
            }
          );
          if (!rollbackRes.ok || !rollbackJson?.ok) {
            return res.status(500).json({
              ok: false,
              error: rollbackJson?.error || "Compare-rollback failed during refine",
              iteration: iter,
            });
          }

          const rolledBackScores = {};
          for (const b of targetBuckets) {
            rolledBackScores[b] = readJsonIfExists(scorePathForBucket(outDir, b), {}) || {};
          }
          scoreAfter = rolledBackScores;
          afterMetric = Math.max(...targetBuckets.map((b) => Number(scoreAfter[b]?.diffRatio || 1)));
          gate = evaluateImprovement({
            beforeDiff: beforeMetric,
            afterDiff: afterMetric,
            epsilon: IMPROVE_EPSILON,
          });
          improvedBy = gate.improvedBy;
          improved = gate.accept;
          rejectStreak += 1;
        } else if (improved) {
          rejectStreak = 0;
        }

        const thresholdPass = targetBuckets.every((b) => {
          const s = scoreAfter[b] || {};
          return Boolean(s.pass) || Number(s.diffRatio || 1) <= passDiffRatio;
        });
        const passNow = thresholdPass && improved;

        const afterArtifacts = snapshotCompareArtifacts(outDir, publicSlug, iter, "after", targetBuckets);
        report.iterations.push({
          iteration: iter,
          before: scores,
          after: scoreAfter,
          artifacts: {
            before: beforeArtifacts,
            after: afterArtifacts,
          },
          offenders: offendersByBucket,
          acceptedPatches: acceptedByBucket,
          rejectedPatches: rejectedByBucket,
          patchFiles: patchWrites,
          improvedBy,
          accepted: improved,
          rolledBack: !improved,
          pass: passNow,
        });
        if (job) {
          updateRefineJob(jobId, {
            status: "running",
            message: `iter ${iter} scored`,
            iter,
            result: { ...report },
          });
        }

        if (passNow) {
          report.stoppedReason = "pass-threshold-reached";
          break;
        }
        if (rejectStreak >= 2) {
          report.stoppedReason = "no-improvement";
          break;
        }
        if (Math.abs(improvedBy) < IMPROVE_EPSILON) {
          lowImproveStreak += 1;
        } else {
          lowImproveStreak = 0;
        }
        if (lowImproveStreak >= 2) {
          report.stoppedReason = "plateau";
          break;
        }
        if (previousMetric != null && afterMetric > previousMetric + IMPROVE_EPSILON) {
          report.stoppedReason = "regressed";
          break;
        }
        previousMetric = afterMetric;
        if (iter === maxIters) {
          report.stoppedReason = "max-iters";
        }
      }

      if (!report.stoppedReason) report.stoppedReason = "completed";
      report.files = {
        report: `/fixtures.out/${encodeURIComponent(publicSlug)}/refine-report.${bucketRaw}.json`,
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
      if (job) {
        updateRefineJob(jobId, {
          status: "done",
          message: report.stoppedReason || "completed",
          result: report,
          iter: report.iterations.length,
        });
      }
      return res.json(report);
    } catch (e) {
      const jobId = String(req.body?._jobId || "").trim();
      if (jobId) updateRefineJob(jobId, { status: "failed", error: String(e?.message || e), message: "failed" });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/refine-structure/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
      const baseUrl = selfBaseUrl(req, port);
      const isWorker = Boolean(req.body?._jobWorker);
      if (!isWorker && !asObj(req.body?.testMode)) {
        const job = createRefineJob({ slug, mode: "structure" });
        const payload = {
          ...req.body,
          _jobId: job.jobId,
          _jobWorker: true,
        };
        Promise.resolve()
          .then(async () => {
            const { response, data: result } = await fetchJsonInternal(
              req,
              port,
              `/api/refine-structure/${encodeURIComponent(slug)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }
            );
            if (!response.ok) {
              const softDone = response.status === 409 && result && typeof result === "object";
              if (softDone) {
                updateRefineJob(job.jobId, {
                  status: "done",
                  result,
                  message: String(result?.stoppedReason || "no-improvement"),
                });
                return;
              }
              updateRefineJob(job.jobId, {
                status: "failed",
                error: result?.error || "refine-structure failed",
                result,
                message: "failed",
              });
              return;
            }
            updateRefineJob(job.jobId, {
              status: "done",
              result,
              message: "done",
            });
          })
          .catch((e) => {
            const target = `${baseUrl}/api/refine-structure/${encodeURIComponent(slug)}`;
            updateRefineJob(job.jobId, {
              status: "failed",
              error: `Internal structure worker call failed (${target}): ${String(e?.message || e)}`,
              message: "failed",
            });
          });
        return res.json({ ok: true, jobId: job.jobId });
      }
      const jobId = String(req.body?._jobId || "").trim();
      const job = jobId ? getRefineJob(jobId) : null;
      if (job) updateRefineJob(jobId, { status: "running", message: "starting", iter: 0 });

      const bucket = String(req.body?.bucket || "desktop").trim().toLowerCase();
      if (!["desktop", "tablet", "mobile"].includes(bucket)) {
        return res.status(400).json({ ok: false, error: "bucket must be desktop|tablet|mobile" });
      }

      const maxIters = Math.max(1, Math.min(4, Number(req.body?.maxIters || 2)));
      const maxOpsPerIter = Math.max(1, Math.min(20, Number(req.body?.maxOpsPerIter || 8)));
      const topOffenders = Math.max(1, Math.min(40, Number(req.body?.topOffenders || 10)));
      const passDiffRatio = clampPassDiffRatio(req.body?.passDiffRatio, 0.02);
      const dryRun = Boolean(req.body?.dryRun);

      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      ensureDir(outDir);
      ensurePatchesFile(outDir);

      const scriptPath = path.join(outDir, `structure-repairs.${bucket}.json`);
      const reportPath = path.join(outDir, `refine-structure-report.${bucket}.json`);

      // Test mode for deterministic endpoint tests (no compare/browser dependency).
      if (asObj(req.body?.testMode)) {
        const beforeDiff = Number(req.body.testMode.beforeDiffRatio ?? 0.25);
        const afterDiff = Number(req.body.testMode.afterDiffRatio ?? 0.3);
        const accepted = afterDiff < beforeDiff;
        const reportMock = {
          ok: accepted,
          slug: publicSlug,
          bucket,
          before: { diffRatio: beforeDiff },
          after: { diffRatio: afterDiff },
          iterations: [
            {
              iter: 1,
              targetRootId: String(req.body?.testMode?.targetRootId || "root"),
              opsApplied: asArr(asObj(req.body?.forceEditScript)?.ops),
              scoreBefore: { diffRatio: beforeDiff },
              scoreAfter: { diffRatio: afterDiff },
              accepted,
            },
          ],
          rollback: !accepted,
          files: {
            script: `/fixtures.out/${encodeURIComponent(publicSlug)}/structure-repairs.${bucket}.json`,
            report: `/fixtures.out/${encodeURIComponent(publicSlug)}/refine-structure-report.${bucket}.json`,
          },
        };
        fs.writeFileSync(reportPath, JSON.stringify(reportMock, null, 2), "utf8");
        if (accepted && !dryRun && asObj(req.body?.forceEditScript)) {
          fs.writeFileSync(scriptPath, JSON.stringify(req.body.forceEditScript, null, 2), "utf8");
        }
        return res.status(accepted ? 200 : 409).json(reportMock);
      }

      // 1) Ensure deterministic build exists.
      const built = await runBuildAndPreview({ slug });
      if (!built.ok) {
        return res.status(500).json({
          ok: false,
          error: built.error || "Deterministic build failed before structure refine.",
          stage: built.stage,
        });
      }

      const staged = readStage(slug);
      if (!staged?.ast?.tree) {
        return res.status(400).json({ ok: false, error: `No staged AST for "${slug}"` });
      }
      const originalAst = JSON.parse(JSON.stringify(staged.ast));
      let workingAst = JSON.parse(JSON.stringify(staged.ast));

      const cfg = getConfig();
      const aiClient = await getAiClient(cfg);

      async function runCompareAll() {
        const { response, data: payload } = await fetchJsonInternal(
          req,
          port,
          `/api/compare/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              multi: true,
              viewports: "all",
              passDiffRatio,
              screenshot: { mode: "element", selector: "#cmp_root", minHeight: 50 },
              waitMs: 300,
            }),
          }
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "compare failed");
        }
        const scores = {
          desktop: readJsonIfExists(scorePathForBucket(outDir, "desktop"), {}),
          tablet: readJsonIfExists(scorePathForBucket(outDir, "tablet"), {}),
          mobile: readJsonIfExists(scorePathForBucket(outDir, "mobile"), {}),
        };
        return { payload, scores };
      }

      function scoreForBucket(scoresObj) {
        return scoresObj?.[bucket] || {};
      }

      const beforeRun = await runCompareAll();
      const beforeScore = scoreForBucket(beforeRun.scores);
      let currentScores = beforeRun.scores;
      let lastGoodAst = JSON.parse(JSON.stringify(workingAst));
      let acceptedAny = false;
      const acceptedOps = [];
      const iterations = [];
      const IMPROVE_EPSILON = 0.0005;
      let lowImproveStreak = 0;
      let rejectStreak = 0;
      let stoppedReason = "";

      for (let iter = 1; iter <= maxIters; iter += 1) {
        if (job && job.cancelRequested) {
          const cancelledResponse = {
            ok: false,
            slug: publicSlug,
            bucket,
            before: beforeScore,
            after: beforeScore,
            iterations,
            cancelled: true,
            files: {
              script: `/fixtures.out/${encodeURIComponent(publicSlug)}/structure-repairs.${bucket}.json`,
              report: `/fixtures.out/${encodeURIComponent(publicSlug)}/refine-structure-report.${bucket}.json`,
            },
          };
          fs.writeFileSync(reportPath, JSON.stringify(cancelledResponse, null, 2), "utf8");
          updateRefineJob(jobId, { status: "cancelled", message: "cancelled", iter });
          return res.status(409).json(cancelledResponse);
        }
        if (job) updateRefineJob(jobId, { status: "running", message: `iter ${iter} start`, iter });
        const viewport = resolveBucketViewport(bucket, currentScores);

        const { chromium } = await loadCompareDeps();
        const layout = await captureLayoutJson({
          chromium,
          slug,
          port,
          outDir,
          viewport,
          waitMs: 80,
        });
        const layoutPath = path.join(outDir, `layout.${bucket}.json`);
        fs.writeFileSync(layoutPath, JSON.stringify(layout, null, 2), "utf8");

        const diffPath = diffPathForBucket(outDir, bucket);
        const elementDiffPath = path.join(outDir, `element-diff.${bucket}.json`);
        computeElementDiff(diffPath, layout, elementDiffPath);
        const offendersRaw = readJsonIfExists(elementDiffPath, []) || [];
        const offenders = offendersRaw.slice(0, topOffenders);

        if (!offenders.length) {
          iterations.push({
            iter,
            targetRootId: "",
            opsApplied: [],
            scoreBefore: scoreForBucket(beforeRun.scores),
            scoreAfter: scoreForBucket(beforeRun.scores),
            accepted: false,
            reason: "no-offenders",
          });
          break;
        }

        const targetRootId = chooseTargetRootFromHotZones(offenders, layout);
        const improveArtifact = readJsonIfExists(path.join(outDir, "artifact.improve.json"), null)
          || readJsonIfExists(path.join(outDir, "artifact.codeit.json"), null)
          || readJsonIfExists(path.join(outDir, "artifact.generate.json"), null);
        const subtreeHtml = extractSubtreeHtmlByNodeId(String(improveArtifact?.html || ""), targetRootId);
        const subtreeTree = buildSubtreeTreeView({ tree: workingAst.tree }, targetRootId, 100);

        const forcedScript = asObj(req.body?.forceEditScript);
        let script = forcedScript;
        if (!script) {
          const prompt = [
            "Output JSON only. No markdown. No prose.",
            "You are repairing structure in a bounded subtree.",
            "Allowed ops ONLY: wrap, unwrap, move, reorder, setClasses, setLayout.",
            "Never change text content, image src, href, CTA labels, JS, CSS files, or outside subtree.",
            `Bucket: ${bucket}. targetRootId: ${targetRootId}. maxOps: ${maxOpsPerIter}.`,
            "Schema: {version:1,bucket,targetRootId,ops:[...]}",
          ].join("\n");
          const userPayload = {
            bucket,
            targetRootId,
            maxOpsPerIter,
            offenders: offenders.map((o) => ({
              nodeId: o.nodeId,
              pixels: Number(o.pixels || 0),
              ratio: Number(o.ratio || 0),
            })),
            subtreeTree,
            subtreeHtml,
          };
          let ai;
          try {
            ai = await aiClient.complete({
              system: prompt,
              user: JSON.stringify(userPayload),
              maxOutputTokens: 2000,
              temperature: 0,
            });
          } catch (e) {
            throw new Error(formatAiProviderError(e, cfg));
          }
          script = parseJsonLoose(ai?.text || "");
        }

        const scriptObj = asObj(script);
        if (!scriptObj) {
          iterations.push({
            iter,
            targetRootId,
            opsApplied: [],
            scoreBefore: scoreForBucket(beforeRun.scores),
            scoreAfter: scoreForBucket(beforeRun.scores),
            accepted: false,
            reason: "invalid-script-json",
          });
          break;
        }
        scriptObj.version = 1;
        scriptObj.bucket = bucket;
        scriptObj.targetRootId = String(scriptObj.targetRootId || targetRootId).trim();
        scriptObj.ops = asArr(scriptObj.ops).slice(0, maxOpsPerIter);

        const scoreBefore = scoreForBucket(currentScores);
        const iterBeforeArtifacts = snapshotCompareArtifacts(outDir, publicSlug, iter, "before", [bucket]);
        let candidateAst;
        let applied;
        try {
          const appliedResult = applyStructureEdits({ tree: workingAst.tree }, scriptObj);
          candidateAst = { ...workingAst, tree: appliedResult.ast.tree };
          applied = appliedResult.appliedOps || [];
        } catch (e) {
          iterations.push({
            iter,
            targetRootId,
            opsApplied: [],
            scoreBefore,
            scoreAfter: scoreBefore,
            accepted: false,
            reason: `validation-failed: ${String(e?.message || e)}`,
          });
          break;
        }

        // Apply candidate and rebuild deterministic pipeline
        writeStage(slug, candidateAst);
        const rebuild = await runBuildAndPreview({ slug });
        if (!rebuild.ok) {
          writeStage(slug, workingAst); // rollback
          iterations.push({
            iter,
            targetRootId,
            opsApplied: [],
            scoreBefore,
            scoreAfter: scoreBefore,
            accepted: false,
            reason: `rebuild-failed: ${rebuild.error || rebuild.stage}`,
          });
          break;
        }

        const afterRun = await runCompareAll();
        let scoreAfter = scoreForBucket(afterRun.scores);
        const beforeDiff = Number(scoreBefore?.diffRatio || 1);
        let afterDiff = Number(scoreAfter?.diffRatio || 1);
        const gate = evaluateImprovement({
          beforeDiff,
          afterDiff,
          epsilon: IMPROVE_EPSILON,
        });
        const improved = gate.accept;
        const improvedBy = gate.improvedBy;
        const iterArtifacts = {
          before: iterBeforeArtifacts,
          after: snapshotCompareArtifacts(outDir, publicSlug, iter, "after", [bucket]),
        };

        if (improved) {
          acceptedAny = true;
          workingAst = candidateAst;
          lastGoodAst = JSON.parse(JSON.stringify(candidateAst));
          acceptedOps.push(...applied);
          currentScores = afterRun.scores;
          rejectStreak = 0;
        } else {
          // rollback
          writeStage(slug, workingAst);
          await runBuildAndPreview({ slug });
          const rollbackRun = await runCompareAll();
          scoreAfter = scoreForBucket(rollbackRun.scores);
          afterDiff = Number(scoreAfter?.diffRatio || 1);
          currentScores = rollbackRun.scores;
          rejectStreak += 1;
        }
        if (job) updateRefineJob(jobId, { status: "running", message: `iter ${iter} applied`, iter });

        iterations.push({
          iter,
          targetRootId,
          opsApplied: applied,
          scoreBefore,
          scoreAfter,
          artifacts: iterArtifacts,
          improvedBy,
          accepted: improved,
          rolledBack: !improved,
        });
        if (job) {
          updateRefineJob(jobId, {
            status: "running",
            message: `iter ${iter} scored`,
            iter,
            result: {
              ok: true,
              slug: publicSlug,
              bucket,
              previewUrl: `/preview/${encodeURIComponent(publicSlug)}`,
              before: beforeScore,
              after: scoreAfter,
              iterations: [...iterations],
            },
          });
        }

        if ((Number(scoreAfter?.pass) === 1 || Boolean(scoreAfter?.pass) || afterDiff <= passDiffRatio) && improved) {
          lowImproveStreak = 0;
          stoppedReason = "pass-threshold-reached";
          break;
        }
        if (rejectStreak >= 2) {
          stoppedReason = "no-improvement";
          break;
        }
        if (Math.abs(improvedBy) < IMPROVE_EPSILON) {
          lowImproveStreak += 1;
        } else {
          lowImproveStreak = 0;
        }
        if (lowImproveStreak >= 2) {
          stoppedReason = "plateau";
          break;
        }
        if (iter === maxIters) stoppedReason = "max-iters";
      }

      // Final rollback protection
      if (!acceptedAny) {
        writeStage(slug, originalAst);
        await runBuildAndPreview({ slug });
      }

      const finalRun = await runCompareAll();
      const afterScore = scoreForBucket(finalRun.scores);
      const response = {
        ok: acceptedAny,
        slug: publicSlug,
        bucket,
        previewUrl: `/preview/${encodeURIComponent(publicSlug)}`,
        before: beforeScore,
        after: afterScore,
        iterations,
        stoppedReason: stoppedReason || (acceptedAny ? "improved" : "no-improvement"),
        files: {
          script: `/fixtures.out/${encodeURIComponent(publicSlug)}/structure-repairs.${bucket}.json`,
          report: `/fixtures.out/${encodeURIComponent(publicSlug)}/refine-structure-report.${bucket}.json`,
        },
      };

      const reportToWrite = { ...response, dryRun, maxIters, maxOpsPerIter, topOffenders, passDiffRatio };
      fs.writeFileSync(reportPath, JSON.stringify(reportToWrite, null, 2), "utf8");

      if (acceptedAny && !dryRun) {
        const scriptToWrite = {
          version: 1,
          bucket,
          targetRootId: iterations.find((x) => x.accepted)?.targetRootId || "",
          ops: acceptedOps.slice(0, 400),
        };
        fs.writeFileSync(scriptPath, JSON.stringify(scriptToWrite, null, 2), "utf8");
      }
      if (job) {
        updateRefineJob(jobId, {
          status: "done",
          message: acceptedAny ? "done" : "no-improvement",
          iter: iterations.length,
          result: response,
        });
      }

      return res.status(acceptedAny ? 200 : 409).json(response);
    } catch (e) {
      const jobId = String(req.body?._jobId || "").trim();
      if (jobId) updateRefineJob(jobId, { status: "failed", error: String(e?.message || e), message: "failed" });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/refine-structure/:slug/undo", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
      const bucket = String(req.body?.bucket || "desktop").trim().toLowerCase();
      if (!["desktop", "tablet", "mobile"].includes(bucket)) {
        return res.status(400).json({ ok: false, error: "bucket must be desktop|tablet|mobile" });
      }
      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      const scriptPath = path.join(outDir, `structure-repairs.${bucket}.json`);
      const reportPath = path.join(outDir, `refine-structure-report.${bucket}.json`);
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
      if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
      const rebuilt = await runBuildAndPreview({ slug });
      if (!rebuilt.ok) {
        return res.status(500).json({
          ok: false,
          error: rebuilt.error || "Rebuild failed after undo",
          stage: rebuilt.stage,
        });
      }
      return res.json({
        ok: true,
        slug: publicSlug,
        bucket,
        undone: true,
        files: {
          script: `/fixtures.out/${encodeURIComponent(publicSlug)}/structure-repairs.${bucket}.json`,
          report: `/fixtures.out/${encodeURIComponent(publicSlug)}/refine-structure-report.${bucket}.json`,
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // AutoFix endpoint unchanged from your version…
  app.post("/api/autofix/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

      const { outDir, publicSlug } = resolveOutDirForCompare(slug);
      ensureDir(outDir);

      const patchesPath = ensurePatchesFile(outDir);
      const elementDiffPath = path.join(outDir, "element-diff.json");
      const layoutPath = path.join(outDir, "layout.json");

      if (!fs.existsSync(elementDiffPath)) {
        return res.status(400).json({
          ok: false,
          error: `Missing element-diff.json for "${slug}". Run /api/compare/${slug} first.`,
        });
      }

      const offenders = JSON.parse(fs.readFileSync(elementDiffPath, "utf8") || "[]");
      if (!Array.isArray(offenders) || offenders.length === 0) {
        return res.json({ ok: true, message: "No offenders (already clean or no diff data)." });
      }

      const top = offenders[0];
      const patches = JSON.parse(fs.readFileSync(patchesPath, "utf8") || "{}");

      if (fs.existsSync(layoutPath)) {
        try {
          const layout = JSON.parse(fs.readFileSync(layoutPath, "utf8") || "[]");
          const topEl = Array.isArray(layout) ? layout.find((x) => x?.nodeId === top.nodeId) : null;
          const tokens = String(topEl?.className || "").split(/\s+/).filter(Boolean);

          const rules = readRules();
          const learned = findClassReplaceRule(rules, tokens);

          if (learned) {
            patches[top.nodeId] = patches[top.nodeId] || {};
            patches[top.nodeId].classReplace = patches[top.nodeId].classReplace || {};
            patches[top.nodeId].classReplace[learned.from] = learned.to;

            fs.writeFileSync(patchesPath, JSON.stringify(patches, null, 2), "utf8");

            return res.json({
              ok: true,
              strategy: "learnedRule",
              patchedNodeId: top.nodeId,
              applied: {
                type: "classReplace",
                from: learned.from,
                to: learned.to,
                confidence: learned.confidence || 0,
              },
              topOffender: top,
              patchesFile: `/fixtures.out/${encodeURIComponent(publicSlug)}/patches.json`,
            });
          }
        } catch (e) {
          console.warn("[autofix] learned-rule step failed:", String(e?.message || e));
        }
      }

      const existing = patches[top.nodeId] || {};
      const cycle = [
        { style: { transform: "translateX(1px)" } },
        { style: { transform: "translateX(-1px)" } },
        { style: { transform: "translateY(1px)" } },
        { style: { transform: "translateY(-1px)" } },
      ];

      let nextPatch = cycle[0];
      if (existing?.style?.transform) {
        const idx = cycle.findIndex((c) => c.style.transform === existing.style.transform);
        nextPatch = cycle[(idx + 1 + cycle.length) % cycle.length];
      }

      patches[top.nodeId] = {
        ...(patches[top.nodeId] || {}),
        ...nextPatch,
      };

      fs.writeFileSync(patchesPath, JSON.stringify(patches, null, 2), "utf8");

      return res.json({
        ok: true,
        strategy: "nudgeCycle",
        patchedNodeId: top.nodeId,
        applied: patches[top.nodeId],
        topOffender: top,
        patchesFile: `/fixtures.out/${encodeURIComponent(slug)}/patches.json`,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
