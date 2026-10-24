import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, register } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;
  readonly credentialIssuedTotal: Counter;
  readonly bstMintedTotal: Counter;
  readonly stellarRpcLatency: Histogram;
  readonly stellarRpcTimeouts: Counter;
  readonly cacheHitsTotal: Counter;
  readonly cacheMissesTotal: Counter;
  readonly healthCheckDuration: Histogram;
  readonly healthCheckStatus: Gauge;
  readonly uptimeGauge: Gauge;
  readonly activeConnections: Gauge;
  readonly databasePoolSize: Gauge;
  readonly databasePoolUtilization: Gauge;
  readonly databasePoolWaitingCount: Gauge;
  readonly redisConnectedClients: Gauge;
  readonly enrollmentsTotal: Counter;
  readonly coursesCompletedTotal: Counter;
  readonly recommendationsServedTotal: Counter;
  readonly activeUsersGauge: Gauge;

  constructor() {
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [register],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [register],
    });

    this.credentialIssuedTotal = new Counter({
      name: 'credential_issued_total',
      help: 'Total number of credentials issued',
      labelNames: ['credential_type'],
      registers: [register],
    });

    this.bstMintedTotal = new Counter({
      name: 'bst_minted_total',
      help: 'Total number of BST tokens minted',
      labelNames: ['user_id'],
      registers: [register],
    });

    this.stellarRpcLatency = new Histogram({
      name: 'stellar_rpc_latency_seconds',
      help: 'Stellar RPC call latency in seconds',
      labelNames: ['method', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [register],
    });

    this.stellarRpcTimeouts = new Counter({
      name: 'stellar_rpc_timeouts_total',
      help: 'Total number of timed out Stellar RPC calls',
      labelNames: ['method'],
      registers: [register],
    });

    this.cacheHitsTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache'],
      registers: [register],
    });

    this.cacheMissesTotal = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache'],
      registers: [register],
    });

    this.healthCheckDuration = new Histogram({
      name: 'health_check_duration_seconds',
      help: 'Duration of health check probes in seconds',
      labelNames: ['probe', 'status'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [register],
    });

    this.healthCheckStatus = new Gauge({
      name: 'health_check_up',
      help: 'Health check status per probe type (1=up, 0=down)',
      labelNames: ['probe'],
      registers: [register],
    });

    this.uptimeGauge = new Gauge({
      name: 'app_uptime_seconds',
      help: 'Application uptime in seconds',
      registers: [register],
    });

    this.activeConnections = new Gauge({
      name: 'app_active_connections',
      help: 'Number of active connections',
      registers: [register],
    });

    this.databasePoolSize = new Gauge({
      name: 'app_database_pool_size',
      help: 'Database connection pool size',
      labelNames: ['state'],
      registers: [register],
    });

    this.databasePoolUtilization = new Gauge({
      name: 'app_database_pool_utilization',
      help: 'Database connection pool utilization ratio (active / max)',
      registers: [register],
    });

    this.databasePoolWaitingCount = new Gauge({
      name: 'app_database_pool_waiting_count',
      help: 'Number of requests waiting for a database connection',
      registers: [register],
    });

    this.redisConnectedClients = new Gauge({
      name: 'app_redis_connected_clients',
      help: 'Number of Redis connected clients',
      registers: [register],
    });

    this.enrollmentsTotal = new Counter({
      name: 'enrollments_total',
      help: 'Total number of course enrollments',
      labelNames: ['course_id', 'level'],
      registers: [register],
    });

    this.coursesCompletedTotal = new Counter({
      name: 'courses_completed_total',
      help: 'Total number of course completions',
      labelNames: ['course_id', 'level'],
      registers: [register],
    });

    this.recommendationsServedTotal = new Counter({
      name: 'recommendations_served_total',
      help: 'Total number of recommendation responses served',
      labelNames: ['count'],
      registers: [register],
    });

    this.activeUsersGauge = new Gauge({
      name: 'app_active_users',
      help: 'Number of active users by time window',
      labelNames: ['window'],
      registers: [register],
    });

    setInterval(() => {
      this.uptimeGauge.set(process.uptime());
    }, 15000);
  }

  incrementHttpRequests(method: string, route: string, statusCode: number) {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
  }

  observeHttpRequestDuration(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ) {
    this.httpRequestDuration.observe(
      { method, route, status_code: statusCode.toString() },
      durationSeconds,
    );
  }

  incrementCredentialIssued(credentialType: string) {
    this.credentialIssuedTotal.inc({ credential_type: credentialType });
  }

  incrementBstMinted(userId: string) {
    this.bstMintedTotal.inc({ user_id: userId });
  }

  observeStellarRpcLatency(method: string, status: string, durationSeconds: number) {
    this.stellarRpcLatency.observe({ method, status }, durationSeconds);
  }

  incrementStellarRpcTimeout(method: string) {
    this.stellarRpcTimeouts.inc({ method });
  }

  incrementCacheHit(cache: string) {
    this.cacheHitsTotal.inc({ cache });
  }

  incrementCacheMiss(cache: string) {
    this.cacheMissesTotal.inc({ cache });
  }

  observeHealthCheckDuration(probe: string, status: string, durationSeconds: number) {
    this.healthCheckDuration.observe({ probe, status }, durationSeconds);
  }

  setHealthCheckStatus(probe: string, up: boolean) {
    this.healthCheckStatus.set({ probe }, up ? 1 : 0);
  }

  setActiveConnections(count: number) {
    this.activeConnections.set(count);
  }

  setDatabasePoolSize(state: string, size: number) {
    this.databasePoolSize.set({ state }, size);
  }

  setDatabasePoolUtilization(ratio: number) {
    this.databasePoolUtilization.set(ratio);
  }

  setDatabasePoolWaitingCount(count: number) {
    this.databasePoolWaitingCount.set(count);
  }

  /**
   * Convenience setter used by DatabasePoolService to publish a full pool snapshot.
   */
  setDatabasePoolStats(stats: {
    total: number;
    idle: number;
    active: number;
    waiting: number;
    max: number;
  }) {
    this.databasePoolSize.set({ state: 'total' }, stats.total);
    this.databasePoolSize.set({ state: 'idle' }, stats.idle);
    this.databasePoolSize.set({ state: 'active' }, stats.active);
    this.databasePoolSize.set({ state: 'max' }, stats.max);
    this.databasePoolUtilization.set(stats.max > 0 ? stats.active / stats.max : 0);
    this.databasePoolWaitingCount.set(stats.waiting);
  }

  setRedisConnectedClients(count: number) {
    this.redisConnectedClients.set(count);
  }

  incrementEnrollment(courseId: string, level: string) {
    this.enrollmentsTotal.inc({ course_id: courseId, level });
  }

  incrementCourseCompleted(courseId: string, level: string) {
    this.coursesCompletedTotal.inc({ course_id: courseId, level });
  }

  incrementRecommendationsServed(count: number) {
    this.recommendationsServedTotal.inc({ count: count.toString() });
  }

  setActiveUsers(window: string, count: number) {
    this.activeUsersGauge.set({ window }, count);
  }
}
