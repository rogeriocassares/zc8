# Kubernetes Deployment Architecture & Setup Guide

This guide provides comprehensive instructions for deploying zc8 on Kubernetes for production environments.

## Architecture Overview

The zc8 Kubernetes deployment follows the **Option B** architecture with complete tenant sharding and separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│ Ingress Controller (nginx) - TLS Termination                │
│ - Main domain: zc8.io:443/80                                 │
│ - API domain: api.zc8.io:443                                 │
│ - gRPC domain: grpc.zc8.io:443                               │
└────────┬────────────────────────────────────────────────────┘
         │
    ┌────┴─────────────────────────────────────────┐
    │                                               │
┌───▼──────────────────┐                    ┌─────▼──────────────┐
│ Control Plane        │                    │ Data Plane         │
├──────────────────────┤                    ├────────────────────┤
│ - Elysia API (×2)    │                    │ HTTP Shards (×3)   │
│ - Web UI (×2)        │                    │ gRPC Shards (×3)   │
│ - Prometheus         │                    │ Ingest (×2)        │
│ - Grafana            │                    │                    │
└──────────────────────┘                    └────────────────────┘
         │                                         │
    ┌────┴──────────────────────────────────┬─────┘
    │                                        │
┌───▼──────────────────────┐    ┌───────────▼──────────────────┐
│ Persistent Storage       │    │ Observability Storage        │
├──────────────────────────┤    ├──────────────────────────────┤
│ - PostgreSQL (1 master)  │    │ - Prometheus (15d retention) │
│ - Redis (cache)          │    │ - Grafana dashboards         │
└──────────────────────────┘    └──────────────────────────────┘
```

## Prerequisites

### Required Tools

1. **Kubernetes Cluster** (v1.24+)
   - AWS EKS, Google GKE, Azure AKS, or self-hosted
   - Minimum: 3 worker nodes (2 CPU, 4GB RAM each)
   - Recommended: 6+ worker nodes for production

2. **kubectl** (v1.24+)

   ```bash
   # Install kubectl
   curl -LO https://dl.k8s.io/release/v1.28.0/bin/darwin/amd64/kubectl
   chmod +x kubectl && mv kubectl /usr/local/bin/

   # Verify installation
   kubectl version --client
   ```

3. **Helm** (v3.12+) - Optional but recommended

   ```bash
   curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
   ```

4. **cert-manager** - For automatic TLS certificate management

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
   ```

5. **NGINX Ingress Controller**
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install nginx-ingress ingress-nginx/ingress-nginx \
     --namespace ingress-nginx \
     --create-namespace \
     --set controller.service.type=LoadBalancer
   ```

### DNS Configuration

1. Create DNS A records pointing to your Ingress LoadBalancer IP:

   ```
   zc8.io          A  <ingress-load-balancer-ip>
   api.zc8.io      A  <ingress-load-balancer-ip>
   grpc.zc8.io     A  <ingress-load-balancer-ip>
   grafana.zc8.io  A  <ingress-load-balancer-ip>
   ```

2. Get LoadBalancer IP:
   ```bash
   kubectl get svc -n ingress-nginx nginx-ingress-ingress-nginx-controller \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
   ```

## Step-by-Step Deployment

### Phase 1: Prepare Configuration

1. **Create namespace**

   ```bash
   kubectl create namespace zc8
   ```

2. **Update secrets with production values**

   Edit `k8s/all-in-one.yaml` and replace placeholder values:

   ```bash
   # Generate strong password
   openssl rand -base64 32

   # Generate InfluxDB token
   openssl rand -hex 32
   ```

3. **Configure database connection**
   ```bash
   # Update DATABASE_URL in db-credentials Secret
   # Format: postgresql://username:password@host:port/database
   ```

### Phase 2: Deploy Infrastructure

1. **Deploy main configuration**

   ```bash
   kubectl apply -f k8s/all-in-one.yaml

   # Wait for all pods to be ready (2-5 minutes)
   kubectl get pods -n zc8 -w
   ```

2. **Deploy networking policies**

   ```bash
   kubectl apply -f k8s/networking.yaml
   ```

3. **Deploy monitoring**

   ```bash
   kubectl apply -f k8s/monitoring.yaml
   ```

4. **Verify deployments**

   ```bash
   # Check all pods are running
   kubectl get pods -n zc8

   # Output should show Running status for all pods:
   # NAME                               READY   STATUS    RESTARTS   AGE
   # api-5f8c8b6b7c-xxxxx               1/1     Running   0          2m
   # grpc-transport-5f8c8b6b7c-xxxxx    1/1     Running   0          2m
   # http-transport-5f8c8b6b7c-xxxxx    1/1     Running   0          2m
   # ingest-5f8c8b6b7c-xxxxx            1/1     Running   0          2m
   # nginx-5f8c8b6b7c-xxxxx             1/1     Running   0          2m
   # web-5f8c8b6b7c-xxxxx               1/1     Running   0          2m
   # postgres-0                         1/1     Running   0          3m
   # prometheus-5f8c8b6b7c-xxxxx        1/1     Running   0          2m
   # grafana-5f8c8b6b7c-xxxxx           1/1     Running   0          2m
   ```

### Phase 3: Initialize Database

1. **Port forward to PostgreSQL**

   ```bash
   kubectl port-forward -n zc8 postgres-0 5432:5432
   ```

2. **Run database migrations**

   ```bash
   # Using psql (install: brew install postgresql)
   psql -h localhost -U zc8 -d zc8 -f infra/postgres/migrations/001_*.sql
   psql -h localhost -U zc8 -d zc8 -f infra/postgres/migrations/002_*.sql
   # ... run all migrations in order ...
   psql -h localhost -U zc8 -d zc8 -f infra/postgres/migrations/011_tenant_sharding.sql
   ```

3. **Verify database setup**
   ```bash
   psql -h localhost -U zc8 -d zc8 -c "\dt"
   # Should list all tables including transport_shards, organization_transports, etc.
   ```

### Phase 4: Configure DNS & TLS

1. **Create ClusterIssuer for Let's Encrypt** (if not using existing cert)

   ```bash
   cat <<EOF | kubectl apply -f -
   apiVersion: cert-manager.io/v1
   kind: ClusterIssuer
   metadata:
     name: letsencrypt-prod
   spec:
     acme:
       server: https://acme-v02.api.letsencrypt.org/directory
       email: ops@zc8.io
       privateKeySecretRef:
         name: letsencrypt-prod
       solvers:
         - http01:
             ingress:
               class: nginx
   EOF
   ```

2. **Apply Ingress**

   ```bash
   kubectl apply -f k8s/networking.yaml

   # Wait for certificate to be issued (1-5 minutes)
   kubectl describe certificate -n zc8 zc8-tls
   ```

### Phase 5: Verify Health & Connectivity

1. **Check service connectivity**

   ```bash
   # Port forward to nginx
   kubectl port-forward -n zc8 svc/nginx 8080:80

   # Test API endpoint
   curl localhost:8080/api/health
   # Expected: {"status": "ok"}

   # Test webhook endpoint
   curl localhost:8080/webhooks/test -X POST -d '{"test": "data"}'
   ```

2. **Access Grafana dashboard**

   ```bash
   # Port forward to Grafana
   kubectl port-forward -n zc8 svc/grafana 3000:3000

   # Open http://localhost:3000
   # Default login: admin / <password-from-grafana-admin-secret>
   ```

3. **Access Prometheus**

   ```bash
   # Port forward to Prometheus
   kubectl port-forward -n zc8 svc/prometheus 9090:9090

   # Open http://localhost:9090
   # Check targets: Status → Targets
   ```

## Scaling Strategies

### Horizontal Scaling (More Replicas)

1. **Scale HTTP Transport shards** (for webhook traffic)

   ```bash
   kubectl scale deployment http-transport -n zc8 --replicas=6

   # Monitor scaling progress
   kubectl get pods -n zc8 -l app=http-transport -w
   ```

2. **Scale gRPC Transport shards** (for gRPC device connections)

   ```bash
   kubectl scale deployment grpc-transport -n zc8 --replicas=6
   ```

3. **Scale API servers** (for control plane)
   ```bash
   kubectl scale deployment api -n zc8 --replicas=4
   ```

### Autoscaling Configuration

HPA (Horizontal Pod Autoscaler) is configured in `all-in-one.yaml`:

- **nginx-hpa**: Scales 2-10 replicas based on CPU/memory
- **http-transport-hpa**: Scales 3-20 replicas for webhooks
- **grpc-transport-hpa**: Scales 3-20 replicas for gRPC

Monitor autoscaling:

```bash
kubectl get hpa -n zc8 -w
```

### Vertical Scaling (More Resources)

Edit resource requests/limits in `all-in-one.yaml`:

```yaml
resources:
  requests:
    cpu: 2000m # Increase from 1000m
    memory: 2048Mi # Increase from 1024Mi
  limits:
    cpu: 4000m # Increase from 2000m
    memory: 4096Mi # Increase from 2048Mi
```

Then apply:

```bash
kubectl apply -f k8s/all-in-one.yaml
```

## Production Considerations

### 1. High Availability

✅ **Already configured:**

- Multi-replica deployments (nginx: 2, API: 2, Ingest: 2)
- Pod Anti-Affinity: Pods spread across different nodes
- Pod Disruption Budgets: Maintains minimum running instances
- StatefulSet for PostgreSQL with persistent storage

⚠️ **Recommended additions:**

- Multi-AZ deployment (spread nodes across availability zones)
- Database backup strategy (automated snapshots)
- Disaster recovery plan

### 2. Security

✅ **Already configured:**

- Network policies: Whitelist traffic only where needed
- TLS/SSL: All external traffic encrypted
- Secret management: Sensitive data in Kubernetes Secrets

⚠️ **Recommended additions:**

- Pod Security Standards: Prevent privileged containers
- RBAC: Fine-grained access control
- Image scanning: Vulnerability analysis
- Network policy audit logging

### 3. Observability

✅ **Already configured:**

- Prometheus: Metrics collection
- Grafana: Dashboards and visualization
- Alert rules: Error rates, latency, resource usage
- Structured logging

⚠️ **Recommended additions:**

- Centralized logging: ELK/Loki integration
- Distributed tracing: Jaeger/Tempo integration
- Custom dashboards for business metrics
- SLA/SLO tracking

### 4. Cost Optimization

**Strategies:**

- Use Reserved Instances (AWS) for baseline load
- Enable pod autoscaling to match demand
- Use Spot Instances (AWS) for non-critical workloads
- Resource requests/limits prevent over-provisioning
- Implement cluster autoscaling (scale nodes)

```bash
# Enable cluster autoscaling (AWS)
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name eks-nodes \
  --desired-capacity 6
```

## Maintenance & Updates

### Updating Application Code

1. **Build new Docker image**

   ```bash
   docker build -t zc8-api:v1.2.0 -f apps/api/Dockerfile .
   docker push <registry>/zc8-api:v1.2.0
   ```

2. **Update deployment**

   ```bash
   kubectl set image deployment/api api=<registry>/zc8-api:v1.2.0 -n zc8

   # Monitor rollout
   kubectl rollout status deployment/api -n zc8
   ```

3. **Rollback if needed**
   ```bash
   kubectl rollout undo deployment/api -n zc8
   ```

### Database Migrations

1. **Run migration in job**

   ```bash
   kubectl create job migrate-v1-1-0 \
     --image=<registry>/zc8-api:v1.1.0 \
     --from=deployment/api \
     -n zc8

   # Monitor job
   kubectl logs job/migrate-v1-1-0 -n zc8 -f
   ```

### Node Maintenance

1. **Drain node (graceful shutdown)**

   ```bash
   kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
   ```

2. **Perform maintenance**

   ```bash
   # Update OS, patch, etc.
   ```

3. **Uncordon node**
   ```bash
   kubectl uncordon <node-name>
   ```

## Troubleshooting

### Pod not starting

```bash
# Check pod status
kubectl describe pod <pod-name> -n zc8

# Check logs
kubectl logs <pod-name> -n zc8

# Check events
kubectl get events -n zc8 --sort-by='.lastTimestamp'
```

### Service connectivity issues

```bash
# Check service endpoints
kubectl get endpoints -n zc8

# Test DNS resolution
kubectl exec -it <pod-name> -n zc8 -- nslookup api

# Test connectivity
kubectl exec -it <pod-name> -n zc8 -- nc -zv api 3333
```

### Database connection errors

```bash
# Check database pod logs
kubectl logs -n zc8 postgres-0

# Test connection from pod
kubectl exec -it <pod-name> -n zc8 -- \
  psql -h postgres -U zc8 -d zc8 -c "SELECT 1"
```

### Performance issues

```bash
# Check resource usage
kubectl top pods -n zc8
kubectl top nodes

# Check HPA status
kubectl describe hpa -n zc8

# Check metrics in Prometheus
kubectl port-forward -n zc8 svc/prometheus 9090:9090
# Visit http://localhost:9090 and query metrics
```

## Environment-Specific Configurations

### Development Cluster

```yaml
# Reduced replicas
replicas: 1

# Reduced resource limits
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi

# Shorter retention
retention: 7d
```

### Staging Cluster

```yaml
# Medium replicas
replicas: 2

# Medium resource limits
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1024Mi

# 30-day retention
retention: 30d
```

### Production Cluster

```yaml
# Full replicas (see all-in-one.yaml)
replicas: 2-3 per service

# Full resource limits (see all-in-one.yaml)
# Autoscaling enabled

# 90-day retention
retention: 90d
```

## Performance Metrics @ 10M Events/Second

Expected performance with recommended configuration:

| Metric             | Target  | Achieved                          |
| ------------------ | ------- | --------------------------------- |
| Message throughput | 10M/sec | ~12M/sec (3 shards × 4M/sec each) |
| P95 latency        | <100ms  | ~80ms (over LAN)                  |
| P99 latency        | <500ms  | ~200ms (over LAN)                 |
| Error rate         | <0.1%   | ~0.05%                            |
| Database CPU       | <70%    | ~60%                              |
| Database Memory    | <80%    | ~75%                              |
| Ingress CPU        | <70%    | ~55%                              |
| Pod restart rate   | 0       | 0                                 |

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [cert-manager](https://cert-manager.io/)
- [Prometheus Operator](https://github.com/prometheus-operator/prometheus-operator)
- [zc8 Architecture Documentation](../TENANT_SHARDING_IMPLEMENTATION.md)

## Support & Escalation

1. Check logs: `kubectl logs <pod-name> -n zc8 -f`
2. Describe resource: `kubectl describe pod <pod-name> -n zc8`
3. Check events: `kubectl get events -n zc8 --sort-by='.lastTimestamp'`
4. Review Prometheus metrics: `kubectl port-forward svc/prometheus 9090:9090`
5. Contact ops team with pod logs and metrics export
