# Monitoring & Observability Guide

scoopdope uses a three-pillar observability stack: **Prometheus + Grafana** for metrics, **Winston** for structured logging, and **Sentry** for error tracking and performance profiling.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Prometheus Metrics](#prometheus-metrics)
  - [Exposed Metrics](#exposed-metrics)
  - [Adding Custom Metrics](#adding-custom-metrics)
- [Grafana Dashboard Setup](#grafana-dashboard-setup)
- [Log Aggregation with Winston](#log-aggregation-with-winston)
- [Health Checks](#health-checks)
- [Sentry Error Tracking](#sentry-error-tracking)
- [Alerting Rules & Thresholds](#alerting-rules--thresholds)

---

## Quick Start

Start the full monitoring stack (Prometheus + Grafana) alongside the backend:

```bash
# Start monitoring stack
docker compose -f docker-compose.monitoring.yml up -d

# Start backend (if not already running)
docker compose up -d backend postgres redis
```

| Service | URL | Credentials |
|---|---|---|
| Grafana | http://localhost:3002 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Metrics endpoint | http://localhost:3000/metrics | — |
| Health endpoint | http://localhost:3000/health | — |

---

## Prometheus Metrics

### How it works

`MetricsModule` registers `@willsoto/nestjs-prometheus` which mounts a `/metrics` endpoint. `MetricsInterceptor` is applied globally and automatically increments `http_requests_total` on every request. Prometheus scrapes this endpoint every **10 seconds** (configured in `infra/monitoring/prometheus.yml`).

### Exposed Metrics

#### Application metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests handled. Incremented automatically by `MetricsInterceptor` on every response. |
| `credential_issued_total` | Counter | `credential_type` | On-chain credentials issued via Stellar. Call `MetricsService.incrementCredentialIssued(type)` when issuing. |
| `bst_minted_total` | Counter | `user_id` | BST reward tokens minted. Call `MetricsService.incrementBstMinted(userId)` when minting. |
| `stellar_rpc_latency_seconds` | Histogram | `method`, `status` | Duration of every Soroban contract invocation, including retries. Status is `success`, `error`, or `timeout`. Buckets: 0.1s, 0.5s, 1s, 2s, 5s, 10s, 30s. |
| `stellar_rpc_timeouts_total` | Counter | `method` | Total timed-out Soroban contract invocations. |

#### Default Node.js / process metrics (auto-collected by prom-client)

| Metric | Description |
|---|---|
| `process_cpu_user_seconds_total` | CPU time in user mode |
| `process_resident_memory_bytes` | RSS memory usage |
| `nodejs_heap_size_total_bytes` | V8 heap total size |
| `nodejs_heap_size_used_bytes` | V8 heap used size |
| `nodejs_eventloop_lag_seconds` | Event loop lag (latency indicator) |
| `nodejs_active_handles_total` | Active libuv handles |
| `http_request_duration_seconds` | Request duration histogram (built-in) |

#### Useful PromQL queries

```promql
# HTTP error rate (5xx) over the last 5 minutes
rate(http_requests_total{status_code=~"5.."}[5m])

# Request rate by route
sum by (route) (rate(http_requests_total[1m]))

# Stellar RPC p50 / p95 / p99 latency by contract method
histogram_quantile(0.50, sum by (le, method) (rate(stellar_rpc_latency_seconds_bucket[5m])))
histogram_quantile(0.95, sum by (le, method) (rate(stellar_rpc_latency_seconds_bucket[5m])))
histogram_quantile(0.99, sum by (le, method) (rate(stellar_rpc_latency_seconds_bucket[5m])))

# Stellar RPC error and timeout rate (%)
100 * sum(rate(stellar_rpc_latency_seconds_count{status=~"error|timeout"}[5m]))
  / clamp_min(sum(rate(stellar_rpc_latency_seconds_count[5m])), 1e-9)

# Stellar RPC timeouts in the last 5 minutes
sum(increase(stellar_rpc_timeouts_total[5m]))

# Credentials issued per minute
rate(credential_issued_total[1m])

# Heap memory usage in MB
nodejs_heap_size_used_bytes / 1024 / 1024

# Event loop lag above 100ms
nodejs_eventloop_lag_seconds > 0.1
```

### Adding Custom Metrics

Inject `MetricsService` into any NestJS provider and call the appropriate method:

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class CredentialsService {
  constructor(private readonly metrics: MetricsService) {}

  async issueCredential(userId: string, courseId: string) {
    const start = Date.now();
    try {
      // ... issue credential on Stellar
      this.metrics.incrementCredentialIssued('course-completion');
      this.metrics.observeStellarRpcLatency(
        'issueCredential',
        'success',
        (Date.now() - start) / 1000,
      );
    } catch (err) {
      this.metrics.observeStellarRpcLatency(
        'issueCredential',
        'error',
        (Date.now() - start) / 1000,
      );
      throw err;
    }
  }
}
```

To add a brand-new metric, extend `MetricsService`:

```typescript
// In MetricsService constructor:
this.enrollmentTotal = new Counter({
  name: 'enrollment_total',
  help: 'Total course enrollments',
  labelNames: ['course_id'],
  registers: [register],
});

// New method:
incrementEnrollment(courseId: string) {
  this.enrollmentTotal.inc({ course_id: courseId });
}
```

---

## Grafana Dashboard Setup

### Auto-provisioned setup

When you run `docker compose -f docker-compose.monitoring.yml up -d`, Grafana automatically provisions:

- **Datasource:** Prometheus at `http://prometheus:9090` (configured in `infra/monitoring/grafana/provisioning/datasources/prometheus.yml`)
- **Dashboard:** NestJS metrics dashboard loaded from `infra/monitoring/grafana/dashboards/nestjs-metrics.json`

No manual setup is required. Navigate to http://localhost:3002 and the dashboard is ready.

### Manual datasource setup (non-Docker)

If running Grafana outside Docker:

1. Open Grafana → **Connections → Data sources → Add data source**
2. Select **Prometheus**
3. Set URL to `http://localhost:9090`
4. Click **Save & test**

### Importing the dashboard manually

1. Open Grafana → **Dashboards → Import**
2. Upload `infra/monitoring/grafana/dashboards/nestjs-metrics.json`
3. Select the Prometheus datasource
4. Click **Import**

### Dashboard panels

The pre-built dashboard (`nestjs-metrics.json`) includes:

| Panel | Query | Description |
|---|---|---|
| Request Rate | `rate(http_requests_total[1m])` | Requests per second |
| Error Rate | `rate(http_requests_total{status_code=~"5.."}[5m])` | 5xx errors per second |
| Credential Issuance | `rate(credential_issued_total[5m])` | Credentials issued per second |
| BST Minted | `rate(bst_minted_total[5m])` | Tokens minted per second |
| Stellar RPC p95 | `histogram_quantile(0.95, rate(stellar_rpc_latency_seconds_bucket[5m]))` | 95th percentile RPC latency |
| Stellar RPC p50/p95/p99 | Quantiles from `stellar_rpc_latency_seconds_bucket`, grouped by `method` | Contract invocation latency by percentile |
| Stellar RPC Error Rate | `status=~"error|timeout"` divided by all RPC calls | Percentage of failed or timed-out invocations |
| Stellar RPC Timeouts | `sum(increase(stellar_rpc_timeouts_total[5m]))` | Timed-out calls in the last 5 minutes |
| Heap Memory | `nodejs_heap_size_used_bytes / 1024 / 1024` | Heap usage in MB |
| Event Loop Lag | `nodejs_eventloop_lag_seconds` | Event loop latency |

### Production Prometheus scrape config

For production deployments where the backend is not on `host.docker.internal`, update `infra/monitoring/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'scoopdope-backend'
    static_configs:
      - targets: ['backend:3000']   # Docker service name
    metrics_path: '/metrics'
    scrape_interval: 10s
```

---

## Log Aggregation with Winston

### Configuration

Winston is configured in `apps/backend/src/common/logger/logger.module.ts`. The format and verbosity are controlled by two environment variables:

| Variable | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` | Minimum log level. Options: `error`, `warn`, `info`, `debug`, `verbose` |
| `NODE_ENV` | `development` | `production` → JSON format; anything else → colorized text |

### Log formats

**Development** (`NODE_ENV=development`):
```
2024-01-15T10:30:45.123Z info: [AuthService] User logged in
2024-01-15T10:30:45.124Z error: [StellarService] RPC call failed {"trace":"Error: ..."}
```

**Production** (`NODE_ENV=production`):
```json
{"timestamp":"2024-01-15T10:30:45.123Z","level":"info","message":"User logged in","context":"AuthService"}
{"timestamp":"2024-01-15T10:30:45.124Z","level":"error","message":"RPC call failed","context":"StellarService","trace":"Error: ..."}
```

JSON format is intentional for production: it makes logs parseable by log aggregators (CloudWatch, Datadog, Loki, etc.) without additional parsing rules.

### Using the logger in services

```typescript
import { Injectable } from '@nestjs/common';
import { CustomLoggerService } from '../common/logger';

@Injectable()
export class MyService {
  constructor(private readonly logger: CustomLoggerService) {
    this.logger.setContext('MyService');
  }

  async doWork() {
    this.logger.info('Starting work');
    try {
      // ...
      this.logger.debug('Intermediate state', 'MyService');
    } catch (err) {
      this.logger.error('Work failed', err.stack, 'MyService');
    }
  }
}
```

### Log aggregation in production

All logs go to **stdout** — the standard for containerised workloads. Plug in your preferred aggregator:

**AWS CloudWatch (ECS):**
```json
{
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "/scoopdope/backend",
    "awslogs-region": "us-east-1",
    "awslogs-stream-prefix": "backend"
  }
}
```

**Grafana Loki (Docker):**
```yaml
# docker-compose.monitoring.yml addition
loki:
  image: grafana/loki:latest
  ports: ["3100:3100"]

promtail:
  image: grafana/promtail:latest
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
  command: -config.file=/etc/promtail/config.yml
```

Then add Loki as a datasource in Grafana and use LogQL to query:
```logql
{container="scoopdope-backend"} | json | level="error"
```

**Kubernetes:**
Logs are automatically collected by your cluster's logging agent (Fluentd, Fluent Bit) from stdout. No additional configuration needed in the application.

---

## Health Checks

`GET /health` checks PostgreSQL, Redis, memory, and Stellar Horizon. It returns `200 OK` when critical checks pass, or `503 Service Unavailable` when a critical check fails.

| Check | Threshold | What it tests |
|---|---|---|
| `database` | — | PostgreSQL ping via TypeORM |
| `memory_heap` | 150 MB | V8 heap usage |
| `memory_rss` | 300 MB | Process RSS memory |
| `redis` | — | Set + get a test key in Redis |
| `stellar` | 2 seconds | HTTP `GET` to `$STELLAR_HORIZON_URL/health`; failure is critical by default |

Stellar severity is controlled by `STELLAR_HEALTH_CRITICAL`:

- `true` (default): a Horizon failure reports `checks.stellar.status: "down"` and makes `/health` return `503`.
- `false`: a Horizon failure is reported as `checks.stellar.status: "down"`, but is warning-only and does not make the overall health status fail.

`STELLAR_HORIZON_URL` selects the Horizon base URL. It defaults to the testnet Horizon endpoint, or the mainnet endpoint when `STELLAR_NETWORK=mainnet`. The health request timeout is fixed at 2 seconds.

**Example healthy response:**
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "up" },
    "memory_heap": { "status": "up" },
    "memory_rss": { "status": "up" },
    "redis": { "status": "up" },
    "stellar": { "status": "up", "latencyMs": 42 }
  }
}
```

Use this endpoint for:
- Docker / Kubernetes liveness and readiness probes
- Load balancer health checks
- Uptime monitoring (e.g. UptimeRobot, Pingdom)

---

## Sentry Error Tracking

### Backend setup (`@sentry/nestjs`)

Sentry is initialised in `apps/backend/src/instrument.ts` — this file is imported first in `main.ts` before any other module loads.

```typescript
// instrument.ts (already configured)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.GIT_COMMIT_SHA || 'unknown',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
```

Set `SENTRY_DSN` in your `.env` to activate. Leave it empty to disable Sentry entirely.

**What gets captured automatically:**
- Unhandled exceptions and promise rejections
- HTTP request traces (10% sample rate in production)
- CPU profiles (10% sample rate in production)
- Sensitive data is stripped: `cookies` and `authorization` headers are removed before sending

### Frontend setup (`@sentry/nextjs`)

The frontend uses three Sentry config files:

| File | Runs in | Purpose |
|---|---|---|
| `sentry.client.config.ts` | Browser | Error tracking + Session Replay |
| `sentry.server.config.ts` | Node.js (SSR) | Error tracking + traces |
| `sentry.edge.config.ts` | Edge runtime | Error tracking + traces |

Set `NEXT_PUBLIC_SENTRY_DSN` in the frontend environment to activate.

**Session Replay** is enabled on the client:
- `replaysSessionSampleRate: 0.1` — 10% of sessions are recorded
- `replaysOnErrorSampleRate: 1.0` — 100% of sessions with errors are recorded
- All text is masked and media is blocked by default

### Linking releases to source maps

Set `GIT_COMMIT_SHA` (backend) and `NEXT_PUBLIC_GIT_COMMIT_SHA` (frontend) to the current git SHA at build time. In CI this is done automatically:

```yaml
# .github/workflows/ci.yml (already configured)
env:
  GIT_COMMIT_SHA: ${{ github.sha }}
  NEXT_PUBLIC_GIT_COMMIT_SHA: ${{ github.sha }}
```

This links Sentry errors to the exact commit, enabling source map resolution.

### Manually capturing errors

```typescript
import * as Sentry from '@sentry/nestjs';

try {
  await riskyOperation();
} catch (err) {
  Sentry.captureException(err, {
    tags: { component: 'StellarService' },
    extra: { courseId, userId },
  });
  throw err;
}
```

---

## Alerting Rules & Thresholds

Add these rules to `infra/monitoring/prometheus.yml` under an `alerting` + `rule_files` block, or configure them directly in Grafana's alerting UI.

```yaml
# infra/monitoring/alerts.yml
groups:
  - name: scoopdope-backend
    rules:

      # High 5xx error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High HTTP error rate"
          description: "More than 5% of requests are returning 5xx errors for 2 minutes."

      # Stellar RPC p95 latency above 5 seconds
      - alert: StellarRpcHighLatency
        expr: histogram_quantile(0.95, sum(rate(stellar_rpc_latency_seconds_bucket[5m])) by (le)) > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Stellar RPC p95 latency above 5s"
          description: "95th percentile Stellar RPC latency has exceeded 5 seconds for 5 minutes."

      # High heap memory usage
      - alert: HighHeapMemory
        expr: nodejs_heap_size_used_bytes > 120 * 1024 * 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Node.js heap usage above 120 MB"
          description: "Heap is approaching the 150 MB health check threshold."

      # Event loop lag
      - alert: EventLoopLag
        expr: nodejs_eventloop_lag_seconds > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Event loop lag above 100ms"
          description: "The Node.js event loop is lagging, indicating CPU saturation or blocking I/O."

      # Backend down (no scrape data)
      - alert: BackendDown
        expr: up{job="scoopdope-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Backend is unreachable"
          description: "Prometheus cannot scrape the /metrics endpoint."
```

To load the rules file, reference it in `prometheus.yml`:

```yaml
# infra/monitoring/prometheus.yml
rule_files:
  - "alerts.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

### Threshold summary

| Signal | Warning | Critical | Source |
|---|---|---|---|
| 5xx error rate | > 1% | > 5% | `http_requests_total` |
| Stellar RPC p95 latency | > 2s | > 5s | `stellar_rpc_latency_seconds` |
| Heap memory | > 120 MB | > 150 MB (health check fails) | `nodejs_heap_size_used_bytes` |
| RSS memory | — | > 300 MB (health check fails) | `process_resident_memory_bytes` |
| Event loop lag | > 100ms | > 500ms | `nodejs_eventloop_lag_seconds` |
| Backend scrape | — | `up == 0` | Prometheus `up` metric |

---

## ALB Access Logs

The Application Load Balancer writes an access log entry for every HTTP request that reaches the platform. These logs are the authoritative record for security forensics and traffic analysis, and back the compliance controls described in `SECURITY.md`.

### Where logs are stored

Access logs are enabled on the ALB resource in the Terraform module (`access_logs { bucket = var.log_bucket, enabled = true }`). The destination bucket is configured with:

| Setting | Value |
|---|---|
| Bucket | `var.log_bucket` (name set via `var.log_bucket_name`) |
| Prefix | `alb/` |
| Encryption | SSE-S3 (AES-256) server-side encryption |
| Versioning | Enabled |
| Retention | 90 days (`var.log_retention_days`, default `90`) via an S3 lifecycle rule that expires objects and non-current versions |

Log objects are delivered as gzipped JSON, one object per ALB node per interval, under `s3://<log_bucket>/alb/`.

### Querying with Athena

Create an external table over the log prefix (adjust the bucket name and region):

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS alb_access_logs (
  type string,
  time string,
  elb string,
  client_ip string,
  client_port int,
  target_ip string,
  target_port int,
  request_processing_time double,
  target_processing_time double,
  response_processing_time double,
  elb_status_code int,
  target_status_code string,
  received_bytes bigint,
  sent_bytes bigint,
  request_verb string,
  request_url string,
  request_proto string,
  user_agent string,
  ssl_cipher string,
  ssl_protocol string,
  target_group_arn string,
  trace_id string,
  domain_name string,
  chosen_cert_arn string,
  matched_rule_priority string,
  request_creation_time string,
  actions_executed string,
  redirect_url string,
  error_reason string
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.RegexSerDe'
WITH SERDEPROPERTIES (
  'serialization.format' = '1',
  'input.regex' = '([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*):([0-9]*) ([^ ]*)[:-]([0-9]*) ([-.0-9]*) ([-.0-9]*) ([-.0-9]*) ([-0-9]*) ([-0-9]*) ([-0-9]*) \"([^ ]*) ([^ ]*) (- |[^ ]*)\" \"([^\"]*)\" ([A-Z0-9-]+) ([A-Za-z0-9.-]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" \"([^\"]*)\" ([-.0-9]*) ([^ ]*) \"([^\"]*)\" \"([^\"]*)\" ?([^ ]*)'
)
LOCATION 's3://<log_bucket>/alb/'
TBLPROPERTIES ('skip.header.line.count' = '0');
```

**Top client IPs (last 7 days):**

```sql
SELECT client_ip, count(*) AS requests
FROM alb_access_logs
WHERE from_iso8601_timestamp(time) > now() - interval '7' day
GROUP BY client_ip
ORDER BY requests DESC
LIMIT 20;
```

**5xx error rate by hour:**

```sql
SELECT date_trunc('hour', from_iso8601_timestamp(time)) AS hour,
       count_if(elb_status_code >= 500) * 100.0 / count(*) AS pct_5xx,
       count(*) AS requests
FROM alb_access_logs
WHERE from_iso8601_timestamp(time) > now() - interval '24' hour
GROUP BY 1
ORDER BY 1 DESC;
```

**Slow requests (target processing time above 2s):**

```sql
SELECT time, client_ip, request_verb, request_url, target_processing_time, elb_status_code
FROM alb_access_logs
WHERE target_processing_time > 2.0
ORDER BY target_processing_time DESC
LIMIT 50;
```

**Most requested paths:**

```sql
SELECT regexp_extract(request_url, '^[^?]*', 0) AS path, count(*) AS requests
FROM alb_access_logs
WHERE from_iso8601_timestamp(time) > now() - interval '24' hour
GROUP BY 1
ORDER BY requests DESC
LIMIT 20;
```

### Querying with CloudWatch Logs Insights

If the bucket is also subscribed to CloudWatch Logs (or logs are shipped via a subscription filter), use Logs Insights:

```text
# Top client IPs
fields @timestamp, client_ip
| stats count(*) as requests by client_ip
| sort requests desc
| limit 20
```

```text
# 5xx rate per 5 minutes
fields @timestamp, elb_status_code
| stats count(*) as total, sum(elb_status_code >= 500) as errors by bin(5m)
| fields bin(5m) as window, errors * 100.0 / total as pct_5xx
```

```text
# Slow requests
fields @timestamp, client_ip, request_url, target_processing_time
| filter target_processing_time > 2.0
| sort target_processing_time desc
| limit 50
```

```text
# Most requested paths
fields request_url
| parse request_url /^(?<path>[^?]*)/
| stats count(*) as requests by path
| sort requests desc
| limit 20
```

### Verifying the change

Before applying, run `terraform plan` in the environment directory and confirm it shows **no destructive changes** — only the new log bucket, its encryption/versioning/lifecycle configuration, and the `access_logs` block on the ALB should appear. After applying, wait for the first log delivery interval and run one of the queries above to confirm logs are queryable.

---

## OpenTelemetry Distributed Tracing
=======

scoopdope uses the [OpenTelemetry Node.js SDK](https://opentelemetry.io/docs/instrumentation/js/) to trace all API requests end-to-end, including PostgreSQL queries and Redis operations.

### How it works

`src/tracing.ts` is loaded before the NestJS bootstrap in `main.ts`. It initialises the OTel SDK with:

| Instrumentation | What it traces |
|---|---|
| `HttpInstrumentation` | All inbound HTTP requests and outbound `http`/`https` calls |
| `PgInstrumentation` | Every PostgreSQL query executed via `pg` (used by TypeORM) |
| `IORedisInstrumentation` | Every Redis command executed via `ioredis` |

### Exporter

Traces are exported via **OTLP/HTTP** (default: `http://localhost:4318/v1/traces`).

Override with the environment variable:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
```

### Running Jaeger locally

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Open the Jaeger UI at `http://localhost:16686` and select the `scoopdope-backend` service.

### AWS X-Ray

To export to AWS X-Ray, replace the `OTLPTraceExporter` in `src/tracing.ts` with the [AWS Distro for OpenTelemetry (ADOT) collector](https://aws-otel.github.io/) and set:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP trace collector URL |
| `GIT_COMMIT_SHA` | `0.0.0` | Injected by CI; used as `service.version` resource attribute |
