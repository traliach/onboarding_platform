# Deploy Guide

Zero to live fleet, then routine CI/CD deployment. This is the source of truth
for deploy procedures. Use [runbook.md](runbook.md) for incident triage,
service restarts, logs, SSM access, and teardown.

Run the first-deploy sequence once per AWS account. After step 11, CI/CD owns
client, server image, and Terraform deploys. Ansible is CI-runnable once the
real `vault.yml` is Ansible Vault encrypted, committed, and paired with the
`ANSIBLE_VAULT_PASSWORD` GitHub secret.

## Current deployment caveats

Do not skip this section. Three parts of the current repo still need an explicit
deployment decision:

- The EC2 fleet has no NAT gateway. That is intentional, but the Ansible roles
  currently download `node_exporter` and Prometheus from GitHub and Grafana from
  `rpm.grafana.com`. Step 8 will fail unless those artifacts are made reachable
  first: temporarily add controlled outbound HTTPS, pre-stage artifacts in S3,
  or patch the roles to copy local/S3-hosted packages.
- The Terraform ALB currently has an HTTP listener only. A Vercel production
  frontend is HTTPS, so browser calls to `http://<alb-dns>` will be blocked as
  mixed content. Treat the raw ALB URL as a backend smoke-test URL only. For a
  browser-ready deploy, add an HTTPS API origin first, usually an ACM-backed ALB
  listener plus a custom API domain.
- The API sets production cookies as `Secure` and `SameSite=Strict`. That is
  correct security posture, but it means the internal dashboard login needs the
  frontend and API on HTTPS same-site custom domains, for example
  `https://app.example.com` and `https://api.example.com`. Make that
  domain/cookie decision before treating the dashboard deploy as user-ready.

## Start Here — Smoke Preflight

Run this first, before Terraform, DNS, ACM, or Vercel production setup. Smoke
preflight is read-only: it checks local tools, vault policy, AWS account
prerequisites, GitHub secrets, and the artifact-access decision.

```bash
ARTIFACT_STRATEGY=controlled-outbound \
bash ./scripts/deploy-preflight.sh --phase=smoke
```

Do not run production preflight yet. Production preflight needs a real HTTPS API
origin and ACM certificate; that belongs later in Step 10 after the backend
smoke deploy is healthy.

`ARTIFACT_STRATEGY` must be one of `controlled-outbound`, `s3-artifacts`, or
`prebaked-ami`.

### Smoke Preflight Log

| Date | Command | Result | Next action |
|---|---|---|---|
| 2026-04-22 | `ARTIFACT_STRATEGY=controlled-outbound bash ./scripts/deploy-preflight.sh --phase=smoke` | Failed: `ansible-playbook` and `ansible-galaxy` missing locally; DynamoDB lock table, GitHub OIDC role, ECR repository, `AWS_ROLE_TO_ASSUME`, and `AWS_REGION` missing. Passed: AWS credentials for account `406460434857`, S3 state bucket, encrypted tracked vault, Docker, Terraform fmt. Smoke-only warnings for HTTPS/Vercel are expected. | Install/use an Ansible-capable control node, create account prerequisites, set AWS GitHub secrets, rerun smoke preflight. |
| 2026-04-23 | `aws dynamodb create-table ... onboarding-platform-tf-lock` | Created DynamoDB lock table in `us-east-1`, account `406460434857`; table ARN `arn:aws:dynamodb:us-east-1:406460434857:table/onboarding-platform-tf-lock`. | Create/verify ECR repository, create GitHub OIDC role, set `AWS_ROLE_TO_ASSUME` and `AWS_REGION`, rerun smoke preflight. |
| 2026-04-23 | `aws ecr describe-repositories --repository-names onboarding-platform ...` | ECR repository exists: `406460434857.dkr.ecr.us-east-1.amazonaws.com/onboarding-platform`. | Create GitHub OIDC role, set AWS GitHub secrets, finish WSL Ansible verification, rerun smoke preflight. |
| 2026-04-23 | `ansible-playbook --version` from WSL venv | Ansible works from `infra/ansible/.venv`; `ansible-core 2.20.5`, Python 3.12.3. | Install/list required Ansible collections, then create GitHub OIDC role. |
| 2026-04-23 | `ansible-galaxy collection install -r infra/ansible/requirements.yml` | Required collections installed: `amazon.aws` and `community.postgresql`. | Create GitHub OIDC role, set AWS GitHub secrets, rerun smoke preflight from WSL. |
| 2026-04-23 | `aws iam create-role --role-name onboarding-platform-github-actions ...` | Created GitHub Actions OIDC role `arn:aws:iam::406460434857:role/onboarding-platform-github-actions`; trust policy is scoped to `repo:traliach/onboarding_platform:*`; `PowerUserAccess` attached. | Attach scoped inline IAM policy, capture role ARN, set GitHub AWS secrets. |
| 2026-04-23 | `aws iam put-role-policy --policy-name iam_project_scope ...` | Attached scoped inline IAM policy for project IAM reads/writes and EC2 `iam:PassRole`; expected role ARN is `arn:aws:iam::406460434857:role/onboarding-platform-github-actions`. | Set `AWS_ROLE_TO_ASSUME` and `AWS_REGION` GitHub secrets. |
| 2026-04-23 | `gh secret set AWS_ROLE_TO_ASSUME` and `gh secret set AWS_REGION` | GitHub Actions secrets now exist: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, and prior `ANSIBLE_VAULT_PASSWORD`. | Fix WSL-local tool visibility and rerun smoke preflight. |
| 2026-04-23 | WSL smoke preflight | AWS prerequisites all pass: state bucket, lock table, OIDC role, ECR repository. Ansible passes. Remaining failures are WSL-local: `terraform`, `gh`, `node`, Docker daemon, and `gh` repo authentication. | Install or expose missing WSL tools, ensure Docker Desktop WSL integration, authenticate `gh` in WSL, rerun smoke preflight. |
| 2026-04-23 | WSL smoke preflight after WSL tooling fixes | All local tools, Ansible, Terraform, AWS prerequisites, and GitHub secrets pass. Only failure: Docker daemon unreachable from WSL. Smoke-only Vercel/HTTPS warnings are expected. | Apply Docker Desktop WSL integration, restart WSL shell, verify `docker info`, rerun smoke preflight. |
| 2026-04-23 | `bash ./scripts/deploy-preflight.sh --phase=smoke` | Passed: 0 failures, 5 expected smoke warnings. Local tooling, vault policy, AWS prerequisites, GitHub AWS secrets, Docker daemon, Terraform fmt all pass. | Start Step 5 smoke Terraform apply. |
| 2026-04-23 | `terraform init && terraform plan -out=tfplan` | `terraform init` succeeded with S3 backend. First plan failed before saving a usable plan because AWS rejected security group descriptions containing `>` / em dash characters. | Patched security group descriptions to AWS-allowed ASCII; rerun `terraform fmt -recursive` and `terraform plan -out=tfplan`. |
| 2026-04-23 | `terraform fmt -recursive && terraform plan -out=tfplan` | Plan succeeded and saved `tfplan`: 35 to add, 0 to change, 0 to destroy. Outputs include ALB DNS, instance ids/private IPs, project name, region, and VPC id. | Run `terraform apply tfplan` for the smoke fleet. |
| 2026-04-23 | `terraform apply tfplan` | Partial apply: VPC, networking, ALB, IAM instance profile, security groups, and VPC endpoints were created. EC2 creation failed because the latest AL2023 root snapshot requires at least 30 GiB, but Terraform forced 20 GiB. | Do not reuse the old plan. Patch `ebs_volume_size` to 30, then rerun `terraform fmt -recursive`, `terraform plan -out=tfplan`, and `terraform apply tfplan`. |
| 2026-04-23 | `terraform apply tfplan` after ALB security group description cleanup | Apply stalled destroying the ALB security group because the group was still attached to the ALB. Security group descriptions are effectively replacement-only here. | Interrupt the apply once, rename the ALB security group resource to `onboarding-platform-alb-public-sg`, use `create_before_destroy`, re-plan, and apply the new plan. |
| 2026-04-23 | `terraform apply tfplan` after ALB security group rename and 30 GiB root volume fix | Apply succeeded. Terraform reported `7 added, 2 changed, 1 destroyed`. Fleet outputs: `alb_dns_name=onboarding-platform-alb-637111522.us-east-1.elb.amazonaws.com`, VPC `vpc-06329d06f30d45bec`, and all 5 instance ids/private IPs. | Wait for all 5 EC2s to register in SSM, then build and push the server image, render inventory, and run Ansible. |
| 2026-04-24 | `ansible-playbook playbooks/site.yml ...` from WSL on `/mnt/c/...` | First failure: Ansible ignored `ansible.cfg` because the repo lives on a world-writable Windows mount, so inventory and roles were not loaded. Second failure after forcing `ANSIBLE_CONFIG`: `amazon.aws.aws_ssm` crashed in `Gathering Facts` because the generated inventory did not set `ansible_aws_ssm_bucket_name`. | Treat the S3 transfer bucket as an account prerequisite, make `render-inventory.sh` write `ansible_aws_ssm_bucket_name`, and always export `ANSIBLE_CONFIG="$PWD/ansible.cfg"` when running Ansible from `/mnt/c` in WSL. |

Current deploy position:

1. Smoke preflight passed.
2. Terraform apply completed successfully. Current smoke outputs:
   - ALB DNS: `onboarding-platform-alb-637111522.us-east-1.elb.amazonaws.com`
   - App: `i-0ac1e0af3f2231c26` / `10.0.11.64`
   - DB: `i-05f76feda74fbd893` / `10.0.11.153`
   - Grafana: `i-04e09ee0796b27114` / `10.0.11.31`
   - Prometheus: `i-0a77c7d0fc94043d9` / `10.0.11.113`
   - Worker: `i-014987e11f9acee5e` / `10.0.11.146`
3. Wait for all 5 EC2s to show as managed instances in Systems Manager.
4. Build and push the server image.
5. Render inventory and run Ansible.
6. Verify `http://<alb-dns>/health`.

---

## Prerequisites

| Tool | Why |
|------|-----|
| AWS CLI v2 | Terraform, ECR login, SSM sessions |
| [Session Manager Plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) | `aws ssm start-session` |
| Terraform >= 1.5 | Infrastructure apply; CI currently uses 1.9.8 |
| Ansible >= 2.16 + pip `boto3 botocore` | Fleet configuration |
| Docker Desktop | Image build + push |
| Node.js >= 22 + npm/npx | Vercel CLI command and local client checks |
| `openssl` | Vault secret generation |
| `jq` | `scripts/render-inventory.sh` |
| `gh` (GitHub CLI) | Setting repo secrets |

The command blocks use Bash syntax (`export`, `$(...)`, `date`, and Unix-style
pipes). On Windows, run the deploy from WSL/Linux, not native Git Bash, once
Ansible is involved. Native Windows Python can install Ansible packages, but it
is not a reliable Ansible control node for this project.

If smoke preflight reports `ansible-playbook` or `ansible-galaxy` missing, or
native Windows Ansible fails with `OSError: [WinError 1] Incorrect function`,
move the deploy shell into WSL/Linux and install the control-node dependencies
there:

```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv jq unzip
python3 -m venv infra/ansible/.venv
source infra/ansible/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install ansible boto3 botocore
ansible-galaxy collection install -r infra/ansible/requirements.yml
ansible-playbook --version
ansible-galaxy collection list amazon.aws
ansible-galaxy collection list community.postgresql
```

If `python -m pip install ansible boto3 botocore` appears stuck for more than a
few minutes at `Installing collected packages`, interrupt it with `Ctrl+C`,
then verify whether the install actually completed:

```bash
source infra/ansible/.venv/bin/activate
python -m pip list | grep -E 'ansible|boto3|botocore'
ansible-playbook --version
```

If `ansible-playbook` is still missing, reinstall with a smaller retry surface:

```bash
python -m pip install --no-cache-dir --force-reinstall ansible boto3 botocore
ansible-playbook --version
```

From WSL, the Windows checkout is available under `/mnt/c`. For this repo:

```bash
cd "/mnt/c/Users/trach/Documents/New project/onboarding_platform"
```

If smoke preflight in WSL reports missing `terraform`, `gh`, or `node`, install
them in WSL instead of switching back to Git Bash. The deploy shell should be
consistent from this point forward:

```bash
sudo apt-get update
sudo apt-get install -y curl gnupg lsb-release

# Terraform.
wget -O- https://apt.releases.hashicorp.com/gpg \
  | gpg --dearmor \
  | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update
sudo apt-get install -y terraform

# GitHub CLI.
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt-get update
sudo apt-get install -y gh
gh auth login

# Node.js LTS.
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

terraform version
gh auth status
node --version
npm --version
```

For Docker, open Docker Desktop on Windows and enable WSL integration for this
distro: Settings -> Resources -> WSL Integration. Then verify from WSL:

```bash
docker info
```

If integration is already enabled but `docker info` still cannot reach the
daemon, click **Apply & restart** in Docker Desktop, then restart the WSL shell:

```powershell
wsl --shutdown
```

Open Ubuntu again and verify:

```bash
cd "/mnt/c/Users/trach/Documents/New project/onboarding_platform"
source infra/ansible/.venv/bin/activate
docker info
```

---

## Step 1 — Select Local AWS Credentials

This step does not create AWS resources. It only decides which local AWS CLI
identity will run the setup commands.

The deploy needs a local operator identity with:

- `PowerUserAccess` for normal AWS resources such as VPC, EC2, ALB, ECR, S3,
  and DynamoDB.
- Extra IAM permissions for the few IAM resources this project needs:
  GitHub OIDC setup, the EC2 SSM/ECR instance role, and the EC2 instance
  profile.

`PowerUserAccess` is not enough by itself because AWS intentionally excludes
most IAM writes from that policy. The extra IAM permissions should be scoped to
this project where possible, for example roles and instance profiles named
`onboarding-platform-*`.

Do not use root access keys for routine deploys. If
`aws sts get-caller-identity` returns `arn:aws:iam::<account-id>:root`, the CLI
is authenticated as the AWS account root user. That works technically, but it is
too broad for day-to-day deployment. Prefer IAM Identity Center / SSO, or an
operator IAM user/role with `PowerUserAccess` plus the scoped IAM permissions
above.

If your current shell already works, you can skip SSO setup and continue. You
do not need a profile named `onboarding`. Verify the account first:

```bash
aws sts get-caller-identity
```

Expected account for this deploy:

```text
406460434857
```

If you use AWS IAM Identity Center / SSO, create a named local profile:

```bash
aws configure sso --profile onboarding
aws sso login --profile onboarding
export AWS_PROFILE=onboarding
```

What those commands do:

- `aws configure sso --profile onboarding` creates or updates a local AWS CLI
  profile named `onboarding` in your AWS config. It prompts for your SSO start
  URL, SSO region, account, and role. It does not create IAM users, IAM roles,
  EC2s, or Terraform resources.
- `aws sso login --profile onboarding` opens the browser and signs that local
  profile in. It caches temporary credentials on your machine.
- `export AWS_PROFILE=onboarding` tells the current shell to use that named
  profile for later `aws`, `terraform`, and script commands.

If you are using an IAM user with access keys instead of SSO, do not run
`aws configure sso`; use the profile or environment variables that already make
`aws sts get-caller-identity` return the expected account. Prefer SSO or an
assumed operator role over long-lived IAM user access keys when possible.

If you skipped SSO because the current shell already has valid credentials, do
not run `export AWS_PROFILE=onboarding`. Just set the region for later commands:

```bash
export REGION=us-east-1
```

> No EC2 key pairs are needed. All shell access goes through SSM Session
> Manager — port 22 is closed on every instance and no `key_name` is set
> in the Terraform compute module.

---

## Step 2 — Confirm backend and OIDC prerequisites

The Terraform root module expects these resources to already exist before
`terraform init`:

- S3 state bucket: `achille-tf-state`
- DynamoDB lock table: `onboarding-platform-tf-lock`
- GitHub OIDC role: `onboarding-platform-github-actions`
- Ansible SSM transfer bucket: `onboarding-platform-ssm-<account-id>` by
  default, or whatever you set in `ANSIBLE_SSM_BUCKET`

They are account-level prerequisites, not resources in this repo. Do not add a
new Terraform account-setup module for them. The ECR repository is also outside
the app Terraform root and is handled in Step 4.

```bash
REGION=us-east-1

aws s3api head-bucket --bucket achille-tf-state
aws dynamodb describe-table \
  --table-name onboarding-platform-tf-lock \
  --region "$REGION" >/dev/null

OIDC_ROLE_ARN=$(aws iam get-role \
  --role-name onboarding-platform-github-actions \
  --query 'Role.Arn' \
  --output text)
echo "$OIDC_ROLE_ARN"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ANSIBLE_SSM_BUCKET="${ANSIBLE_SSM_BUCKET:-onboarding-platform-ssm-${ACCOUNT}}"
aws s3api head-bucket --bucket "$ANSIBLE_SSM_BUCKET"
```

Do not reuse the Terraform state bucket for Ansible-over-SSM module transfer.
The `amazon.aws.aws_ssm` connection plugin uploads module payloads there. Keep
that traffic in a dedicated bucket so state history and transient Ansible
payloads stay separate.

If the Ansible bucket is missing, create it once:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ANSIBLE_SSM_BUCKET="${ANSIBLE_SSM_BUCKET:-onboarding-platform-ssm-${ACCOUNT}}"

aws s3api head-bucket --bucket "$ANSIBLE_SSM_BUCKET" >/dev/null 2>&1 \
  || aws s3api create-bucket \
    --bucket "$ANSIBLE_SSM_BUCKET" \
    --region "$REGION"

aws s3api put-public-access-block \
  --bucket "$ANSIBLE_SSM_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket "$ANSIBLE_SSM_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

If the DynamoDB lock table is missing, create it once:

```bash
aws dynamodb create-table \
  --table-name onboarding-platform-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"

aws dynamodb wait table-exists \
  --table-name onboarding-platform-tf-lock \
  --region "$REGION"
```

If the GitHub OIDC role is missing, create or repair the provider, role, and
project-scoped IAM policy:

Key lines:

- Set account and repo variables.
- Register GitHub token provider.
- Trust only this repository.
- Create GitHub Actions role.
- Refresh the trust policy.
- Attach non-IAM AWS permissions.
- Scope IAM writes to project.
- Save final role ARN.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
GITHUB_REPO="traliach/onboarding_platform"
OIDC_ROLE_NAME="onboarding-platform-github-actions"
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

# Register GitHub token provider.
aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1 \
  || aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com

POLICY_WORKDIR=".deploy-tmp"
mkdir -p "$POLICY_WORKDIR"

# Trust only this repository.
TRUST_POLICY_FILE="${POLICY_WORKDIR}/github-trust.json"
cat > "$TRUST_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_PROVIDER_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF
test -s "$TRUST_POLICY_FILE"
TRUST_POLICY_URI="file://${TRUST_POLICY_FILE}"
if command -v cygpath >/dev/null 2>&1; then
  TRUST_POLICY_URI="file://$(cygpath -m "$TRUST_POLICY_FILE")"
fi

# Create GitHub Actions role.
aws iam get-role --role-name "$OIDC_ROLE_NAME" >/dev/null 2>&1 \
  || aws iam create-role \
    --role-name "$OIDC_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY_URI"

# Refresh the trust policy.
aws iam update-assume-role-policy \
  --role-name "$OIDC_ROLE_NAME" \
  --policy-document "$TRUST_POLICY_URI"

# Attach non-IAM AWS permissions.
aws iam attach-role-policy \
  --role-name "$OIDC_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

# Scope IAM writes to project.
IAM_SCOPE_POLICY_FILE="${POLICY_WORKDIR}/github-iam-scope.json"
cat > "$IAM_SCOPE_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadIamMetadata",
      "Effect": "Allow",
      "Action": [
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListAttachedRolePolicies",
        "iam:ListInstanceProfiles",
        "iam:ListInstanceProfilesForRole",
        "iam:ListPolicies",
        "iam:ListRolePolicies",
        "iam:ListRoles"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageProjectRoles",
      "Effect": "Allow",
      "Action": [
        "iam:AttachRolePolicy",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:DeleteRolePolicy",
        "iam:DetachRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:PutRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy"
      ],
      "Resource": "arn:aws:iam::${ACCOUNT}:role/onboarding-platform-*"
    },
    {
      "Sid": "ManageProjectInstanceProfiles",
      "Effect": "Allow",
      "Action": [
        "iam:AddRoleToInstanceProfile",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:GetInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile",
        "iam:TagInstanceProfile",
        "iam:UntagInstanceProfile"
      ],
      "Resource": "arn:aws:iam::${ACCOUNT}:instance-profile/onboarding-platform-*"
    },
    {
      "Sid": "PassProjectRolesToEc2",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${ACCOUNT}:role/onboarding-platform-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ec2.amazonaws.com"
        }
      }
    }
  ]
}
EOF
test -s "$IAM_SCOPE_POLICY_FILE"
IAM_SCOPE_POLICY_URI="file://${IAM_SCOPE_POLICY_FILE}"
if command -v cygpath >/dev/null 2>&1; then
  IAM_SCOPE_POLICY_URI="file://$(cygpath -m "$IAM_SCOPE_POLICY_FILE")"
fi

# Attach scoped IAM policy.
aws iam put-role-policy \
  --role-name "$OIDC_ROLE_NAME" \
  --policy-name iam_project_scope \
  --policy-document "$IAM_SCOPE_POLICY_URI"

# Save final role ARN.
OIDC_ROLE_ARN=$(aws iam get-role \
  --role-name "$OIDC_ROLE_NAME" \
  --query 'Role.Arn' \
  --output text)
echo "$OIDC_ROLE_ARN"
```

---

## Step 3 — Set GitHub secrets

For smoke deploys, only the AWS secrets and `ANSIBLE_VAULT_PASSWORD` are
required. Vercel secrets become mandatory for the production phase.

```bash
MSYS_NO_PATHCONV=1 gh secret set AWS_ROLE_TO_ASSUME --body "$OIDC_ROLE_ARN"
MSYS_NO_PATHCONV=1 gh secret set AWS_REGION --body "$REGION"
```

Production-only Vercel secrets:

```bash
MSYS_NO_PATHCONV=1 gh secret set VERCEL_TOKEN
MSYS_NO_PATHCONV=1 gh secret set VERCEL_ORG_ID
MSYS_NO_PATHCONV=1 gh secret set VERCEL_PROJECT_ID
```

Set `ANSIBLE_VAULT_PASSWORD` after Step 7, once you have chosen the vault
password. GitHub Actions needs both the committed encrypted `vault.yml` and this
secret.

---

## Step 4 — Create the ECR repository if missing

The ECR repo is not managed by Terraform. Create it once manually, or confirm
it already exists:

```bash
aws ecr describe-repositories \
  --repository-names onboarding-platform \
  --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository \
    --repository-name onboarding-platform \
    --image-scanning-configuration scanOnPush=true \
    --region "$REGION"
```

---

## Step 5 — Apply the root Terraform module

Run from WSL, with the Ansible venv active if that is the shell you are using
for the deploy.

```bash
cd infra/terraform
terraform init          # connects to the pre-existing S3 backend
terraform plan -out=tfplan
```

On a fresh smoke deploy, the expected plan is:

```text
Plan: 35 to add, 0 to change, 0 to destroy.
```

If a previous apply partially succeeded, do not reuse the old plan file. Fix the
root cause, run `terraform plan -out=tfplan` again, and apply the new plan. In
this deploy, EC2 creation required `ebs_volume_size = 30` because the selected
AL2023 AMI root snapshot is 30 GiB.

If a plan wants to replace the ALB security group only because its description
changed, make sure Terraform creates the new security group before destroying
the old one. The current module uses `onboarding-platform-alb-public-sg` with
`create_before_destroy` for that migration.

If the plan has `0 to destroy` and is saved to `tfplan`, apply exactly that
saved plan:

```bash
terraform apply tfplan
terraform output
ALB=$(terraform output -raw alb_dns_name)
API_SMOKE_ORIGIN="http://${ALB}"
echo "$API_SMOKE_ORIGIN"
```

`terraform apply tfplan` creates billable AWS resources. For this smoke fleet,
expect EC2 instances, EBS volumes, an ALB, and VPC endpoints to start accruing
cost until teardown.

This smoke deploy intentionally omits `TF_VAR_alb_certificate_arn`; the ALB
starts with HTTP only so the backend can be verified before the browser-ready
HTTPS cutover.

Creates: VPC, subnets, 6 security groups (ALB, app, worker, db, monitoring,
endpoint), 5 x t2.micro EC2s with 30 GiB gp3 root volumes, ALB + listener +
target group, and SSM/ECR/S3 VPC endpoints.

After apply, open the AWS console → Systems Manager → Fleet Manager and
confirm all 5 instances appear before continuing. They need ~60 seconds
to register.

---

## Step 6 — Build and push the Docker image

Run from the repo root.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION="${REGION:-us-east-1}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
DATE=$(date +%Y%m%d)
SHORT_SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=format:"%s" | tr ' ' '-' | tr -cd '[:alnum:]-' | cut -c1-30)
TAG="${DATE}-${SHORT_SHA}-${MSG}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR"

# Build context MUST be the repo root — Dockerfile reads client/src/types/
docker build -t "${ECR}/onboarding-platform:${TAG}" \
  -f server/Dockerfile .

docker push "${ECR}/onboarding-platform:${TAG}"

# Keep this in the shell for Step 8 so render-inventory.sh pins this image.
export DEPLOY_IMAGE_TAG="$TAG"
```

---

## Step 7 — Create and encrypt the Ansible vault

```bash
cp infra/ansible/group_vars/all/vault.yml.example \
   infra/ansible/group_vars/all/vault.yml
```

Edit `vault.yml` — replace every `CHANGE_ME_BEFORE_ENCRYPTING`:

| Key | How to generate |
|-----|-----------------|
| `onboarding_platform_db_password` | `openssl rand -base64 24` |
| `onboarding_platform_jwt_secret` | `openssl rand -base64 48` (min 32 chars) |
| `onboarding_platform_grafana_admin_password` | Choose a password |

Encrypt:

```bash
cd infra/ansible/group_vars/all
ansible-vault encrypt vault.yml
# enter a password — this becomes ANSIBLE_VAULT_PASSWORD in GitHub
```

Set the GitHub secret:

```bash
MSYS_NO_PATHCONV=1 gh secret set ANSIBLE_VAULT_PASSWORD
```

Commit the encrypted vault file. Do not commit plaintext vault copies.

```bash
git add vault.yml
```

Return to the repo root before Step 8:

```bash
cd ../../../..
```

---

## Step 8 — Render inventory and run Ansible

Run this step only after resolving the no-NAT artifact access caveat above. In
the current repo, the Ansible roles need access to GitHub and `rpm.grafana.com`
for first install unless you pre-stage those artifacts or patch the roles.

```bash
# From repo root
bash scripts/render-inventory.sh     # terraform output → hosts.yml

# Install collections (once per machine)
pip install ansible boto3 botocore
ansible-galaxy collection install -r infra/ansible/requirements.yml

# Run the full fleet
cd infra/ansible
export ANSIBLE_CONFIG="$PWD/ansible.cfg"   # needed when repo lives under /mnt/c in WSL
FRONTEND_ORIGIN="https://placeholder.invalid"
ansible-playbook playbooks/site.yml \
  --ask-vault-pass \
  -e "onboarding_platform_frontend_origin=${FRONTEND_ORIGIN}"
```

Ansible connects to each EC2 via SSM — no SSH keys, no bastion, no key
pair prompt. The `common` role runs first on all hosts, then `db`,
`worker`, `app`, `prometheus`, `grafana` in dependency order.

`render-inventory.sh` now fails early if the SSM transfer bucket is missing or
inaccessible, and writes `ansible_aws_ssm_bucket_name` into
`infra/ansible/inventory/hosts.yml`. The default bucket name is
`onboarding-platform-ssm-<account-id>` unless you override it with
`ANSIBLE_SSM_BUCKET`.

Use `https://placeholder.invalid` only for backend smoke deploys before the
frontend exists on Vercel. Once Vercel gives you a real production URL,
rerun this playbook with that real frontend origin so CORS and portal links
match the deployed client.

Return to the repo root before Step 9:

```bash
cd ../..
```

---

## Step 9 — Verify

Run from the repo root.

```bash
ALB=$(cd infra/terraform && terraform output -raw alb_dns_name)

# API health check; this verifies the backend is reachable through the ALB.
curl -sf "http://${ALB}/health"
# Expected: {"status":"ok"}

# Grafana UI — SSM port-forward, then open http://localhost:3000
GRAF=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.grafana')
aws ssm start-session --target "$GRAF" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

Grafana credentials: admin / `onboarding_platform_grafana_admin_password` from vault.

Also verify Prometheus. Run this in a second terminal, or close the Grafana SSM
session first, then open `http://localhost:9090`:

```bash
PROM=$(cd infra/terraform && terraform output -json instance_ids | jq -r '.prometheus')
aws ssm start-session --target "$PROM" \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["9090"],"localPortNumber":["9090"]}'
```

In Prometheus, confirm that:

- the `node` targets are up for all five EC2s
- the `api` target is up on `app:3000/metrics`
- `bullmq_queue_depth`, `bullmq_jobs_active`, `bullmq_jobs_completed`, and
  `bullmq_jobs_failed` exist after the API has been running for at least 30 s

---

## Step 10 — Production HTTPS Cutover

Run this only after Step 9 proves the backend is healthy through the ALB smoke
URL.

Production requires:

- a real HTTPS API origin, for example `https://api.example.com`
- an ACM certificate ARN for that API domain in `us-east-1`
- Vercel Production `VITE_API_BASE_URL` set to the same HTTPS API origin

Set the API origin in Vercel Production. You can do this in the Vercel
dashboard, or from the client project if your local Vercel CLI is linked:

```bash
FINAL_API_ORIGIN="https://api.example.com"
cd client
printf '%s' "$FINAL_API_ORIGIN" | npx vercel env add VITE_API_BASE_URL production
cd ..
```

Then run production preflight:

```bash
FINAL_API_ORIGIN=https://api.example.com \
TF_VAR_alb_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id \
ARTIFACT_STRATEGY=controlled-outbound \
bash ./scripts/deploy-preflight.sh --phase=production
```

After production preflight passes, apply Terraform again with the real
certificate ARN so the ALB gets its HTTPS listener:

```bash
cd infra/terraform
export TF_VAR_alb_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id
terraform plan -out=tfplan
terraform apply tfplan
cd ../..
```

## Step 11 — Hand Off To CI

From this point, push to `main`. The three workflows own future code deploys:

| Push touches | Workflow | What runs |
|---|---|---|
| `client/` | `client.yml` | lint → test → build → Vercel deploy |
| `server/` | `server.yml` | lint → test → Docker build → push ECR |
| `infra/` or `monitoring/` | `infra.yml` | fmt/validate → plan (PR) → apply + Ansible + ALB smoke test (main); requires artifact access strategy |

The encrypted vault file is committed. GitHub Actions receives the password
through `ANSIBLE_VAULT_PASSWORD`, decrypts the committed vault at runtime, and
does not persist plaintext secrets.

To monitor the current run:

```bash
gh run list --limit 5
RUN_ID=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID"
```

---

## Quick-reference: secret inventory

| Where | Secret | Value |
|-------|--------|-------|
| GitHub secret | `AWS_ROLE_TO_ASSUME` | OIDC role ARN from account prerequisite setup |
| GitHub secret | `AWS_REGION` | `us-east-1` |
| GitHub secret | `ANSIBLE_VAULT_PASSWORD` | Password you chose in step 7 |
| Vercel env | `VITE_API_BASE_URL` | Production API origin used by the client bundle |
| GitHub secret | `VERCEL_TOKEN` | From Vercel account settings |
| GitHub secret | `VERCEL_ORG_ID` | From Vercel account settings |
| GitHub secret | `VERCEL_PROJECT_ID` | From Vercel project settings |
| Tracked file | `infra/ansible/group_vars/all/vault.yml` | Encrypted with Ansible Vault |
| Local shell | `AWS_PROFILE=onboarding` | Optional; set only if you created and want to use that named profile |
| `.env` | `JWT_SECRET` | Local dev only — never matches production |

No EC2 key pairs. No static AWS access keys in GitHub. No secrets in `.env`
beyond local dev values.
