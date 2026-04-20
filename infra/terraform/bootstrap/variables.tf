variable "region" {
  description = "AWS region for bootstrap resources. MUST match the root module's region — the S3 backend fails fast on region mismatch."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix used in bucket, table, and role names. MUST match the root module's project_name (`onboarding-platform`) or the backend block in versions.tf will not resolve."
  type        = string
  default     = "onboarding-platform"
}

variable "tags" {
  description = "Extra tags merged into every bootstrap resource."
  type        = map(string)
  default     = {}
}
