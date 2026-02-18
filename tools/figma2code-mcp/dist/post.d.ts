/**
 * POST normalized AST to preview-only or generate endpoint.
 * Body matches UI: { ...ast, refineMode } for preview-only.
 */
import type { AST } from "./normalize/mcpToPluginAst.js";
export interface PostOptions {
    endpoint: string;
    ast: AST;
    refineMode?: number | string;
    timeoutMs?: number;
}
export interface PostResult {
    ok: boolean;
    status: number;
    body?: string;
    json?: unknown;
    error?: string;
}
/**
 * POST AST to the given URL. For preview-only, body includes refineMode.
 */
export declare function postAst(options: PostOptions): Promise<PostResult>;
//# sourceMappingURL=post.d.ts.map