/**
 * MCP HTTP client and adapter.
 * Uses JSON-RPC 2.0 over POST. Per MCP lifecycle, sends initialize + initialized
 * before the first tools/call when using a session.
 */
export interface McpToolCallRequest {
    name: string;
    arguments?: Record<string, unknown>;
}
export interface McpToolCallResult {
    content?: Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
        url?: string;
    }>;
    isError?: boolean;
}
export interface McpCallToolResponse {
    result?: McpToolCallResult;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
type McpTarget = "desktop" | {
    fileKey?: string;
    nodeId?: string;
};
/**
 * Default MCP endpoints.
 */
export declare const MCP_ENDPOINTS: {
    readonly remote: "https://mcp.figma.com/mcp";
    readonly desktop: "http://127.0.0.1:3845/mcp";
};
/**
 * Run MCP initialization handshake (initialize + initialized) so the server
 * accepts subsequent tools/call. Call once before the first tool call.
 */
export declare function initializeMcp(endpoint: string, options?: {
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * Call a single MCP tool via HTTP POST (JSON-RPC tools/call).
 */
export declare function callTool(endpoint: string, toolName: string, args?: Record<string, unknown>, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<McpCallToolResponse>;
/**
 * Fetch design context for a node (remote: fileKey + nodeId in colon form).
 */
export declare function getDesignContext(endpoint: string, params: McpTarget, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    verbose?: boolean;
}): Promise<{
    content?: string;
    error?: string;
}>;
/**
 * Fetch screenshot for a node.
 */
export declare function getScreenshot(endpoint: string, params: McpTarget, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<{
    content?: string;
    error?: string;
}>;
/**
 * Fetch variable definitions for the selection.
 */
export declare function getVariableDefs(endpoint: string, params: McpTarget, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<{
    content?: string;
    error?: string;
}>;
/**
 * Fetch metadata (sparse XML) for the selection. Useful when design context is truncated.
 */
export declare function getMetadata(endpoint: string, params: McpTarget, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<{
    content?: string;
    error?: string;
}>;
export {};
//# sourceMappingURL=client.d.ts.map