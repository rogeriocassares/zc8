# Example Terraform Variables - Staging Environment
# Usage: terraform apply -var-file=staging.tfvars

aws_region     = "us-west-2"
environment    = "staging"
vpc_cidr       = "10.0.0.0/16"

# EKS
kubernetes_version = "1.28"

# Node Group - Medium for staging
node_desired_size = 4
node_min_size     = 3
node_max_size     = 10
node_instance_types = ["t3.xlarge", "t3.2xlarge"]
node_disk_size    = 100

# RDS - Medium for staging
rds_instance_class      = "db.r6i.large"
rds_allocated_storage   = 100
rds_iops                = 3000
rds_multi_az            = true
rds_backup_retention_days = 14

# Redis - Medium for staging
redis_node_type = "cache.r6g.large"
redis_num_nodes = 2

# Access Control - Restrict to known IP ranges
allowed_cidr_blocks = [
  "203.0.113.0/24"   # Your office IP range
]
