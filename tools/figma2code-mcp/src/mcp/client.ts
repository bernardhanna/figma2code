/**
 * MCP HTTP client and adapter.
 * Uses JSON-RPC 2.0 over POST. Per MCP lifecycle, sends initialize + initialized
 * before the first tools/call when using a session.
 */

const JSON_RPC_VERSION = "2.0";
const PROTOCOL_VERSION = "2024-11-05";
const SESSION_HEADER = "mcp-session-id";

export interface McpToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string; url?: string }>;
  isError?: boolean;
}

export interface McpCallToolResponse {
  result?: McpToolCallResult;
  error?: { code: number; message: string; data?: unknown };
}

type McpTarget = "desktop" | { fileKey?: string; nodeId?: string };

let requestId = 0;
function nextId(): number {
  return ++requestId;
}

/**
 * Default MCP endpoints.
 */
export const MCP_ENDPOINTS = {
  remote: "https://mcp.figma.com/mcp",
  desktop: "http://127.0.0.1:3845/mcp",
} as const;

const sessionByEndpoint = new Map<string, string>();

/**
 * Parse SSE (Server-Sent Events) or raw JSON response.
 * Figma desktop MCP returns "event: message\ndata: {...}".
 */
function parseMcpResponseBody(raw: string): { json?: Record<string, unknown>; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Empty response" };
  if (trimmed.startsWith("{")) {
    try {
      return { json: JSON.parse(trimmed) as Record<string, unknown> };
    } catch {
      return { error: `Invalid JSON: ${trimmed.slice(0, 150)}` };
    }
  }
  if (trimmed.includes("data:") || trimmed.startsWith("event:")) {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
    // Primary path: strict SSE "data:" lines only.
    const sseDataLines = lines
      .filter((line) => /^data:\s*/.test(line))
      .map((line) => line.replace(/^data:\s*/, "").trim())
      .filter((s) => s.length > 0);

    // Fallback: some servers emit a JSON line after "event:" without "data:" prefix.
    const fallbackJsonishLines = lines.filter(
      (line) => line.length > 0 && !/^event:\s*/.test(line) && !/^id:\s*/.test(line) && !/^retry:\s*/.test(line)
    );

    const payload = (sseDataLines.length ? sseDataLines : fallbackJsonishLines).join("\n");
    try {
      const json = JSON.parse(payload) as Record<string, unknown>;
      return { json };
    } catch {
      return { error: `SSE data line(s) are not valid JSON: ${payload.slice(0, 150)}` };
    }
  }
  return { error: `Unexpected response format: ${trimmed.slice(0, 150)}` };
}

async function mcpFetch(
  endpoint: string,
  body: object,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<Response> {
  const timeout = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const extraHeaders = options.headers ?? {};
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
    });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * Run MCP initialization handshake (initialize + initialized) so the server
 * accepts subsequent tools/call. Call once before the first tool call.
 */
export async function initializeMcp(
  endpoint: string,
  options: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 15_000;

  try {
    const initRes = await mcpFetch(
      endpoint,
      {
        jsonrpc: JSON_RPC_VERSION,
        id: nextId(),
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "figma2code-mcp", version: "0.1.0" },
        },
      },
      { timeoutMs }
    );

    const raw = await initRes.text();
    if (!initRes.ok) {
      return { ok: false, error: `MCP initialize HTTP ${initRes.status}: ${raw.slice(0, 300)}` };
    }

    const parsed = parseMcpResponseBody(raw);
    if (parsed.error || !parsed.json) {
      return { ok: false, error: parsed.error ?? "No JSON in response" };
    }
    const initJson = parsed.json as { error?: { message?: string }; result?: unknown };
    if (initJson.error) {
      return { ok: false, error: initJson.error.message ?? JSON.stringify(initJson.error) };
    }

    const sessionId = initRes.headers.get(SESSION_HEADER) || initRes.headers.get("Mcp-Session-Id");
    if (sessionId) {
      sessionByEndpoint.set(endpoint, sessionId);
    }

    // Send initialized notification (no id). Some servers expect this before tools/call.
    const notifyHeaders: Record<string, string> = {};
    if (sessionId) notifyHeaders[SESSION_HEADER] = sessionId;
    await mcpFetch(
      endpoint,
      {
        jsonrpc: JSON_RPC_VERSION,
        method: "notifications/initialized",
      },
      { timeoutMs, headers: notifyHeaders }
    );

    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `MCP initialize failed: ${message}` };
  }
}

/**
 * Call a single MCP tool via HTTP POST (JSON-RPC tools/call).
 */
export async function callTool(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown> = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<McpCallToolResponse> {
  const id = nextId();
  const body = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const timeout = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  const signal = options.signal ?? controller.signal;

  try {
    const sessionId = sessionByEndpoint.get(endpoint);
    const headers: Record<string, string> = {};
    if (sessionId) headers[SESSION_HEADER] = sessionId;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
    });

    clearTimeout(t);

    const text = await res.text();
    if (!res.ok) {
      return {
        error: {
          code: res.status,
          message: `MCP HTTP ${res.status}: ${text.slice(0, 200)}`,
          data: { status: res.status, body: text },
        },
      };
    }

    const parsed = parseMcpResponseBody(text);
    const json = (parsed.json ?? {}) as {
      jsonrpc?: string;
      id?: number;
      result?: McpToolCallResult;
      error?: { code: number; message: string; data?: unknown };
    };
    if (parsed.error && !json.result && !json.error) {
      return { error: { code: -32700, message: parsed.error } };
    }

    if (json.error) {
      return { error: json.error };
    }

    return { result: json.result };
  } catch (e) {
    clearTimeout(t);
    const message = e instanceof Error ? e.message : String(e);
    return {
      error: {
        code: -1,
        message: `MCP request failed: ${message}`,
        data: e,
      },
    };
  }
}

/**
 * Fetch design context for a node (remote: fileKey + nodeId in colon form).
 */
export async function getDesignContext(
  endpoint: string,
  params: McpTarget,
  options: { signal?: AbortSignal; timeoutMs?: number; verbose?: boolean } = {}
): Promise<{ content?: string; error?: string }> {
  const args =
    params === "desktop"
      ? {}
      : {
          ...(params.fileKey ? { fileKey: params.fileKey } : {}),
          ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        };

  const res = await callTool(endpoint, "get_design_context", args, options);

  if (res.error) {
    return { error: res.error.message };
  }

  const content = res.result?.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => (c as { text?: string }).text)
    .join("\n");

  return { content: content ?? "" };
}

/**
 * Fetch screenshot for a node.
 */
export async function getScreenshot(
  endpoint: string,
  params: McpTarget,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ content?: string; error?: string }> {
  const args =
    params === "desktop"
      ? {}
      : {
          ...(params.fileKey ? { fileKey: params.fileKey } : {}),
          ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        };

  const res = await callTool(endpoint, "get_screenshot", args, options);

  if (res.error) {
    return { error: res.error.message };
  }

  const imageItem = res.result?.content?.find((c) => c.type === "image" && typeof c.data === "string" && c.data.length > 0);
  if (imageItem?.data) {
    const mime = imageItem.mimeType || "image/png";
    return { content: `data:${mime};base64,${imageItem.data}` };
  }
  const urlItem = res.result?.content?.find((c) => c.type === "image" && typeof c.url === "string" && c.url.length > 0);
  if (urlItem?.url) {
    return { content: urlItem.url };
  }
  const content = res.result?.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => (c as { text?: string }).text)
    .join("\n");

  return { content: content ?? "" };
}

/**
 * Fetch variable definitions for the selection.
 */
export async function getVariableDefs(
  endpoint: string,
  params: McpTarget,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ content?: string; error?: string }> {
  const args =
    params === "desktop"
      ? {}
      : {
          ...(params.fileKey ? { fileKey: params.fileKey } : {}),
          ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        };

  const res = await callTool(endpoint, "get_variable_defs", args, options);

  if (res.error) {
    return { error: res.error.message };
  }

  const content = res.result?.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => (c as { text?: string }).text)
    .join("\n");

  return { content: content ?? "" };
}

/**
 * Fetch metadata (sparse XML) for the selection. Useful when design context is truncated.
 */
export async function getMetadata(
  endpoint: string,
  params: McpTarget,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ content?: string; error?: string }> {
  const args =
    params === "desktop"
      ? {}
      : {
          ...(params.fileKey ? { fileKey: params.fileKey } : {}),
          ...(params.nodeId ? { nodeId: params.nodeId } : {}),
        };

  const res = await callTool(endpoint, "get_metadata", args, options);

  if (res.error) {
    return { error: res.error.message };
  }

  const content = res.result?.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => (c as { text?: string }).text)
    .join("\n");

  return { content: content ?? "" };
}
