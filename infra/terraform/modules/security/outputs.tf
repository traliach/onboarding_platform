output "alb_sg_id" {
  description = "ALB security group id."
  value       = aws_security_group.alb.id
}

output "app_sg_id" {
  description = "API EC2 security group id."
  value       = aws_security_group.app.id
}

output "worker_sg_id" {
  description = "Worker EC2 security group id."
  value       = aws_security_group.worker.id
}

output "db_sg_id" {
  description = "PostgreSQL EC2 security group id."
  value       = aws_security_group.db.id
}

output "monitoring_sg_id" {
  description = "Prometheus + Grafana security group id."
  value       = aws_security_group.monitoring.id
}
