/**
 * Parse Figma design URLs and normalize node IDs.
 * Figma URLs use node-id=1-2 (hyphen); some MCP tools expect 1:2 (colon).
 */
export interface FigmaUrlParts {
    /** File key from path /design/:fileKey/ */
    fileKey: string;
    /** Node ID in hyphen form (e.g. "1-2") from query param node-id */
    nodeIdHyphen: string;
    /** Node ID in colon form (e.g. "1:2") for MCP tools that require it */
    nodeIdColon: string;
    /** Full design URL (without fragment/hash) */
    url: string;
}
/**
 * Parse a Figma design URL.
 * Requires node-id in query (e.g. ?node-id=42-15).
 * Returns null if URL is invalid or node-id is missing.
 */
export declare function parseFigmaDesignUrl(url: string): FigmaUrlParts | null;
/**
 * Convert hyphen node ID to colon format.
 */
export declare function nodeIdHyphenToColon(nodeIdHyphen: string): string;
/**
 * Validate and exit with a helpful message if URL is missing node-id.
 */
export declare function requireNodeId(url: string): FigmaUrlParts;
//# sourceMappingURL=url.d.ts.map