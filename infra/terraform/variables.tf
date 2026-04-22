variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix used for resource names and default tags."
  type        = string
  default     = "onboarding-platform"
}

variable "environment" {
  description = "Environment tag. Single-env lab; kept as a variable as the upgrade path."
  type        = string
  default     = "lab"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDRs for the ALB public subnets. ALB requires at least two AZs."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) >= 2
    error_message = "ALB requires at least two public subnets in two different AZs."
  }
}

variable "private_subnet_cidr" {
  description = "CIDR for the single private subnet that hosts the 5-EC2 fleet."
  type        = string
  default     = "10.0.11.0/24"
}

variable "instance_type" {
  description = "EC2 instance type for the entire fleet. t2.micro per CLAUDE.md cost rules."
  type        = string
  default     = "t2.micro"
}

variable "ebs_volume_size" {
  description = "Root EBS volume size (GiB) for each EC2. gp3 is mandated."
  type        = number
  default     = 20
}

variable "allowed_http_cidrs" {
  description = "CIDR blocks allowed to reach the ALB on ports 80 and 443."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "alb_certificate_arn" {
  description = "Optional ACM certificate ARN for the ALB HTTPS listener. Leave empty for HTTP-only smoke-test deployments."
  type        = string
  default     = ""

  validation {
    condition     = var.alb_certificate_arn == "" || can(regex("^arn:[^:]+:acm:[a-z0-9-]+:[0-9]{12}:certificate/.+", var.alb_certificate_arn))
    error_message = "alb_certificate_arn must be empty or a valid ACM certificate ARN."
  }
}

variable "tags" {
  description = "Extra tags merged into all resources."
  type        = map(string)
  default     = {}
}
