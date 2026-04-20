variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  description = "VPC id where the target group lives."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet ids (>=2 AZs) for the ALB."
  type        = list(string)
}

variable "alb_sg_id" {
  description = "ALB security group id."
  type        = string
}

variable "app_instance_id" {
  description = "App EC2 id registered as the target."
  type        = string
}

variable "tags" {
  description = "Tags merged into every resource."
  type        = map(string)
  default     = {}
}
