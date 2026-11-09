/* Same-origin production API. No preview account or browser-local authorization. */
window.SAI_CONFIG = Object.freeze({
  mode: 'http',
  apiBase: '/api/v1',
  roomId: 'sai-room',
  staleAfterMs: 90000,
  pollIntervalMs: 30000,
  stream: false,
});
