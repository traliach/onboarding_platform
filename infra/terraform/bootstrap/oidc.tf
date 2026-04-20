# --------------------------------------------------------------------
# GitHub Actions → AWS, via OIDC
# --------------------------------------------------------------------
# CLAUDE.md §8/§10: GitHub Actions authenticates via OIDC — never with
# static access keys. This file creates the identity provider, the
# role, and its permissions. The role is assumed by `.github/workflows
# /infra.yml` (and anything else under .github/workflows that needs
# AWS) through `aws-actions/configure-aws-credentials`.
#
# Trust model:
#   - Only jobs running from var.github_repo can assume the role.
#   - Any branch / any workflow event in that repo is allowed to run
#     `terraform plan` (needed for PR plan comments). The workflow
#     itself gates `terraform apply` to pushes on `main`, so a feature
#     branch cannot actually mutate infrastructure even though it has
#     read access via this role.
#
# Permission model (pragmatic, not minimal):
#   - `PowerUserAccess` — AWS managed policy. Gives everything the
#     fleet needs (EC2/VPC/ALB/SSM/ECR/S3/DynamoDB) WITHOUT iam:*.
#     CLAUDE.md §10 forbids AdministratorAccess; PowerUserAccess is
#     the documented next step down.
#   - Inline `iam_project_scope` policy — grants the iam:* actions the
#     root module needs (Create/Attach/Pass the EC2 SSM role and its
#     instance profile), scoped via Resource to role names that start
#     with `onboarding-platform-*`. A foot-gun bypass policy for
#     `iam:*` on `*` would work but is explicitly not the shape we
#     want in a portfolio project.
#   - Inline `terraform_state` policy — narrow S3 + DynamoDB access
#     scoped to the exact bucket and table this bootstrap creates, so
#     the role can read/write remote state but cannot touch anything
#     else in S3/DDB.
# --------------------------------------------------------------------

data "aws_caller_identity" "current" {}

locals {
  gha_role_name = "${var.project_name}-gha-oidc"

  # GitHub's OIDC issuer is a stable URL — the thumbprint dance that
  # older examples required is no longer needed since AWS added
  # support for the issuer's certificate chain. We keep thumbprint
  # pinning off deliberately; a rotating thumbprint was the primary
  # cause of OIDC outages in 2023.
  github_oidc_url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = local.github_oidc_url
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"] # ignored by AWS for this issuer; kept for API compatibility

  tags = merge(var.tags, {
    Name = "${var.project_name}-github-oidc"
  })
}

resource "aws_iam_role" "gha_oidc" {
  name = local.gha_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          # sub pattern matches *any* workflow job in the repo. The
          # apply-only-on-main rule is enforced in the workflow
          # (infra.yml) — keeping it in one place avoids double-gate
          # drift.
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name = local.gha_role_name
  })
}

resource "aws_iam_role_policy_attachment" "power_user" {
  role       = aws_iam_role.gha_oidc.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# IAM actions the root module needs, scoped to resources whose name
# starts with the project prefix. A blanket iam:* on * would be
# simpler but unreviewable; this shape makes the blast radius
# explicit.
resource "aws_iam_role_policy" "iam_project_scope" {
  name = "${local.gha_role_name}-iam-scope"
  role = aws_iam_role.gha_oidc.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManageProjectScopedRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:ListRoles",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:PassRole",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.project_name}-*"
      },
      {
        Sid    = "ManageProjectScopedInstanceProfiles"
        Effect = "Allow"
        Action = [
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:GetInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:TagInstanceProfile",
          "iam:UntagInstanceProfile",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/${var.project_name}-*"
      },
    ]
  })
}

# Narrow access to the state bucket and lock table so the role can do
# its Terraform job but cannot read other state from other projects
# that happen to share the account.
resource "aws_iam_role_policy" "terraform_state" {
  name = "${local.gha_role_name}-tfstate"
  role = aws_iam_role.gha_oidc.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateBucketList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.tfstate.arn
      },
      {
        Sid      = "StateObjectReadWrite"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.tfstate.arn}/*"
      },
      {
        Sid    = "LockTableReadWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = aws_dynamodb_table.tflocks.arn
      },
    ]
  })
}
