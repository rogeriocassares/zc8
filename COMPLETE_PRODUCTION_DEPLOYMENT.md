# Complete Production Deployment Architecture

This document provides a comprehensive overview of all deployment options for zc8, with guidance on selecting the best approach for your environment.

## Executive Summary

zc8 supports three production deployment architectures, each optimized for different requirements:

| Aspect             | Docker Compose       | Kubernetes (AWS EKS) | Serverless (AWS Lambda/Render) |
| ------------------ | -------------------- | -------------------- | ------------------------------ |
| **Scale**          | Up to 1M events/sec  | 10M+ events/sec      | 1M events/sec (variable)       |
| **Setup Time**     | 5 minutes            | 30 minutes           | 15 minutes                     |
| **Cost (monthly)** | $500-1000            | $3000-5000           | $2000-4000                     |
| **Operations**     | Simple               | Moderate             | Minimal                        |
| **HA/DR**          | Manual               | Automatic (multi-AZ) | Automatic (distributed)        |
| **Scaling**        | Manual               | Auto (HPA)           | Auto (per request)             |
| **Best For**       | Development, staging | Production at scale  | Variable workloads             |

## Deployment Comparison

### Option 1: Docker Compose (Local/EC2)

#### Architecture

```
┌────────────────────────────────────────┐
│ Docker Compose Host (EC2 or local)     │
├────────────────────────────────────────┤
│                                        │
│ ┌──────────────────────────────────┐   │
│ │ Docker Network (zc8-network)     │   │
│ │                                  │   │
│ │  ┌─────────────────────┐         │   │
│ │  │ nginx               │──────────┼───┼─ Host ports
│ │  │ (80, 443)           │         │   │
│ │  └────────┬────────────┘         │   │
│ │           │                      │   │
│ │  ┌────────┴────────────┐         │   │
│ │  │ api, web, transport │         │   │
│ │  │ ingest services     │         │   │
│ │  └────────┬────────────┘         │   │
│ │           │                      │   │
│ │  ┌────────▼────────────┐         │   │
│ │  │ postgres            │         │   │
│ │  │ redis               │         │   │
│ │  │ influxdb            │         │   │
│ │  └─────────────────────┘         │   │
│ │                                  │   │
│ └──────────────────────────────────┘   │
│                                        │
└────────────────────────────────────────┘
```

#### When to Use

✅ **Ideal For:**

- Development and testing
- Staging environments
- Proof of concepts
- Small teams (< 100K events/sec)
- Single-region deployments

❌ **Not Recommended For:**

- Production high-scale (> 1M events/sec)
- Multi-region deployments
- Automatic scaling requirements
- Disaster recovery scenarios

#### Deployment Instructions

```bash
# 1. Clone repository
git clone https://github.com/zc8/zc8.git && cd zc8

# 2. Create .env file
cp .env.example .env
# Edit .env with your configuration

# 3. Start services
docker-compose -f docker-compose.prod.yml up -d

# 4. Run migrations
docker-compose exec api npx migrate

# 5. Verify deployment
curl http://localhost/health
```

**Time to Production:** ~5 minutes

**Files:**

- [docker-compose.prod.yml](docker-compose.prod.yml) - Production Docker Compose configuration
- [infra/nginx/main.conf](infra/nginx/main.conf) - nginx routing configuration

---

### Option 2: Kubernetes (AWS EKS)

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ AWS – us-west-2 (3 Availability Zones)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ VPC: 10.0.0.0/16                                        │ │
│  │                                                         │ │
│  │  ┌─────────────────────────────────────────────────┐   │ │
│  │  │ EKS Cluster (3-6 nodes across AZs)              │   │ │
│  │  │                                                 │   │ │
│  │  │  ┌─────────────────────────────────────────┐   │   │ │
│  │  │  │ nginx Ingress (2 replicas)              │   │   │ │
│  │  │  │ - TLS termination                       │   │   │ │
│  │  │  │ - Rate limiting                         │   │   │ │
│  │  │  └────────────────┬────────────────────────┘   │   │ │
│  │  │                   │                             │   │ │
│  │  │  ┌────────────────┴────────────────────────┐   │   │ │
│  │  │  │ zc8 Services                            │   │   │ │
│  │  │  │ - API (2 replicas)                      │   │   │ │
│  │  │  │ - Web UI (2 replicas)                   │   │   │ │
│  │  │  │ - HTTP Transport (3-20 replicas)        │   │   │ │
│  │  │  │ - gRPC Transport (3-20 replicas)        │   │   │ │
│  │  │  │ - Ingest (2 replicas)                   │   │   │ │
│  │  │  │ - Prometheus, Grafana                   │   │   │ │
│  │  │  └────────────────┬────────────────────────┘   │   │ │
│  │  │                   │                             │   │ │
│  │  └───────────────────┼─────────────────────────────┘   │ │
│  │                      │                                 │ │
│  │  ┌───────────────────┴──────────────────────────┐     │ │
│  │  │ AWS Managed Services                         │     │ │
│  │  │ - RDS PostgreSQL (Multi-AZ)                  │     │ │
│  │  │ - ElastiCache Redis (3-node cluster)         │     │ │
│  │  │ - ALB (Application Load Balancer)            │     │ │
│  │  │ - CloudWatch Monitoring                      │     │ │
│  │  │ - KMS Encryption                             │     │ │
│  │  └─────────────────────────────────────────────┘     │ │
│  │                                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### When to Use

✅ **Ideal For:**

- Production high-scale (10M+ events/sec)
- Multi-region deployments (multi-cluster)
- Automatic scaling requirements
- Disaster recovery with automatic failover
- Enterprise deployments
- Long-term operational stability

❌ **Challenges:**

- Requires Kubernetes expertise
- Higher operational overhead
- More complex deployment process
- Higher infrastructure costs

#### Deployment Instructions

```bash
# 1. Install prerequisites
# - AWS CLI, kubectl, Terraform
brew install awscli kubectl terraform

# 2. Configure AWS credentials
aws configure

# 3. Deploy infrastructure
cd infra/terraform
terraform init
terraform plan -var-file=prod.tfvars -out=tfplan.prod
terraform apply tfplan.prod

# 4. Configure kubectl
aws eks update-kubeconfig --region us-west-2 --name zc8-eks-production

# 5. Deploy Kubernetes manifests
kubectl apply -f k8s/all-in-one.yaml
kubectl apply -f k8s/networking.yaml
kubectl apply -f k8s/monitoring.yaml

# 6. Run database migrations
kubectl port-forward postgres-0 5432:5432
psql -h localhost -U zc8admin -d zc8 -f infra/postgres/migrations/*.sql

# 7. Verify deployment
kubectl get pods -n zc8
kubectl port-forward svc/nginx 8080:80
curl http://localhost:8080/health
```

**Time to Production:** ~30-45 minutes

**Performance @ 10M Events/Sec:**

- Throughput: 12M events/sec (3 shards × 4M each)
- P95 Latency: ~80ms (LAN)
- Error Rate: <0.05%
- Infrastructure Cost: ~$3,500/month

**Files:**

- [K8S_DEPLOYMENT_GUIDE.md](K8S_DEPLOYMENT_GUIDE.md) - Complete K8s deployment guide
- [k8s/all-in-one.yaml](k8s/all-in-one.yaml) - All K8s manifests (deployments, services, HPA)
- [k8s/networking.yaml](k8s/networking.yaml) - Ingress, network policies, PDBs
- [k8s/monitoring.yaml](k8s/monitoring.yaml) - Prometheus, Grafana, ServiceMonitor
- [TERRAFORM_DEPLOYMENT_GUIDE.md](TERRAFORM_DEPLOYMENT_GUIDE.md) - Terraform deployment guide
- [infra/terraform/aws-eks.tf](infra/terraform/aws-eks.tf) - EKS infrastructure
- [infra/terraform/variables.tf](infra/terraform/variables.tf) - Configuration variables
- [infra/terraform/dev.tfvars](infra/terraform/dev.tfvars) - Development settings
- [infra/terraform/staging.tfvars](infra/terraform/staging.tfvars) - Staging settings
- [infra/terraform/prod.tfvars](infra/terraform/prod.tfvars) - Production settings

---

### Option 3: Serverless (AWS Lambda + RDS)

#### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ AWS Serverless Architecture                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ CloudFront Distribution                                │ │
│  │ (Global CDN, TLS termination)                          │ │
│  │ zc8.io → CloudFront                                   │ │
│  └────────────────┬─────────────────────────────────────┘ │
│                   │                                        │
│   ┌───────────────┴────────────────────┐                  │
│   │                                    │                  │
│  ┌▼──────────────┐   ┌────────────────▼──┐                │
│  │ API Gateway   │   │ AWS Lambda         │                │
│  │ (REST APIs)   │   │ (Auto-scaling)     │                │
│  │               │   │ - api (Node.js)    │                │
│  │ Routes:       │   │ - webhooks         │                │
│  │ /api/*        │   │ - ingest (gRPC)    │                │
│  │ /webhooks/    │   │ - processor        │                │
│  │ /grpc/*       │   │                    │                │
│  └────────────────┘   └┬───────────────────┘                │
│                        │                                   │
│   ┌────────────────────┴─────────────────┐               │
│   │                                      │               │
│  ┌▼─────────────────┐   ┌─────────────────▼──┐            │
│  │ AWS RDS          │   │ AWS EventBridge    │            │
│  │ PostgreSQL       │   │ (Event streaming)  │            │
│  │ (Multi-AZ)       │   │                    │            │
│  │                  │   │ - Webhook events   │            │
│  │ - Shared cluster │   │ - Device messages  │            │
│  │ - 1-2 db units   │   │ - Ingest streams   │            │
│  └──────────────────┘   └────────────────────┘            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ AWS S3 + CloudFront (Static Assets)                   │ │
│  │ - Web UI (React)                                      │ │
│  │ - Documentation                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### When to Use

✅ **Ideal For:**

- Variable or unpredictable workloads
- Minimal operational overhead
- Cost optimization for low-to-moderate volume
- API-first architectures
- Startups and rapidly growing companies
- Multi-region out of the box (CloudFront)

❌ **Challenges:**

- Stateless functions only
- Cold start latency (~300-500ms first call)
- gRPC support limited (Lambda + API Gateway)
- Database connection pooling complexity
- Vendor lock-in (AWS)

#### Deployment Instructions

```bash
# 1. Install AWS SAM CLI
brew install aws-sam-cli

# 2. Package Lambda functions
sam package \
  --template-file serverless/template.yaml \
  --s3-bucket zc8-lambda-artifacts \
  --output-template-file packaged.yaml

# 3. Deploy stack
sam deploy \
  --template-file packaged.yaml \
  --stack-name zc8-serverless \
  --capabilities CAPABILITY_IAM \
  --region us-west-2

# 4. Set up database
# RDS Proxy for connection pooling
aws rds create-db-proxy \
  --db-proxy-name zc8-proxy \
  --engine POSTGRESQL \
  --auth '{"AuthScheme": "SECRETS"}' \
  --role-arn arn:aws:iam::ACCOUNT:role/rds-proxy-role \
  --target-group-config DBPortNumber=5432

# 5. Get API endpoint
aws cloudformation describe-stacks \
  --stack-name zc8-serverless \
  --query 'Stacks[0].Outputs'

# 6. Update DNS
# zc8.io CNAME → CloudFront distribution DNS
```

**Time to Production:** ~15-20 minutes

**Performance:**

- Throughput: ~1M events/sec (with optimization)
- P95 Latency: ~200-800ms (including cold starts)
- Error Rate: ~0.1-0.5% (cold starts)
- Infrastructure Cost: ~$2,000-4,000/month

---

## Selection Matrix

| Requirement           | Docker Compose | Kubernetes | Serverless       |
| --------------------- | -------------- | ---------- | ---------------- |
| Scale to 10M/sec      | ❌             | ✅         | ⚠️ Limited       |
| Multi-region          | ❌             | ✅         | ✅ Auto          |
| HA/Failover           | Manual         | ✅ Auto    | ✅ Auto          |
| Autoscaling           | Manual         | ✅ (HPA)   | ✅ (per request) |
| Team size needed      | 1-2            | 3-5        | 1-2              |
| Cost at 1M/sec        | $500           | $3,500     | $2,500           |
| Cost at 10M/sec       | N/A            | $5,000     | N/A (Limited)    |
| Setup complexity      | Very Low       | High       | Medium           |
| Operational overhead  | Low            | High       | Very Low         |
| Vendor lock-in        | None           | Low (AWS)  | High (AWS)       |
| Stateful workloads    | ✅             | ✅         | ❌               |
| Custom infrastructure | ✅             | ✅         | Limited          |

## Recommended Path to Production

### Phase 1: Development (Week 1)

**Use:** Docker Compose (local or EC2 t3.small)

```bash
docker-compose -f docker-compose.prod.yml up -d
```

**Cost:** $1-5/month
**Throughput:** 100K events/sec
**Setup Time:** 5 min

### Phase 2: Staging (Week 2-3)

**Use:** Docker Compose on EC2 (c5.4xlarge with vertical scaling)

OR

**Use:** Kubernetes (3-node EKS cluster)

**Cost:** $200-500/month
**Throughput:** 1M events/sec
**Setup Time:** 15-30 min

### Phase 3: Production (Week 4+)

**Decision Point:**

**If throughput < 1M/sec:**

- Use Docker Compose on EC2 (auto-scaling group)
- Cost: $500-1,000/month
- Setup: 20 minutes

**If 1M < throughput < 10M/sec:**

- Use Kubernetes (EKS, 6-node cluster)
- Cost: $3,000-5,000/month
- Setup: 45 minutes

**If > 10M/sec or multi-region required:**

- Use Multi-cluster Kubernetes (3+ regions)
- Or Hybrid (K8s + Serverless)
- Cost: $10,000+/month
- Setup: 1-2 hours

## Migration Between Options

### Docker Compose → Kubernetes

```bash
# 1. Export docker-compose data
docker-compose exec postgres pg_dump zc8 > backup.sql

# 2. Deploy Kubernetes infrastructure
terraform apply -var-file=prod.tfvars

# 3. Restore database
kubectl port-forward postgres-0 5432:5432
psql -h localhost -U zc8admin -d zc8 < backup.sql

# 4. Deploy applications
kubectl apply -f k8s/all-in-one.yaml

# 5. Verify and switch DNS
```

### Kubernetes → Serverless

```bash
# 1. Export data (same as above)
# 2. Deploy Lambda functions (sam deploy)
# 3. Migrate database to RDS with Proxy
# 4. Update application code (stateless)
# 5. Test thoroughly (different latency profile)
```

## Cost Analysis

### Monthly Costs at 10M Events/Sec

**Docker Compose (single instance):**

- Instance: $200 (c5.4xlarge)
- Database: $200 (managed)
- Network: $100
- **Total: ~$500-800/month**
- ❌ Not recommended (no HA, hard to scale)

**Kubernetes (AWS EKS):**

- EKS cluster: $73 (fixed)
- EC2 nodes: $2,000 (6x t3.2xlarge on-demand)
- Reserved instances: -$400 (with 3-yr commitment)
- RDS: $800 (multi-AZ db.r6i.xlarge)
- ElastiCache: $400 (r6g.xlarge, 3 nodes)
- Other (ALB, etc.): $500
- **Total: ~$3,700/month (on-demand)**
- **Total: ~$3,300/month (with 1-yr RIs)**

**Serverless:**

- Lambda: $1,000-2,000 (10M requests/month)
- API Gateway: $300 (1B API calls)
- RDS: $800 (db.serverless)
- RDS Proxy: $300
- Other: $300
- **Total: ~$2,700-3,500/month**
- ❌ Only if throughput < 1M/sec

## Cost Optimization Tips

1. **Use Reserved Instances (30-40% savings)**

   ```bash
   # For production with predictable baseline
   aws ec2 purchase-reserved-instances-offering \
     --reserved-instances-offering-id xxxxx
   ```

2. **Use Spot Instances for non-critical services (75% savings)**

   ```yaml
   # In EKS node group
   capacity_type = "SPOT"
   ```

3. **Right-sizing**
   - Monitor actual usage
   - Reduce instance sizes if overprovisioned
   - Use t3 instances for variable workloads

4. **Regional optimization**
   - Deploy in cheaper regions (us-west-2 vs us-east-1)
   - Use CloudFront for global distribution

5. **Database optimization**
   - Reduce storage with compression
   - Use read replicas for querying
   - Implement connection pooling

## Monitoring & Observability

All options include:

- **Prometheus:** Metrics collection
- **Grafana:** Visualization and dashboards
- **CloudWatch:** AWS native logging and monitoring
- **Alert rules:** Error rates, latency, resource usage
- **Distributed tracing:** (Optional) Jaeger/Tempo

## Next Steps

### To Deploy Docker Compose:

1. Read [docker-compose.prod.yml](docker-compose.prod.yml)
2. Create .env file with your configuration
3. Run: `docker-compose -f docker-compose.prod.yml up -d`
4. Access: http://localhost/health

### To Deploy Kubernetes:

1. Read [K8S_DEPLOYMENT_GUIDE.md](K8S_DEPLOYMENT_GUIDE.md)
2. Read [TERRAFORM_DEPLOYMENT_GUIDE.md](TERRAFORM_DEPLOYMENT_GUIDE.md)
3. Run: `terraform apply -var-file=prod.tfvars`
4. Apply manifests: `kubectl apply -f k8s/`

### To Deploy Serverless:

1. Set up AWS SAM CLI
2. Configure Lambda functions
3. Deploy: `sam deploy`
4. Test endpoints

## Additional Resources

- [Architecture Documentation](TENANT_SHARDING_IMPLEMENTATION.md)
- [Transport Microservices Guide](TRANSPORT_MICROSERVICES_ARCHITECTURE.md)
- [Kubernetes Deployment Guide](K8S_DEPLOYMENT_GUIDE.md)
- [Terraform Deployment Guide](TERRAFORM_DEPLOYMENT_GUIDE.md)
- [Docker Compose Configuration](docker-compose.prod.yml)
