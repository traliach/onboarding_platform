variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet id where Interface endpoints live."
  type        = string
}

variable "private_subnet_cidr" {
  description = "Private subnet CIDR — source for the endpoint security group."
  type        = string
}

variable "private_route_table_id" {
  description = "Private route table id — associated with the S3 gateway endpoint."
  type        = string
}

variable "tags" {
  description = "Tags merged into every resource."
  type        = map(string)
  default     = {}
}
