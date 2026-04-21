output "project_name" {
  description = "Resource name prefix — same as var.project_name. Used by Ansible ECR image path."
  value       = var.project_name
}

output "alb_dns_name" {
  description = "ALB public DNS name. Consumed by the Ansible smoke test and by Route53 when a domain is attached."
  value       = module.alb.alb_dns_name
}

output "instance_ids" {
  description = "Map of role -> EC2 instance id. Used by Ansible for SSM targeting."
  value       = module.compute.instance_ids
}

output "instance_private_ips" {
  description = "Map of role -> private IPv4. Consumed by the Ansible dynamic inventory."
  value       = module.compute.instance_private_ips
}

output "vpc_id" {
  description = "VPC id."
  value       = module.networking.vpc_id
}

output "region" {
  description = "AWS region (echoed for downstream tooling)."
  value       = var.region
}
