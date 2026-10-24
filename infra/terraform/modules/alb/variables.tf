variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs"
  type        = list(string)
}

variable "backend_target_group_arn" {
  description = "Backend target group ARN"
  type        = string
}

variable "frontend_target_group_arn" {
  description = "Frontend target group ARN"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
  default     = ""
}

variable "log_bucket" {
  description = "Name of the S3 bucket where ALB access logs are stored"
  type        = string
}

variable "log_bucket_id" {
  description = "S3 bucket ID for ALB access logs (deprecated: use log_bucket)"
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Number of days to retain ALB access logs in the S3 bucket"
  type        = number
  default     = 90
}