# Kubernetes Deployment Configuration

This directory contains Kubernetes manifests for deploying the Scoopdope backend application.

## Overview

The Scoopdope backend is configured for production Kubernetes deployments with:
- **Liveness Probe**: Detects if the process is alive (3 failures, 10-second intervals, 5-second timeout)
- **Readiness Probe**: Detects if the service is ready to accept traffic (15-second initial delay, 5-second timeout)
- **Startup Probe**: Handles slow-starting applications (30 retries at 10-second intervals)
- **Resource Limits**: Memory and CPU constraints to prevent resource exhaustion
- **Pod Anti-Affinity**: Spreads pods across nodes for high availability
- **Security Context**: Non-root user, read-only root filesystem, capability dropping

## Probe Rationale

### Why probes do not use plain HTTP

The liveness and readiness probes deliberately avoid `httpGet` with the default
`scheme: HTTP`. In production the service is expected to run behind (or with)
TLS, and if TLS termination is moved inside the pod the plain-HTTP probe would
start failing and cause spurious pod restarts. To keep the probes independent of
the transport configuration, they are defined as `exec` probes that issue an
HTTPS request to `https://localhost:3000/health/...` with certificate
verification disabled (`-k`). This works whether TLS is terminated in-pod or by
an ingress, and it never falls back to unencrypted HTTP in production.

If you prefer `httpGet` probes, set `scheme: HTTPS` explicitly on every probe
(`livenessProbe`, `readinessProbe`, and `startupProbe`) — never rely on the
default HTTP scheme in production manifests.

### Timeout and failure threshold choices

- **`timeoutSeconds: 5`** — the health endpoints may touch the database and
  Redis; 5 seconds gives them room to respond under load without masking a
  genuinely hung process.
- **`failureThreshold: 3`** — a pod is restarted only after three consecutive
  failed liveness checks (≈30 seconds of sustained failure), which avoids
  restart loops caused by transient blips.
- **`periodSeconds: 10`** (liveness) and **`5`** (readiness) — frequent enough
  to react quickly, infrequent enough to keep probe overhead negligible.
- **`initialDelaySeconds` / startup probe** — the startup probe allows up to
  300 seconds for slow initialization, so the liveness probe does not kill a
  pod that is still booting.

### Keep overlays consistent

The base manifest and the **staging** and **production** overlays
(`infra/kubernetes/overlays/*`) must define the same probe scheme, timeouts,
and thresholds. When changing probe configuration, update the base manifest and
both overlays in the same change so staging and production never diverge.
=======

## Files

### 1. `backend-deployment.yaml`
Main deployment configuration for the backend service.

**Key Configuration:**
- **Replicas**: 3 (configurable for your needs)
- **Image**: `scoopdope/backend:latest` (update with your registry)
- **Liveness Probe** (exec, HTTPS — no plain HTTP in production):
  - Command: `wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:3000/health/liveness`
  - Initial Delay: 30 seconds
  - Period: 10 seconds
  - Timeout: 5 seconds
  - Failure Threshold: 3
- **Readiness Probe** (exec, HTTPS):
  - Command: `wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:3000/health/readiness`
  - Initial Delay: 15 seconds
  - Period: 5 seconds
  - Timeout: 5 seconds
  - Failure Threshold: 3
- **Startup Probe** (exec, HTTPS):
  - Command: `wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:3000/health/startup`
  - Period: 10 seconds
  - Timeout: 5 seconds
  - Failure Threshold: 30 (allows up to 300 seconds for startup)
- **Resource Requests**:
  - Memory: 256Mi
  - CPU: 250m
- **Resource Limits**:
  - Memory: 512Mi
  - CPU: 1000m

### 2. `backend-service.yaml`
ClusterIP service for internal communication.

**Configuration:**
- **Type**: ClusterIP (internal service)
- **Port**: 80 (HTTP)
- **Target Port**: 3000 (backend service port)

### 3. `backend-configmap.yaml`
Non-sensitive configuration values.

**Contains:**
- Logging level
- CORS settings
- Rate limiting configuration
- AWS region
- Elasticsearch endpoint
- Database connection pool settings
- Health check path configuration

### 4. `backend-secret.yaml`
Sensitive data (credentials, tokens, API keys).

**IMPORTANT**: This is a template. Before deploying:
1. Replace all `REPLACE_WITH_ACTUAL_*` values with actual credentials
2. Use proper secret management (e.g., Sealed Secrets, External Secrets, Vault)
3. Never commit actual secrets to version control

### 5. `backend-serviceaccount.yaml`
Kubernetes ServiceAccount for RBAC (Role-Based Access Control).

## Prerequisites

- Kubernetes cluster (v1.19+)
- PostgreSQL database (external or in-cluster)
- Redis (external or in-cluster)
- Elasticsearch (external or in-cluster)
- Docker image built and pushed to registry

## Deployment Instructions

### 1. Update Container Image
Replace the image in `backend-deployment.yaml` with your registry:
```yaml
image: your-registry/scoopdope-backend:v1.0.0
```

### 2. Configure Secrets
Update `backend-secret.yaml` with actual values:
```bash
# Option A: Manual update (less secure)
# Edit backend-secret.yaml and replace REPLACE_WITH_ACTUAL_* values

# Option B: Using kubectl (recommended)
kubectl create secret generic scoopdope-backend-secrets \
  --from-literal=DATABASE_PASSWORD=your_password \
  --from-literal=JWT_SECRET=your_secret \
  # ... other values
```

### 3. Deploy Resources
```bash
# Deploy ServiceAccount
kubectl apply -f backend-serviceaccount.yaml

# Deploy ConfigMap
kubectl apply -f backend-configmap.yaml

# Deploy Secret (if using kubectl method)
kubectl apply -f backend-secret.yaml

# Deploy Service
kubectl apply -f backend-service.yaml

# Deploy Application
kubectl apply -f backend-deployment.yaml
```

### 4. Verify Deployment
```bash
# Check deployment status
kubectl get deployment scoopdope-backend -w

# Check pod status
kubectl get pods -l app=scoopdope-backend

# Check logs
kubectl logs -l app=scoopdope-backend --tail=100 -f

# Check service
kubectl get svc scoopdope-backend

# Describe deployment for details
kubectl describe deployment scoopdope-backend
```

## Health Check Endpoints

The backend exposes the following health check endpoints:

### `/health/liveness`
Indicates if the process is alive. Used by Kubernetes liveness probe.
- Returns `200 OK` if the process is healthy
- Returns `503 Service Unavailable` if the process is shutting down

### `/health/readiness`
Indicates if the service is ready to accept traffic. Checks:
- Database connectivity
- Redis connectivity
- Returns `200 OK` only if all dependencies are healthy

### `/health/startup`
Indicates if the application has completed initialization.
- Returns `200 OK` once the application is fully initialized

## Resource Configuration

### Recommended Production Settings

**Small Cluster (dev/staging):**
```yaml
requests:
  memory: "256Mi"
  cpu: "250m"
limits:
  memory: "512Mi"
  cpu: "1000m"
replicas: 1-2
```

**Medium Cluster (production):**
```yaml
requests:
  memory: "512Mi"
  cpu: "500m"
limits:
  memory: "1Gi"
  cpu: "2000m"
replicas: 3-5
```

**Large Cluster (production):**
```yaml
requests:
  memory: "1Gi"
  cpu: "1000m"
limits:
  memory: "2Gi"
  cpu: "4000m"
replicas: 5-10
```

## Environment Variables

Key environment variables configured via ConfigMap and Secret:

### From ConfigMap (non-sensitive)
- `LOG_LEVEL`: Logging verbosity
- `CORS_CREDENTIALS`: CORS credential handling
- `HEALTH_DISK_PATH`: Disk path for health checks (defaults to `/tmp` in containers)

### From Secret (sensitive)
- `DATABASE_*`: Database connection details
- `JWT_SECRET`: JWT signing secret
- `REDIS_URL`: Redis connection string
- `STELLAR_SECRET_KEY`: Stellar network credentials
- `GOOGLE_CLIENT_*`: Google OAuth credentials
- `STRIPE_SECRET_KEY`: Stripe API credentials

## Scaling

### Horizontal Pod Autoscaling (HPA)
To enable automatic scaling based on CPU/memory:

```bash
kubectl autoscale deployment scoopdope-backend \
  --min=3 \
  --max=10 \
  --cpu-percent=70
```

Or create an HPA resource:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: scoopdope-backend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: scoopdope-backend
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Monitoring & Observability

### Prometheus Metrics
The backend exposes Prometheus metrics at `/metrics` (via prom-client library).

### Log Aggregation
Configure log aggregation with your platform (ELK, Datadog, etc.):
```bash
kubectl logs -l app=scoopdope-backend --timestamps=true
```

### Health Dashboard
Monitor health through the health endpoints:
```bash
kubectl port-forward svc/scoopdope-backend 8080:80
curl http://localhost:8080/health/readiness | jq .
```

## Troubleshooting

### Pods Not Starting
```bash
# Check pod events
kubectl describe pod <pod-name>

# Check logs
kubectl logs <pod-name>

# Check resource availability
kubectl top nodes
kubectl top pods
```

### Liveness/Readiness Probe Failures
```bash
# Check health endpoints manually (probes use HTTPS inside the pod)
kubectl port-forward svc/scoopdope-backend 8080:80
curl -vk https://localhost:8080/health/liveness
curl -vk https://localhost:8080/health/readiness

# Run the same command the exec probe uses
kubectl exec <pod-name> -- wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:3000/health/liveness

# Verify environment variables
kubectl exec <pod-name> -- env | grep DATABASE
```

### Database Connection Issues
```bash
# Verify Secret is properly configured
kubectl get secret scoopdope-backend-secrets -o jsonpath='{.data.DATABASE_HOST}' | base64 -d

# Test database connectivity from pod
kubectl exec <pod-name> -- curl -v postgresql://user:pass@host:5432/dbname
```

## Advanced Configuration

### Using External Secrets
For production, use External Secrets or Sealed Secrets:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: backend-secret-store
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: scoopdope-backend-secrets
spec:
  secretStoreRef:
    kind: SecretStore
    name: backend-secret-store
  target:
    name: scoopdope-backend-secrets
  data:
  - secretKey: DATABASE_PASSWORD
    remoteRef:
      key: scoopdope/backend/database-password
```

### Network Policies
Restrict network traffic to/from the backend:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: scoopdope-backend-netpol
spec:
  podSelector:
    matchLabels:
      app: scoopdope-backend
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: TCP
      port: 5432  # PostgreSQL
    - protocol: TCP
      port: 6379  # Redis
    - protocol: TCP
      port: 9200  # Elasticsearch
```

## References

- [Kubernetes Probes Documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Best Practices for Kubernetes](https://kubernetes.io/docs/concepts/configuration/overview/)
