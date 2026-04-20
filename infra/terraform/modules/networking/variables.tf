variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "public_subnet_cidrs" {
  description = "CIDRs for the ALB public subnets (one per AZ in var.azs)."
  type        = list(string)
}

variable "private_subnet_cidr" {
  description = "CIDR for the single private subnet that hosts the compute fleet."
  type        = string
}

variable "azs" {
  description = "Availability Zones used for public subnets."
  type        = list(string)
}

variable "compute_az" {
  description = "The single AZ that hosts the private subnet and the 5 EC2 fleet."
  type        = string
}

variable "tags" {
  description = "Tags merged into every resource."
  type        = map(string)
  default     = {}
}
