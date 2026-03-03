/**
 * Normalize MCP responses into the exact plugin AST shape consumed by
 * /api/preview-only and /api/generate. Does NOT use MCP React+Tailwind code
 * as source of truth; uses structured scenegraph/layout only.
 */
/** Plugin AST shape (must match plugin/code.ts and API contract). */
export interface AST {
    slug: string;
    type: "flexi_block" | "navbar" | "footer";
    frame: {
        w: number;
        h: number;
    };
    tree: NodeBase;
    slots: Record<string, unknown>;
    meta?: Record<string, unknown>;
}
/** Node shape expected by normalizeAst and pipeline. */
export interface NodeBase {
    id: string;
    name: string;
    type: string;
    w: number;
    h: number;
    children?: NodeBase[];
    bb?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    relX?: number;
    relY?: number;
    auto?: AutoLayout;
    fills?: Fill[];
    text?: TextPayload;
    img?: {
        src: string;
        w: number;
        h: number;
    };
    svg?: {
        markup?: string;
        html?: string;
    };
    [key: string]: unknown;
}
export interface AutoLayout {
    layout: "NONE" | "HORIZONTAL" | "VERTICAL";
    itemSpacing?: number;
    padT?: number;
    padR?: number;
    padB?: number;
    padL?: number;
    primaryAlign?: string;
    counterAlign?: string;
    primarySizing?: string;
    counterSizing?: string;
    [key: string]: unknown;
}
export interface Fill {
    kind: string;
    r?: number;
    g?: number;
    b?: number;
    a?: number;
    [key: string]: unknown;
}
export interface TextPayload {
    raw: string;
    family?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    letterSpacingPx?: number;
    align?: string;
    color?: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
    [key: string]: unknown;
}
/** Data collected from MCP tool calls. */
export interface McpBundle {
    designContext?: string;
    screenshot?: string;
    variableDefs?: string;
    metadata?: string;
}
export interface NormalizeMcpOpts {
    slug: string;
    type?: "flexi_block" | "navbar" | "footer";
    frameName?: string;
}
/**
 * Build plugin AST from MCP bundle.
 * - Uses get_metadata XML for structure when available.
 * - Optionally merges structured JSON from get_design_context if present.
 * - Puts screenshot in meta.screenshot or meta.overlay; variables in meta.variables.
 */
export declare function normalizeMcpToPluginAst(mcp: McpBundle, opts: NormalizeMcpOpts): AST;
//# sourceMappingURL=mcpToPluginAst.d.ts.map