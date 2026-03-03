#!/usr/bin/env node
/**
 * figma2code-mcp CLI: ingest from MCP → normalize → output AST and optionally POST.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseFigmaDesignUrl, requireNodeId } from "./figma/url.js";
import { getDesignContext, getMetadata, getScreenshot, getVariableDefs, initializeMcp, MCP_ENDPOINTS } from "./mcp/client.js";
import { normalizeMcpToPluginAst } from "./normalize/mcpToPluginAst.js";
import { postAst } from "./post.js";
import { setVerbose, log, logVerbose } from "./log.js";

const DEFAULT_MCP_REMOTE = MCP_ENDPOINTS.remote;
const DEFAULT_MCP_DESKTOP = MCP_ENDPOINTS.desktop;

type IngestFlags = {
  url?: string;
  desktop?: boolean;
  mcp?: string;
  type?: string;
  slug?: string;
  out?: string;
  post?: string;
  refineMode?: string;
  dryRun?: boolean;
  verbose?: boolean;
  /** Skip get_screenshot and get_variable_defs to use only 2 MCP calls instead of 4 (helps with rate limits). */
  minimal?: boolean;
};

function hasNodeNotFoundSignal(text?: string): boolean {
  const s = String(text || "").toLowerCase();
  return s.includes("no node could be found for the provided nodeid");
}

function isDesignContextError(text?: string): boolean {
  const s = String(text || "").trim();
  if (!s || s.length < 20) return true;
  const lower = s.toLowerCase();
  return (
    lower.includes("rate limit exceeded") ||
    lower.includes("please try again tomorrow") ||
    (lower.includes("error") && (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("failed")))
  );
}

function slugFromName(name: string): string {
  return (
    String(name || "section")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function parseArgs(argv: string[]): { command: string; flags: IngestFlags } {
  const args = argv.slice(2);
  const command = args[0] ?? "ingest";
  const flags: IngestFlags = {};

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--url" && args[i + 1]) {
      flags.url = args[++i];
    } else if (a === "--desktop") {
      flags.desktop = true;
    } else if (a === "--mcp" && args[i + 1]) {
      flags.mcp = args[++i];
    } else if (a === "--type" && args[i + 1]) {
      flags.type = args[++i];
    } else if (a === "--slug" && args[i + 1]) {
      flags.slug = args[++i];
    } else if (a === "--out" && args[i + 1]) {
      flags.out = args[++i];
    } else if (a === "--post" && args[i + 1]) {
      flags.post = args[++i];
    } else if (a === "--refineMode" && args[i + 1]) {
      flags.refineMode = args[++i];
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--verbose") {
      flags.verbose = true;
    } else if (a === "--minimal") {
      flags.minimal = true;
    }
  }

  return { command, flags };
}

async function runIngest(flags: IngestFlags): Promise<number> {
  if (flags.verbose) setVerbose(true);

  const desktop = !!flags.desktop;
  const url = flags.url;

  if (!desktop && !url) {
    console.error("Error: either --url <figmaDesignUrl> or --desktop is required.");
    return 1;
  }

  const mcpEndpoint = flags.mcp ?? (desktop ? DEFAULT_MCP_DESKTOP : DEFAULT_MCP_REMOTE);

  let fileKey: string | undefined;
  let nodeIdColon: string | undefined;
  let frameName = "section";

  if (url) {
    try {
      const parts = requireNodeId(url);
      fileKey = parts.fileKey;
      nodeIdColon = parts.nodeIdColon;
      // keep blank; prefer frame/component name from MCP payload over URL node-id
      frameName = "";
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }

  const mcpParams = desktop
    ? (nodeIdColon ? { nodeId: nodeIdColon, fileKey } : "desktop")
    : fileKey && nodeIdColon
      ? { fileKey, nodeId: nodeIdColon }
      : null;
  if (!mcpParams) {
    console.error("Error: missing fileKey or nodeId.");
    return 1;
  }

  const t0 = Date.now();
  logVerbose("MCP endpoint: " + mcpEndpoint);

  // 0) MCP handshake (initialize + initialized) so server accepts tools/call
  logVerbose("MCP initialize...");
  const initResult = await initializeMcp(mcpEndpoint, { timeoutMs: 15_000 });
  if (!initResult.ok) {
    console.error("MCP initialize failed:", initResult.error);
    return 1;
  }
  logVerbose("MCP initialize done.");

  // 1) get_design_context
  logVerbose("Calling get_design_context...");
  const designRes = await getDesignContext(mcpEndpoint, mcpParams, { timeoutMs: 45_000 });
  if (designRes.error) {
    console.error("MCP get_design_context failed:", designRes.error);
    if (designRes.error.includes("401") || designRes.error.includes("Unauthorized")) {
      console.error("");
      console.error("Remote MCP (https://mcp.figma.com/mcp) requires Figma authentication.");
      console.error("  • To use remote: set up OAuth/token per https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/");
      console.error("  • To skip auth: use desktop MCP instead — open the same file in Figma desktop, select the frame, then run:");
      console.error("    figma2code-mcp ingest --desktop --mcp http://127.0.0.1:3845/mcp --out ./tmp/paul-tobin-418-8132.ast.json --dry-run --verbose");
    } else {
      console.error("Ensure MCP is available (remote: auth; desktop: Figma app with MCP at http://127.0.0.1:3845/mcp).");
    }
    return 1;
  }
  logVerbose("get_design_context done.", { length: designRes.content?.length ?? 0 });
  if (hasNodeNotFoundSignal(designRes.content)) {
    console.error("Desktop MCP could not resolve that node-id in the active Figma tab.");
    console.error("Open the exact file/tab in Figma desktop and retry, or run selection-based desktop mode (omit --url).");
    return 1;
  }
  let designContext = designRes.content ?? "";
  if (isDesignContextError(designContext)) {
    logVerbose("Design context looks like an error/rate-limit; ignoring for tree build.", { snippet: designContext.slice(0, 80) });
    designContext = "";
  }

  // 2) get_screenshot (skipped in --minimal to save MCP rate limit)
  let screenshotRes: { content?: string; error?: string } = {};
  let varsRes: { content?: string; error?: string } = {};
  if (!flags.minimal) {
    logVerbose("Calling get_screenshot...");
    screenshotRes = await getScreenshot(mcpEndpoint, mcpParams, { timeoutMs: 30_000 });
    if (screenshotRes.error) {
      logVerbose("get_screenshot failed (non-fatal):", screenshotRes.error);
    }
    logVerbose("Calling get_variable_defs...");
    varsRes = await getVariableDefs(mcpEndpoint, mcpParams, { timeoutMs: 15_000 });
    if (varsRes.error) {
      logVerbose("get_variable_defs failed (non-fatal):", varsRes.error);
    }
  } else {
    logVerbose("Minimal mode: skipping get_screenshot and get_variable_defs (saves 2 MCP calls).");
  }

  // 4) If design context is truncated/large, get_metadata and optionally re-fetch (keep simple: single node first)
  let metadataContent: string | undefined;
  if (designRes.content && (designRes.content.includes("truncated") || designRes.content.length > 100_000)) {
    logVerbose("Design context large/truncated; fetching get_metadata...");
    const metaRes = await getMetadata(mcpEndpoint, mcpParams, { timeoutMs: 15_000 });
    if (metaRes.content) metadataContent = metaRes.content;
  } else {
    const metaRes = await getMetadata(mcpEndpoint, mcpParams, { timeoutMs: 15_000 });
    if (metaRes.content) metadataContent = metaRes.content;
  }

  const elapsed = Date.now() - t0;
  logVerbose(`MCP fetch done in ${elapsed}ms`);

  const metadataUsable =
    metadataContent &&
    metadataContent.trim().length > 0 &&
    !isDesignContextError(metadataContent);
  const hasUsableData = (designContext && designContext.length > 100) || !!metadataUsable;
  if (!hasUsableData) {
    console.error("No usable design data: design context is empty or an error, and metadata is empty or rate-limited.");
    console.error("If you see rate-limit messages above, try again later. Otherwise check your Figma selection and MCP.");
    return 1;
  }

  const mcpBundle = {
    designContext,
    screenshot: screenshotRes.content,
    variableDefs: varsRes.content,
    metadata: metadataContent,
  };

  const slug = flags.slug ?? slugFromName(frameName);
  const type = (flags.type === "navbar" || flags.type === "footer" ? flags.type : "flexi_block") as "flexi_block" | "navbar" | "footer";

  let ast = normalizeMcpToPluginAst(mcpBundle, {
    slug,
    type,
    frameName: frameName !== "section" ? frameName : undefined,
  });
  if (!flags.slug) {
    const inferredName =
      String(ast?.tree?.name || "").trim() ||
      String(ast?.meta?.figma && typeof ast.meta.figma === "object" ? (ast.meta.figma as { frameName?: string }).frameName || "" : "").trim();
    if (inferredName) {
      const inferredSlug = slugFromName(inferredName);
      ast = { ...ast, slug: inferredSlug };
      if (ast.meta && typeof ast.meta.figma === "object") {
        ast.meta = {
          ...ast.meta,
          figma: { ...(ast.meta.figma as Record<string, unknown>), frameName: inferredName },
        };
      }
    }
  }

  const isEmptyTree =
    !ast.tree?.children?.length && (ast.tree?.w === 0 || !ast.tree?.w) && (ast.tree?.h === 0 || !ast.tree?.h);
  if (isEmptyTree) {
    console.error("Warning: AST tree is empty (no nodes, zero size). Check Figma selection and that get_metadata/design_context returned structure.");
  }

  const astJson = JSON.stringify(ast, null, 2);

  if (flags.out) {
    const dir = dirname(flags.out);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
    writeFileSync(flags.out, astJson, "utf8");
    console.error("Wrote AST to " + flags.out);
  }

  console.log(astJson);

  if (flags.post && !flags.dryRun) {
    const refineMode = flags.refineMode !== undefined ? (Number(flags.refineMode) || flags.refineMode) : undefined;
    const result = await postAst({
      endpoint: flags.post,
      ast,
      refineMode,
    });
    if (result.ok) {
      console.error("POST " + flags.post + " → " + result.status);
      if (result.json && typeof result.json === "object" && "previewUrl" in result.json) {
        console.error("Preview: " + (result.json as { previewUrl?: string }).previewUrl);
      }
    } else {
      console.error("POST failed:", result.error);
      if (result.body) console.error(result.body.slice(0, 500));
      return 1;
    }
  } else if (flags.post && flags.dryRun) {
    console.error("Dry run: skipping POST to " + flags.post);
  }

  return 0;
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv);

  if (command === "ingest") {
    return runIngest(flags);
  }

  if (command === "--help" || command === "-h") {
    console.error(`
figma2code-mcp — Ingest Figma design from MCP, normalize to plugin AST, optionally POST.

Commands:
  ingest    Fetch from MCP, normalize, output AST (and optionally POST).

Options:
  --url <figmaDesignUrl>   Figma design URL with node-id (e.g. ?node-id=42-15). Required for remote MCP.
  --desktop                Use desktop MCP (selection-based). You may also pass --url to target node-id explicitly.
  --mcp <endpoint>         MCP endpoint (default: remote https://mcp.figma.com/mcp, desktop http://127.0.0.1:3845/mcp).
  --type <flexi_block|navbar|footer>  Block type (default: flexi_block).
  --slug <slug>            Slug (default: derived from frame/name).
  --out <path>             Write AST JSON to file.
  --post <url>             POST AST to this URL (e.g. http://localhost:5173/api/preview-only).
  --refineMode <0|1|...>   Value for refineMode in POST body (for preview-only).
  --dry-run                 Do not POST, only output.
  --verbose                Log tool calls and timings.
  --minimal                 Skip get_screenshot and get_variable_defs (2 MCP calls instead of 4; helps with rate limits).

Examples:
  figma2code-mcp ingest --url "https://figma.com/design/ABC123/File?node-id=42-15" --out ./tmp/ast.json
  figma2code-mcp ingest --desktop --out ./tmp/ast.json
  figma2code-mcp ingest --url "..." --post http://localhost:5173/api/preview-only --refineMode 1
  figma2code-mcp ingest --url "..." --post http://localhost:5173/api/generate --type flexi_block --slug my-section
`);
    return 0;
  }

  console.error("Unknown command: " + command);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
