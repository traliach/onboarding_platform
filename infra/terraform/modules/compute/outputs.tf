output "instance_ids" {
  description = "Map of role -> EC2 instance id."
  value = merge(
    { for k, v in aws_instance.fleet : k => v.id },
    { db = aws_instance.db.id },
  )
}

output "instance_private_ips" {
  description = "Map of role -> private IPv4 address."
  value = merge(
    { for k, v in aws_instance.fleet : k => v.private_ip },
    { db = aws_instance.db.private_ip },
  )
}

output "app_instance_id" {
  description = "App EC2 instance id. Registered as the ALB target."
  value       = aws_instance.fleet["app"].id
}

output "ssm_iam_role_name" {
  description = "Name of the EC2 SSM IAM role."
  value       = aws_iam_role.ec2_ssm.name
}
