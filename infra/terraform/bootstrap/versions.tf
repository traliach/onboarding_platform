terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # NOTE: no backend block on purpose.
  #
  # This module CREATES the S3 bucket and DynamoDB table that the root
  # module will use as its remote backend. Storing bootstrap state
  # remotely would be a chicken-and-egg — the bucket doesn't exist yet.
  # Local state is the intentional, permanent exception here (CLAUDE.md
  # §5 "Remote state"). The resulting terraform.tfstate file stays on
  # the operator's machine and is small enough to version-control
  # separately if ever needed.
}
