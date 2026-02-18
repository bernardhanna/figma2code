/**
 * Minimal logging; --verbose enables tool calls and timings.
 */
let verbose = false;
export function setVerbose(v) {
    verbose = v;
}
export function isVerbose() {
    return verbose;
}
export function log(msg, data) {
    console.error(msg);
    if (data !== undefined && verbose) {
        console.error(JSON.stringify(data, null, 2));
    }
}
export function logVerbose(msg, data) {
    if (verbose) {
        console.error(msg);
        if (data !== undefined)
            console.error(JSON.stringify(data, null, 2));
    }
}
//# sourceMappingURL=log.js.map