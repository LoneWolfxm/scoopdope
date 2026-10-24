variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Domain name for the application (e.g., scoopdope.com)"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Existing Route53 hosted zone ID (if not creating a new zone)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate ARN (if not creating one)"
  type        = string
  default     = ""
}

variable "waf_enabled" {
  description = "Enable WAF on the ALB"
  type        = bool
  default     = true
}

variable "allowed_cidrs" {
  description = "List of CIDR blocks allowed to access the ALB"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "Scoopdope"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = true
}

variable "db_deletion_protection" {
  description = "Enable deletion protection for RDS"
  type        = bool
  default     = true
}

variable "backup_retention_period" {
  description = "RDS backup retention period in days"
  type        = number
  default     = 30
}

variable "performance_insights_enabled" {
  description = "Enable RDS Performance Insights"
  type        = bool
  default     = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "backend_image" {
  description = "Docker image for backend service"
  type        = string
}

variable "frontend_image" {
  description = "Docker image for frontend service"
  type        = string
}

variable "ecr_backend_repo_name" {
  description = "ECR repository name for backend images"
  type        = string
  default     = "scoopdope-backend"
}

variable "ecr_frontend_repo_name" {
  description = "ECR repository name for frontend images"
  type        = string
  default     = "scoopdope-frontend"
}

variable "asg_min_capacity" {
  description = "Minimum number of ECS tasks"
  type        = number
  default     = 2
}

variable "asg_max_capacity" {
  description = "Maximum number of ECS tasks"
  type        = number
  default     = 10
}

variable "asg_desired_capacity" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "sns_alarm_email" {
  description = "Email address for SNS alarm notifications"
  type        = string
  default     = ""
}

variable "github_org" {
  description = "GitHub organization or username owning this repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "scoopdope"
}

variable "log_bucket" {
  description = "Name of the S3 bucket used to store ALB access logs"
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Number of days to retain ALB access logs in S3"
  type        = number
  default     = 90
}
