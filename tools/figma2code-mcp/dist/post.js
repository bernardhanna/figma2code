/**
 * POST normalized AST to preview-only or generate endpoint.
 * Body matches UI: { ...ast, refineMode } for preview-only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function materializeInlineOverlay(ast) {
    const overlay = ast.meta && typeof ast.meta === "object" ? ast.meta.overlay : undefined;
    const src = overlay?.src;
    if (!src || !src.startsWith("data:image/") || !src.includes(";base64,")) {
        return ast;
    }
    const base64 = src.slice(src.indexOf(";base64,") + ";base64,".length);
    if (!base64) {
        return ast;
    }
    const slug = String(ast.slug || "section");
    const outDir = join(process.cwd(), "fixtures.out", slug);
    const outFile = join(outDir, "figma.desktop.png");
    mkdirSync(outDir, { recursive: true });
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    writeFileSync(outFile, bytes);
    return {
        ...ast,
        meta: {
            ...(ast.meta || {}),
            overlay: {
                ...(overlay || {}),
                src: `/fixtures.out/${slug}/figma.desktop.png`,
            },
        },
    };
}
/**
 * POST AST to the given URL. For preview-only, body includes refineMode.
 */
export async function postAst(options) {
    const { endpoint, ast, refineMode, timeoutMs = 60_000 } = options;
    const preparedAst = materializeInlineOverlay(ast);
    const body = { ...preparedAst };
    if (refineMode !== undefined) {
        body.refineMode = refineMode;
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(t);
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        }
        catch {
            json = undefined;
        }
        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                body: text,
                json,
                error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
            };
        }
        return {
            ok: true,
            status: res.status,
            body: text,
            json,
        };
    }
    catch (e) {
        clearTimeout(t);
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            status: 0,
            error: message,
        };
    }
}
//# sourceMappingURL=post.js.map