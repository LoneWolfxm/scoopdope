export const HEALTH_CACHE_TTL_MS = 30_000;

export const DISK_HEALTH_THRESHOLD_PERCENT = 0.9;

export const MEMORY_HEAP_THRESHOLD_BYTES = 150 * 1024 * 1024;
export const MEMORY_RSS_THRESHOLD_BYTES = 300 * 1024 * 1024;

export const STELLAR_HORIZON_TIMEOUT_MS = 2_000;
export const STELLAR_SOROBAN_TIMEOUT_MS = 5_000;
export const ELASTICSEARCH_TIMEOUT_MS = 3_000;

export const LOAD_BALANCER_HEALTH_CHECK_PATH = '/health';
export const LIVENESS_PROBE_PATH = '/health/live';
export const READINESS_PROBE_PATH = '/health/ready';
export const STARTUP_PROBE_PATH = '/health/startup';
export const ENVIRONMENT_PATH = '/health/environment';
export const VERSION_PATH = '/health/version';
