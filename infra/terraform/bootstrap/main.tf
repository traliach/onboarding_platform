provider "aws" {
  region = var.region
  default_tags {
    tags = merge(var.tags, {
      Project   = var.project_name
      ManagedBy = "terraform-bootstrap"
    })
  }
}

locals {
  tfstate_bucket = "${var.project_name}-tfstate"
  tflocks_table  = "${var.project_name}-tf-locks"
}

# --------------------------------------------------------------------
# S3 bucket — Terraform remote state for the root module
# --------------------------------------------------------------------
# Versioning ON so a bad apply can be rolled back to the previous
# state object. AES256 SSE is free and adequate for this threat model
# (the state file contains resource IDs, not secrets — JWT/DB creds
# live in Ansible Vault, not Terraform state). KMS would add cost for
# no meaningful gain at this scale. Public access fully blocked as a
# belt-and-braces against a misconfigured policy later.
# --------------------------------------------------------------------
resource "aws_s3_bucket" "tfstate" {
  bucket = local.tfstate_bucket

  # prevent_destroy protects the state bucket from an accidental
  # `terraform destroy` on the bootstrap module itself. Deleting the
  # bucket would orphan the root module's state and make any future
  # `terraform plan` on the root module think the entire infrastructure
  # is new — a very expensive mistake.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --------------------------------------------------------------------
# DynamoDB table — Terraform state lock
# --------------------------------------------------------------------
# PAY_PER_REQUEST stays under the 25 RCU / 25 WCU always-free tier at
# this project's apply frequency (<10 applies/day). Hash key `LockID`
# is the fixed convention Terraform's S3 backend expects — do not
# rename.
# --------------------------------------------------------------------
resource "aws_dynamodb_table" "tflocks" {
  name         = local.tflocks_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}
