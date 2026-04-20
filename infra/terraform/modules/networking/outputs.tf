output "vpc_id" {
  description = "VPC identifier."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet ids (for the ALB)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_id" {
  description = "Private subnet id (for the 5-EC2 fleet)."
  value       = aws_subnet.private.id
}

output "private_route_table_id" {
  description = "Private route table id (used by the S3 gateway endpoint)."
  value       = aws_route_table.private.id
}
