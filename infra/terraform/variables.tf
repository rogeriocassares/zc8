# Terraform Variables for AWS EKS Deployment
# Usage: terraform apply -var-file=terraform.tfvars

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "production"
  
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

# ============================================================================
# VPC CONFIGURATION
# ============================================================================

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for the region"
  type        = list(string)
  default     = ["us-west-2a", "us-west-2b", "us-west-2c"]
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access EKS API"
  type        = list(string)
  default     = ["0.0.0.0/0"]
  
  validation {
    condition     = length(var.allowed_cidr_blocks) > 0
    error_message = "At least one CIDR block must be specified."
  }
}

# ============================================================================
# EKS CONFIGURATION
# ============================================================================

variable "kubernetes_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.28"
}

# ============================================================================
# NODE GROUP CONFIGURATION
# ============================================================================

variable "node_desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 6

  validation {
    condition     = var.node_desired_size >= 3 && var.node_desired_size <= 100
    error_message = "Desired size must be between 3 and 100."
  }
}

variable "node_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 3

  validation {
    condition     = var.node_min_size >= 3 && var.node_min_size <= 100
    error_message = "Minimum size must be between 3 and 100."
  }
}

variable "node_max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 20

  validation {
    condition     = var.node_max_size >= var.node_min_size && var.node_max_size <= 100
    error_message = "Maximum size must be >= minimum size and <= 100."
  }
}

variable "node_instance_types" {
  description = "Instance types for worker nodes"
  type        = list(string)
  default     = ["t3.xlarge", "t3.2xlarge"]  # 4 CPU 16GB, 8 CPU 32GB
}

variable "node_disk_size" {
  description = "Disk size in GB for worker nodes"
  type        = number
  default     = 100

  validation {
    condition     = var.node_disk_size >= 20 && var.node_disk_size <= 1000
    error_message = "Disk size must be between 20 and 1000 GB."
  }
}

# ============================================================================
# RDS CONFIGURATION
# ============================================================================

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6i.xlarge"  # 4 CPU 32GB memory  optimized for databases
  
  # Options:
  # - db.t3.large: 2 CPU 8GB - Development
  # - db.r6i.large: 2 CPU 16GB - Small production
  # - db.r6i.xlarge: 4 CPU 32GB - Medium production
  # - db.r6i.2xlarge: 8 CPU 64GB - Large production
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB for RDS"
  type        = number
  default     = 100

  validation {
    condition     = var.rds_allocated_storage >= 20 && var.rds_allocated_storage <= 65536
    error_message = "Allocated storage must be between 20 and 65536 GB."
  }
}

variable "rds_iops" {
  description = "IOPS for RDS (gp3 storage)"
  type        = number
  default     = 3000  # Range: 3000-16000 for gp3

  validation {
    condition     = var.rds_iops >= 3000 && var.rds_iops <= 16000
    error_message = "IOPS must be between 3000 and 16000."
  }
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ deployment for high availability"
  type        = bool
  default     = true
}

variable "rds_backup_retention_days" {
  description = "Number of days to retain RDS backups"
  type        = number
  default     = 30

  validation {
    condition     = var.rds_backup_retention_days >= 1 && var.rds_backup_retention_days <= 35
    error_message = "Backup retention must be between 1 and 35 days."
  }
}

# ============================================================================
# REDIS CONFIGURATION
# ============================================================================

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.xlarge"  # 4 CPU 32GB memory
  
  # Options:
  # - cache.t3.medium: 1 CPU 3GB - Development
  # - cache.r6g.large: 2 CPU 16GB - Small production
  # - cache.r6g.xlarge: 4 CPU 32GB - Medium production
  # - cache.r6g.2xlarge: 8 CPU 64GB - Large production
}

variable "redis_num_nodes" {
  description = "Number of Redis nodes in cluster"
  type        = number
  default     = 3

  validation {
    condition     = var.redis_num_nodes >= 1 && var.redis_num_nodes <= 100
    error_message = "Number of nodes must be between 1 and 100."
  }
}

# ============================================================================
# LOCALS - COMPUTED VALUES
# ============================================================================

locals {
  environment_config = {
    dev = {
      node_desired_size      = 3
      node_max_size          = 5
      rds_instance_class     = "db.t3.large"
      rds_allocated_storage  = 50
      rds_multi_az           = false
      redis_node_type        = "cache.t3.medium"
      redis_num_nodes        = 1
    }
    staging = {
      node_desired_size      = 4
      node_max_size          = 10
      rds_instance_class     = "db.r6i.large"
      rds_allocated_storage  = 100
      rds_multi_az           = true
      redis_node_type        = "cache.r6g.large"
      redis_num_nodes        = 2
    }
    production = {
      node_desired_size      = 6
      node_max_size          = 20
      rds_instance_class     = "db.r6i.xlarge"
      rds_allocated_storage  = 500
      rds_multi_az           = true
      redis_node_type        = "cache.r6g.xlarge"
      redis_num_nodes        = 3
    }
  }
}
