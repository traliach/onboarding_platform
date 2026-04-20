terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — CLAUDE.md §5 "Remote state".
  #
  # This backend MUST NOT be the first thing you init on a fresh clone.
  # The bucket and table are created by `bootstrap/` (applied once per
  # account, with local state). If you hit "bucket does not exist" on
  # `terraform init`, the fix is to run bootstrap first — not to comment
  # this block out. See ../../infra/terraform/README.md for the full
  # order-of-operations.
  #
  # The bucket/table names must match the literals in
  # `bootstrap/main.tf`. If either module changes a name, the other
  # must update in the same PR.
  backend "s3" {
    bucket         = "onboarding-platform-tfstate"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "onboarding-platform-tf-locks"
    encrypt        = true
  }
}
