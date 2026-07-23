variable "region" {
  description = "AWS region. Fixed to me-central-1 (UAE) for data residency."
  type        = string
  default     = "me-central-1"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class. Starts small; the scalability roadmap scales this vertically before adding read replicas."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB."
  type        = number
  default     = 20
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "api_image" {
  description = "Full ECR image URI for the API (tag included)."
  type        = string
}

variable "web_image" {
  description = "Full ECR image URI for the web app (tag included)."
  type        = string
}

variable "api_desired_count" {
  description = "Number of API tasks. 1 is sufficient below ~1K users (Technology doc)."
  type        = number
  default     = 2
}

variable "web_desired_count" {
  description = "Number of web tasks."
  type        = number
  default     = 2
}

variable "domain_name" {
  description = "Public domain for the web app (e.g. worknearby.ae)."
  type        = string
}

variable "api_domain_name" {
  description = "Public domain for the API (e.g. api.worknearby.ae)."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN in me-central-1 covering both domain_name and api_domain_name (SAN)."
  type        = string
}
