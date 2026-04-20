variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "subnet_id" {
  description = "Private subnet id where all 5 EC2s launch."
  type        = string
}

variable "ami_id" {
  description = "AMI id for all EC2s (Amazon Linux 2023 x86_64, resolved upstream)."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type (t2.micro by cost rules)."
  type        = string
}

variable "ebs_volume_size" {
  description = "Root EBS volume size (GiB)."
  type        = number
}

variable "app_sg_id" {
  description = "Security group id for the app EC2."
  type        = string
}

variable "worker_sg_id" {
  description = "Security group id for the worker EC2."
  type        = string
}

variable "db_sg_id" {
  description = "Security group id for the PostgreSQL EC2."
  type        = string
}

variable "monitoring_sg_id" {
  description = "Security group id for the Prometheus + Grafana EC2s."
  type        = string
}

variable "tags" {
  description = "Tags merged into every resource."
  type        = map(string)
  default     = {}
}
