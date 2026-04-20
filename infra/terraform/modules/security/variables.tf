variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block — used as the monitoring SG ingress source."
  type        = string
}

variable "allowed_http_cidrs" {
  description = "CIDR blocks allowed to reach the ALB on 80/443."
  type        = list(string)
}

variable "tags" {
  description = "Tags merged into every resource."
  type        = map(string)
  default     = {}
}
