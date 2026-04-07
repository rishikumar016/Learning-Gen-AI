/**
 * Set up an SSE (Server-Sent Events) response.
 * @param {import('express').Response} res
 */
export function setupSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable buffering in nginx
  });
  res.flushHeaders();
}

/**
 * Send a named SSE event.
 * @param {import('express').Response} res
 * @param {string} event  – event name
 * @param {unknown} data   – will be JSON-stringified
 */
export function sendSSEEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
}
