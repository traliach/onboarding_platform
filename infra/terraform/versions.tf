terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — project rules §5.
  # Bucket and DynamoDB table are pre-existing (created once via AWS CLI —
  # see docs/runbook.md). The bucket is shared across projects; state is
  # isolated by the key path. Never delete the lock table between deploys.
  backend "s3" {
    bucket         = "achille-tf-state"
    key            = "onboarding-platform/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "onboarding-platform-tf-lock"
    encrypt        = true
  }
}
