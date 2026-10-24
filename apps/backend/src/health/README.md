# Health Check Module

Comprehensive health check endpoints designed for load balancers (AWS ALB, NGINX, HAProxy), container orchestrators (Docker, Kubernetes, ECS), and monitoring systems (Prometheus, Grafana, CloudWatch).

## Endpoints

| Endpoint | Type | Description | Used By |
|---|---|---|---|
| `GET /health` | Full | Database, Redis, Stellar Horizon, and memory | Monitoring, smoke tests |
| `GET /health/live` | Liveness | Process alive, not shutting down (no deps) | Docker HEALTHCHECK, K8s livenessProbe, ECS |
| `GET /health/ready` | Readiness | Critical deps (DB, Redis) ready for traffic | ALB target group, K8s readinessProbe |
| `GET /health/startup` | Startup | Application initialized successfully | K8s startupProbe |
| `GET /health/environment` | Info | Blue/green deployment environment | CI/CD, blue-green deployment |
| `GET /health/version` | Info | App version, uptime, system info | Monitoring dashboards |

## Health Checks

| Check | Full | Ready | Description |
|---|---|---|---|
| Database | ✅ | ✅ | PostgreSQL connection via TypeORM ping |
| Redis | ✅ | ✅ | Set/get test value with 1s TTL |
| Memory Heap | ✅ | ❌ | V8 heap < 150MB |
| Memory RSS | ✅ | ❌ | Resident Set Size < 300MB |
| Stellar Horizon | ✅ | ❌ | HTTP `GET` to Horizon `/health` with a 2-second timeout; critical by default |
| Disk Usage | ✅ | ❌ | Memory-based disk usage < 90% |
| Elasticsearch | ✅ | ❌ | Cluster health (skipped if not configured) |

## Response Formats

### Liveness (200 OK)
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "checks": {
    "process": { "status": "up", "message": "Process alive" }
  }
}
```

### Readiness (200 OK)
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "up", "latencyMs": 2 }
  }
}
```

### Full (200 OK)
Standard Terminus format with all dependency checks.

### Environment
```json
{
  "active": "blue",
  "inactive": "green",
  "region": "us-east-1",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Version
```json
{
  "version": "1.0.0",
  "uptime": 3600,
  "environment": "production",
  "nodeVersion": "v20.0.0",
  "platform": "linux",
  "memoryUsage": { "rss": 123456789, "heapTotal": 98765432, "heapUsed": 654321 },
  "startTime": "2025-01-01T00:00:00.000Z",
  "environmentName": "blue"
}
```

## Probe Configuration

### Docker
```dockerfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/live', ...)"
```

### Docker Compose
```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:3000/health/live"]
  interval: 15s
  timeout: 5s
  retries: 3
  start_period: 10s
```

### Kubernetes
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 15
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 2

startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  initialDelaySeconds: 0
  periodSeconds: 5
  failureThreshold: 30
```

### AWS ALB Target Group
```hcl
health_check {
  path                = "/health/ready"
  healthy_threshold   = 2
  unhealthy_threshold = 3
  timeout             = 5
  interval            = 15
  matcher             = "200"
}
```

### AWS ECS Task Definition
```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -sf http://localhost:3000/health/live || exit 1"],
    "interval": 15,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 10
  }
}
```

### NGINX
```nginx
upstream backend {
    server backend1:3000;
    server backend2:3000;
}

server {
    location /health/ {
        access_log off;
        proxy_pass http://backend;
        proxy_connect_timeout 1s;
        proxy_read_timeout 1s;
    }

    location /health/live {
        access_log off;
        proxy_pass http://backend;
        proxy_connect_timeout 1s;
        proxy_read_timeout 1s;
    }
}
```

### HAProxy
```
backend backend
    balance roundrobin
    option httpchk GET /health/ready
    http-check expect status 200
    server backend1 backend1:3000 check
    server backend2 backend2:3000 check
```

## Prometheus Metrics

The module exposes health-specific metrics via the `/metrics` endpoint:

- `health_check_up{probe="full"}` - 1 if full health check passes
- `health_check_duration_seconds{probe, status}` - Health check latency histogram
- `health_check_status{probe}` - Custom gauge per probe type

## CI/CD Smoke Tests

```bash
# Default full health check
./scripts/health-check.sh

# Specific probes
PROBE=live ./scripts/health-check.sh
PROBE=ready ./scripts/health-check.sh
PROBE=startup ./scripts/health-check.sh
PROBE=env ./scripts/health-check.sh
PROBE=version ./scripts/health-check.sh

# Custom endpoint
API_URL=https://api.scoopdope.example.com PROBE=live ./scripts/health-check.sh
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT_NAME` | `NODE_ENV` | Blue/green environment name |
| `STELLAR_HORIZON_URL` | Network-specific Horizon URL | Horizon base URL; health checks call its `/health` path |
| `STELLAR_HEALTH_CRITICAL` | `true` | Set `false` to report Horizon failures as warning-only |
| `ELASTICSEARCH_NODE` | `http://localhost:9200` | ES cluster endpoint |
| `ELASTICSEARCH_API_KEY` | `` | ES API key |

## Graceful Shutdown

The health service supports graceful shutdown for load balancer integration:

```typescript
// On SIGTERM/SIGINT, set shutting down flag
// health/live will return 503, triggering ALB/ECS to drain connections
healthService.setShuttingDown(true);
```

## Blue-Green Deployment

The `/health/environment` endpoint returns the current deployment environment:

```json
{
  "active": "blue",
  "inactive": "green",
  "region": "us-east-1",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

Used by CI/CD pipelines to determine which target group to route traffic to during blue-green deployments.
