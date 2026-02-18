export function buildSseEvent(eventName, payload) {
  const event = String(eventName || "message").trim() || "message";
  const data = JSON.stringify(payload || {});
  return `event: ${event}\ndata: ${data}\n\n`;
}
