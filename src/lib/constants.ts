export const AGENT_INIT_TIMEOUT_MS = 60_000;
/** Client must wait longer than agent init so we don't abort a healthy spawn. */
export const CHAT_FETCH_TIMEOUT_MS = AGENT_INIT_TIMEOUT_MS + 5_000;
export const LIVE_EVENT_TTL_MS = 120_000;
export const SSE_DEBOUNCE_MS = 150;
export const SSE_KEEPALIVE_MS = 12_000;
export const SSE_RECONNECT_BASE_MS = 1_000;
export const SSE_RECONNECT_MAX_MS = 15_000;
export const FILE_POLL_MS = 800;
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
export const MODELS_FETCH_TIMEOUT_MS = 30_000;
export const PROCESS_EXIT_SETTLE_MS = 300;
export const STREAMING_HEALTH_CHECK_MS = 10_000;
export const DEFAULT_PORT = 3100;
