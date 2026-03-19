# Example Terraform Variables - Production Environment
# Usage: terraform apply -var-file=prod.tfvars

# IMPORTANT: This is sensitive production configuration!
# - Store this file securely (never commit to public repositories)
# - Use AWS Secrets Manager for sensitive values
# - Enable MFA before applying to production
# - Plan changes and review carefully before apply

aws_region     = "us-west-2"
environment    = "production"
vpc_cidr       = "10.0.0.0/16"

# EKS
kubernetes_version = "1.28"

# Node Group - Full capacity for production
node_desired_size = 6
node_min_size     = 3
node_max_size     = 20
node_instance_types = ["t3.2xlarge"]  # 8 CPU 32GB per node
node_disk_size    = 200

# RDS - Large for production with high availability
rds_instance_class      = "db.r6i.xlarge"     # 4 CPU 32GB memory
rds_allocated_storage   = 500
rds_iops                = 8000
rds_multi_az            = true
rds_backup_retention_days = 30

# Redis - Large for production
redis_node_type = "cache.r6g.xlarge"           # 4 CPU 32GB memory
redis_num_nodes = 3

# Access Control - Restrict to specific IP ranges ONLY
allowed_cidr_blocks = [
  "203.0.113.0/24",   # Your office IP range
  "198.51.100.0/24"   # Your CI/CD IP range
]

# ============================================================================
# PRODUCTION DEPLOYMENT CHECKLIST
# ============================================================================
#
# Before deploying to production:
#
# 1. Security Review
#    - [ ] Verify allowed_cidr_blocks are correct
#    - [ ] Ensure RDS encryption is enabled (automatic via Terraform)
#    - [ ] Verify multi-AZ is enabled
#    - [ ] Check backup retention (30 days minimum)
#
# 2. Network Configuration
#    - [ ] DNS A records point to ALB
#    - [ ] TLS certificates are valid and up-to-date
#    - [ ] All security groups are properly configured
#
# 3. Database
#    - [ ] RDS backup strategy verified
#    - [ ] Database size adequate for expected workload
#    - [ ] Backup window doesn't conflict with peak hours
#
# 4. Monitoring
#    - [ ] CloudWatch alarms configured
#    - [ ] Prometheus scrape configs verified
#    - [ ] Grafana dashboards created
#    - [ ] Alert email addresses configured
#
# 5. Capacity Planning
#    - [ ] Node count sufficient for expected load
#    - [ ] Autoscaling policies reviewed
#    - [ ] Reserved instances purchased if cost-optimizing
#
# 6. Disaster Recovery
#    - [ ] Backup strategy tested
#    - [ ] Recovery runbook documented
#    - [ ] RTO/RPO requirements met
#
# 7. Cost Management
#    - [ ] Budget alerts configured
#    - [ ] Reserved instances evaluated
#    - [ ] Spot instances strategy determined
#
# 8. Compliance
#    - [ ] Data residency requirements met
#    - [ ] VPC Flow Logs enabled
#    - [ ] CloudTrail logging enabled
#    - [ ] Encryption policies verified
#
# ============================================================================
