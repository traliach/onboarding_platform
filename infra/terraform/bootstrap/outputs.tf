output "state_bucket_name" {
  description = "S3 bucket that holds the root module's Terraform state. Paste into the `bucket` argument of the root module's backend block."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_bucket_arn" {
  description = "S3 bucket ARN — consumed by the OIDC role's inline policy so GitHub Actions can read/write state."
  value       = aws_s3_bucket.tfstate.arn
}

output "lock_table_name" {
  description = "DynamoDB lock table. Paste into the `dynamodb_table` argument of the root module's backend block."
  value       = aws_dynamodb_table.tflocks.name
}

output "lock_table_arn" {
  description = "DynamoDB lock table ARN — consumed by the OIDC role's inline policy."
  value       = aws_dynamodb_table.tflocks.arn
}
