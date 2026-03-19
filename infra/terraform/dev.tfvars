# Example Terraform Variables - Development Environment
# Usage: terraform apply -var-file=dev.tfvars

aws_region     = "us-west-2"
environment    = "dev"
vpc_cidr       = "10.0.0.0/16"

# EKS
kubernetes_version = "1.28"

# Node Group - Minimal for development
node_desired_size = 3
node_min_size     = 3
node_max_size     = 5
node_instance_types = ["t3.xlarge"]
node_disk_size    = 50

# RDS - Minimal for development
rds_instance_class      = "db.t3.large"
rds_allocated_storage   = 50
rds_iops                = 3000
rds_multi_az            = false
rds_backup_retention_days = 7

# Redis - Minimal for development
redis_node_type = "cache.t3.medium"
redis_num_nodes = 1

# Access Control
allowed_cidr_blocks = ["0.0.0.0/0"]  # Warning: Open to all - restrict in prod
