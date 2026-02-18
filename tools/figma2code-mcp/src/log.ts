/**
 * Minimal logging; --verbose enables tool calls and timings.
 */

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function isVerbose(): boolean {
  return verbose;
}

export function log(msg: string, data?: unknown): void {
  console.error(msg);
  if (data !== undefined && verbose) {
    console.error(JSON.stringify(data, null, 2));
  }
}

export function logVerbose(msg: string, data?: unknown): void {
  if (verbose) {
    console.error(msg);
    if (data !== undefined) console.error(JSON.stringify(data, null, 2));
  }
}
