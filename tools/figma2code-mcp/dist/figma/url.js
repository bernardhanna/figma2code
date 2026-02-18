/**
 * Parse Figma design URLs and normalize node IDs.
 * Figma URLs use node-id=1-2 (hyphen); some MCP tools expect 1:2 (colon).
 */
/**
 * Extract fileKey from path /design/:fileKey/ or /file/:fileKey/
 */
function extractFileKey(pathname) {
    const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
    const designIdx = segments.indexOf("design");
    const fileIdx = segments.indexOf("file");
    if (designIdx !== -1 && segments[designIdx + 1])
        return segments[designIdx + 1];
    if (fileIdx !== -1 && segments[fileIdx + 1])
        return segments[fileIdx + 1];
    return null;
}
/**
 * Extract node-id from query string (hyphen format).
 */
function extractNodeIdHyphen(search) {
    const params = new URLSearchParams(search);
    const nodeId = params.get("node-id");
    return nodeId && /^[\d\-]+$/.test(nodeId) ? nodeId : null;
}
/**
 * Parse a Figma design URL.
 * Requires node-id in query (e.g. ?node-id=42-15).
 * Returns null if URL is invalid or node-id is missing.
 */
export function parseFigmaDesignUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return null;
    }
    const fileKey = extractFileKey(parsed.pathname);
    const nodeIdHyphen = extractNodeIdHyphen(parsed.search);
    if (!fileKey || !nodeIdHyphen)
        return null;
    const nodeIdColon = nodeIdHyphen.replace(/-/g, ":");
    return {
        fileKey,
        nodeIdHyphen,
        nodeIdColon,
        url: parsed.origin + parsed.pathname + parsed.search,
    };
}
/**
 * Convert hyphen node ID to colon format.
 */
export function nodeIdHyphenToColon(nodeIdHyphen) {
    return String(nodeIdHyphen).replace(/-/g, ":");
}
/**
 * Validate and exit with a helpful message if URL is missing node-id.
 */
export function requireNodeId(url) {
    const parts = parseFigmaDesignUrl(url);
    if (!parts) {
        const msg = "Invalid or incomplete Figma URL. Required: design URL with query param node-id (e.g. ?node-id=42-15).";
        throw new Error(msg);
    }
    return parts;
}
//# sourceMappingURL=url.js.map