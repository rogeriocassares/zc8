# Terraform Deployment Guide for AWS EKS

This guide covers infrastructure provisioning for zc8 using Terraform and AWS.

## Overview

This Terraform configuration provides production-grade infrastructure including:

- **EKS Cluster**: Kubernetes orchestration across 3+ availability zones
- **RDS PostgreSQL**: Multi-AZ database with automated backups
- **ElastiCache Redis**: High-availability caching layer
- **VPC & Networking**: Multi-AZ VPC with public/private subnets and NAT gateways
- **Application Load Balancer**: Layer 7 routing with TLS termination
- **Security Groups**: Network policies for each component
- **CloudWatch Logging**: Centralized logging for all services
- **KMS Encryption**: Database encryption at rest

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│ AWS Account (us-west-2)                                    │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ VPC: 10.0.0.0/16 (Multi-AZ: us-west-2a/b/c)         │  │
│  │                                                      │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │ Public Subnets (3 AZs)                       │   │  │
│  │  │ - ALB                                        │   │  │
│  │  │ - NAT Gateways                              │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                      │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │ Private Subnets (3 AZs)                      │   │  │
│  │  │ - EKS Cluster & Nodes                        │   │  │
│  │  │ - RDS PostgreSQL                            │   │  │
│  │  │ - ElastiCache Redis                         │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Required Tools

1. **AWS Account** with appropriate permissions
2. **Terraform** (v1.0+)

   ```bash
   # macOS with Homebrew
   brew install terraform

   # Verify installation
   terraform version
   ```

3. **AWS CLI** (v2.0+)

   ```bash
   # macOS with Homebrew
   brew install awscli

   # Configure credentials
   aws configure
   # Enter: Access Key ID, Secret Access Key, default region (us-west-2)
   ```

4. **kubectl** (v1.24+)
   ```bash
   brew install kubectl
   ```

### AWS Permissions

Your AWS IAM user/role needs permissions for:

- EKS: `AmazonEKS*`
- EC2: `AmazonEC2*`
- VPC: `AmazonVPC*`
- RDS: `AmazonRDS*`
- ElastiCache: `AmazonElastiCache*`
- IAM: `IAM*`
- KMS: `KMS*`
- CloudWatch: `CloudWatch*`
- Secrets Manager: `SecretsManager*`
- S3: `S3*` (for Terraform state)

### S3 Bucket for Terraform State

```bash
# Create S3 bucket for state
aws s3 mb s3://zc8-terraform-state --region us-west-2

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket zc8-terraform-state \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-sse-configuration \
  --bucket zc8-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## Step-by-Step Deployment

### Phase 1: Initialize Terraform

1. **Navigate to Terraform directory**

   ```bash
   cd infra/terraform
   ```

2. **Initialize Terraform**

   ```bash
   terraform init
   # Output:
   # Terraform has been successfully configured!
   # You may now begin working with Terraform.
   ```

3. **Validate configuration**

   ```bash
   terraform validate
   # Output:
   # Success! The configuration is valid.
   ```

4. **Select workspace (optional, for multiple environments)**
   ```bash
   terraform workspace new dev
   terraform workspace select dev
   ```

### Phase 2: Plan Infrastructure

1. **Run plan with environment variables**

   ```bash
   # For development
   terraform plan -var-file=dev.tfvars -out=tfplan.dev

   # For staging
   terraform plan -var-file=staging.tfvars -out=tfplan.staging

   # For production
   terraform plan -var-file=prod.tfvars -out=tfplan.prod
   ```

2. **Review plan output**

   ```
   Plan: 45 to add, 0 to change, 0 to destroy.

   Notable resources:
   - aws_eks_cluster.main
   - aws_eks_node_group.general
   - aws_db_instance.postgres
   - aws_elasticache_cluster.redis
   - aws_lb.main
   - Various networking and security resources
   ```

3. **Save plan for review**
   ```bash
   terraform show tfplan.dev > tfplan.dev.txt
   # Review tfplan.dev.txt before applying
   ```

### Phase 3: Apply Infrastructure

⚠️ **Production Only - Require Approval**

```bash
# Before applying to production:
# 1. Get approval from infrastructure team
# 2. Schedule maintenance window
# 3. Notify on-call engineer
# 4. Have rollback plan ready

# For development (safe to apply)
terraform apply tfplan.dev

# For staging (low risk)
terraform apply tfplan.staging

# For production (high risk - REQUIRE APPROVAL)
# Request explicit approval before running:
terraform apply tfplan.prod
```

### Phase 4: Verify Deployment

1. **Check Terraform outputs**

   ```bash
   terraform output
   # Shows:
   # - eks_cluster_endpoint
   # - eks_cluster_name
   # - rds_endpoint
   # - redis_endpoint
   # - alb_dns_name
   # - vpc_id
   ```

2. **Configure kubectl**

   ```bash
   # Get cluster name
   CLUSTER_NAME=$(terraform output -raw eks_cluster_name)

   # Update kubeconfig
   aws eks update-kubeconfig \
     --region us-west-2 \
     --name $CLUSTER_NAME

   # Verify connection
   kubectl get nodes
   ```

3. **Verify RDS**

   ```bash
   # Get RDS endpoint
   RDS_ENDPOINT=$(terraform output -raw rds_endpoint)

   # Test connection (requires AWS Secrets Manager access)
   aws secretsmanager get-secret-value \
     --secret-id zc8/db-password-production \
     --region us-west-2 \
     --query SecretString \
     --output text | \
     jq -r .password
   ```

4. **Verify Redis**

   ```bash
   # Get Redis endpoint
   REDIS_ENDPOINT=$(terraform output -raw redis_endpoint)

   # Test connection via EC2 instance in VPC or port forward
   ```

5. **Check ALB**

   ```bash
   # Get ALB DNS name
   ALB_DNS=$(terraform output -raw alb_dns_name)

   # Create CNAME record
   # zc8.io CNAME $ALB_DNS
   ```

### Phase 5: Deploy Kubernetes Applications

After infrastructure is ready:

```bash
# Create namespace
kubectl create namespace zc8

# Apply ConfigMaps and Secrets
kubectl apply -f k8s/all-in-one.yaml

# Verify pods are running
kubectl get pods -n zc8 -w

# Port forward to check services
kubectl port-forward -n zc8 svc/nginx 8080:80
curl localhost:8080/health
```

## Scaling & Maintenance

### Scale EKS Node Group

```bash
# View current configuration
terraform show | grep -A 5 aws_eks_node_group

# Scale by modifying tfvars
# Edit dev.tfvars, staging.tfvars, or prod.tfvars
# - Increase node_desired_size
# - Increase node_max_size if needed

# Apply changes
terraform plan -var-file=prod.tfvars -out=tfplan.prod
terraform apply tfplan.prod

# Verify scaling
kubectl get nodes
```

### Upgrade Kubernetes Version

```bash
# Check current version
aws eks describe-cluster --name zc8-eks-production --query 'cluster.version'

# Update tfvars
# kubernetes_version = "1.29"

# Plan upgrade
terraform plan -var-file=prod.tfvars -out=tfplan.upgrade

# Review plan carefully - EKS upgrades require node group updates
terraform apply tfplan.upgrade

# Monitor upgrade progress
kubectl get nodes
```

### Resize Databases

```bash
# Edit tfvars to change:
# - rds_instance_class (e.g., "db.r6i.2xlarge")
# - rds_allocated_storage (e.g., 1000)
# - redis_node_type (e.g., "cache.r6g.2xlarge")

# Plan changes
terraform plan -var-file=prod.tfvars -out=tfplan.resize

# Apply changes (may cause brief downtime for RDS)
terraform apply tfplan.resize
```

## Disaster Recovery

### Backup Strategy

```bash
# RDS automated backups configured:
# - Retention: 30 days (production)
# - Multi-AZ enabled: Automatic failover
# - Backup window: 03:00-04:00 UTC

# Manual backup
aws rds create-db-snapshot \
  --db-instance-identifier zc8-postgres-production \
  --db-snapshot-identifier zc8-postgres-production-$(date +%Y%m%d)

# List snapshots
aws rds describe-db-snapshots \
  --filters Name=engine,Values=postgres
```

### Restore from Backup

```bash
# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier zc8-postgres-restored \
  --db-snapshot-identifier zc8-postgres-production-20240309

# After restore, update database URL in Secrets Manager
aws secretsmanager update-secret \
  --secret-id zc8/db-password-production \
  --secret-string '{...updated endpoint...}'
```

## Cost Optimization

### Reserved Instances

```bash
# Purchase 3-year RIs for baseline load
aws ec2 describe-reserved-instances-offerings \
  --filters "Name=instance-type,Values=t3.xlarge" \
  --region us-west-2

# Savings: ~60% vs on-demand for compute
# Recommendation: Purchase 3-year reserved for production baseline
```

### Lifecycle Policies

```bash
# Implement spot instances for non-critical workloads
# Add to node group configuration:
capacity_type = "SPOT"  # vs ON_DEMAND

# Savings: ~75% vs on-demand
# Risk: Interruption - only for fault-tolerant services
```

## Monitoring & Troubleshooting

### View Terraform State

```bash
# Show current state
terraform show

# Show specific resource
terraform show aws_eks_cluster.main

# Output as JSON
terraform show -json | jq .
```

### Check Terraform Logs

```bash
# Enable debug logging
export TF_LOG=DEBUG
terraform plan -var-file=prod.tfvars

# Save logs to file
export TF_LOG_PATH=./terraform.log
terraform apply tfplan.prod

# Disable logging
unset TF_LOG
unset TF_LOG_PATH
```

### Rollback Changes

```bash
# If apply fails or causes issues:

# 1. Check what was partially applied
terraform state list

# 2. Revert specific resource
terraform destroy -target=aws_eks_node_group.general

# 3. Or manually undo changes in AWS console

# 4. Refresh state
terraform refresh

# 5. Try applying again
terraform apply tfplan.prod
```

## Production Checklist

Before deploying to production:

- [ ] All prerequisites installed and configured
- [ ] AWS credentials verified and have correct permissions
- [ ] S3 bucket and DynamoDB table created for state
- [ ] Security groups reviewed and restricted appropriately
- [ ] VPC CIDR ranges don't conflict with existing infrastructure
- [ ] RDS multi-AZ enabled
- [ ] RDS backup retention set to 30+ days
- [ ] Redis cluster has 3+ nodes
- [ ] Node group has at least 3 nodes across AZs
- [ ] ALB DNS name can be added as CNAME to zc8.io
- [ ] TLS certificates ready or cert-manager configured
- [ ] Database migrations tested and ready
- [ ] Kubernetes application manifests reviewed
- [ ] Monitoring and alerting configured
- [ ] Team trained on disaster recovery procedures

## Support & Escalation

### Common Issues

**Issue: "Error: creating EC2 VPC: UnauthorizedOperation"**

- Solution: Verify AWS credentials and IAM permissions

**Issue: "Error: creating RDS instance: DBInstanceAlreadyExists"**

- Solution: Instance with same name exists. Use different environment or delete existing

**Issue: "Error: creating EKS cluster: InvalidParameterException"**

- Solution: Check VPC CIDR and subnet configuration

### Getting Help

1. **Check Terraform state**

   ```bash
   terraform state show
   ```

2. **Check AWS CloudTrail**

   ```bash
   aws cloudtrail lookup-events --region us-west-2 | head -20
   ```

3. **Check CloudWatch logs**

   ```bash
   aws logs describe-log-groups --region us-west-2
   ```

4. **Contact AWS Support** (for AWS-specific issues)

5. **Review Terraform documentation**
   - https://registry.terraform.io/providers/hashicorp/aws/latest/docs
   - https://www.terraform.io/docs

## Clean Up

⚠️ **Destroys all infrastructure - Use with caution!**

```bash
# Destroy development environment
terraform destroy -var-file=dev.tfvars

# Destroy specific resources only
terraform destroy -target=aws_eks_node_group.general -var-file=prod.tfvars

# If destroy fails, manually clean up in AWS console:
# 1. Delete EKS cluster
# 2. Delete RDS instance
# 3. Delete ElastiCache cluster
# 4. Delete VPC (will cascade delete subnets, security groups, etc.)
# 5. Delete S3 bucket and DynamoDB table for state
```

## Additional Resources

- [AWS EKS Documentation](https://docs.aws.amazon.com/eks/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest)
- [Terraform Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
