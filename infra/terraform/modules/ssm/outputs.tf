output "endpoint_security_group_id" {
  description = "Security group attached to the interface VPC endpoints."
  value       = aws_security_group.endpoint.id
}

output "interface_endpoint_ids" {
  description = "Map of service -> VPC endpoint id."
  value       = { for k, v in aws_vpc_endpoint.interface : k => v.id }
}

output "s3_endpoint_id" {
  description = "S3 gateway endpoint id."
  value       = aws_vpc_endpoint.s3.id
}
