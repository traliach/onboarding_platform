#!/usr/bin/env bash
# Read-only deploy readiness checks for onboarding_platform.
# Runs from any directory; reports missing prerequisites before a first deploy.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}" || exit 1

REGION="${AWS_REGION:-${REGION:-us-east-1}}"
PROJECT_NAME="${PROJECT_NAME:-onboarding-platform}"
STATE_BUCKET="${TF_STATE_BUCKET:-achille-tf-state}"
LOCK_TABLE="${TF_LOCK_TABLE:-onboarding-platform-tf-lock}"
OIDC_ROLE_NAME="${OIDC_ROLE_NAME:-onboarding-platform-github-actions}"
ECR_REPOSITORY="${ECR_REPOSITORY:-${PROJECT_NAME}}"
VAULT_FILE="infra/ansible/group_vars/all/vault.yml"

FAILURES=0
WARNINGS=0
LOCAL_ONLY=false
PHASE="smoke"

for arg in "$@"; do
  case "${arg}" in
    --local-only)
      LOCAL_ONLY=true
      ;;
    --phase=smoke)
      PHASE="smoke"
      ;;
    --phase=production)
      PHASE="production"
      ;;
    --production)
      PHASE="production"
      ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/deploy-preflight.sh [--phase=smoke|production] [--local-only]

Checks deploy prerequisites without changing AWS, GitHub, Vercel, Terraform, or
Ansible state. Use --local-only to skip cloud/API checks and validate only local
tooling, repo policy, and configuration shape.

Phases:
  smoke       First backend deploy. Allows HTTP ALB smoke checks and does not
              require DNS, ACM, FINAL_API_ORIGIN, or Vercel env yet. Default.
  production  Browser-ready deploy. Requires HTTPS API origin, ACM certificate,
              and Vercel Production VITE_API_BASE_URL.

Important environment variables:
  AWS_REGION or REGION                 AWS region, default us-east-1
  AWS_ACCOUNT_ID                       optional expected AWS account guard
  ANSIBLE_SSM_BUCKET                   optional S3 bucket for Ansible-over-SSM;
                                       default <project>-ssm-<account-id>
  FINAL_API_ORIGIN                     production browser API origin, must be https://
  TF_VAR_alb_certificate_arn           production ACM certificate ARN for ALB HTTPS
  ARTIFACT_STRATEGY                    one of controlled-outbound, s3-artifacts, prebaked-ami
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

ok() {
  printf 'OK   %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN %s\n' "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL %s\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  if have "$1"; then
    ok "$1 is installed"
  else
    fail "$1 is missing"
  fi
}

section() {
  printf '\n== %s ==\n' "$1"
}

section "Local tooling"
ok "preflight phase: ${PHASE}"
for cmd in aws terraform docker jq gh node npm npx openssl git; do
  require_cmd "${cmd}"
done

if have ansible-playbook; then
  ok "ansible-playbook is installed"
else
  fail "ansible-playbook is missing"
fi

if have ansible-galaxy; then
  ok "ansible-galaxy is installed"
  if ansible-galaxy collection list amazon.aws >/dev/null 2>&1; then
    ok "amazon.aws Ansible collection is installed"
  else
    fail "amazon.aws Ansible collection is missing; run ansible-galaxy collection install -r infra/ansible/requirements.yml"
  fi
  if ansible-galaxy collection list community.postgresql >/dev/null 2>&1; then
    ok "community.postgresql Ansible collection is installed"
  else
    fail "community.postgresql Ansible collection is missing; run ansible-galaxy collection install -r infra/ansible/requirements.yml"
  fi
else
  fail "ansible-galaxy is missing"
fi

if have docker; then
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon is reachable"
  else
    fail "Docker is installed but the daemon is not reachable"
  fi
fi

if have terraform; then
  if terraform version >/dev/null 2>&1; then
    ok "terraform version command works"
  else
    fail "terraform is installed but not runnable"
  fi
  if terraform fmt -check -recursive infra/terraform >/dev/null 2>&1; then
    ok "terraform fmt is clean"
  else
    fail "terraform fmt check failed; run terraform fmt -recursive infra/terraform"
  fi
fi

section "Vault policy"
if [[ -f "${VAULT_FILE}" ]]; then
  if head -n 1 "${VAULT_FILE}" | grep -q '^\$ANSIBLE_VAULT;'; then
    ok "${VAULT_FILE} exists and is encrypted"
  else
    fail "${VAULT_FILE} exists but is not Ansible Vault encrypted"
  fi

  if git check-ignore -q "${VAULT_FILE}"; then
    fail "${VAULT_FILE} is still ignored; encrypted vault.yml must be committed for CI"
  else
    ok "${VAULT_FILE} is not ignored"
  fi

  if git ls-files --error-unmatch "${VAULT_FILE}" >/dev/null 2>&1; then
    ok "${VAULT_FILE} is tracked by git"
  else
    fail "${VAULT_FILE} is not tracked; run git add ${VAULT_FILE} after encrypting it"
  fi
else
  fail "${VAULT_FILE} is missing; copy vault.yml.example, fill real values, ansible-vault encrypt it, then git add it"
fi

if [[ "${PHASE}" == "production" ]]; then
  section "HTTPS production origin"
  FINAL_API_ORIGIN="${FINAL_API_ORIGIN:-}"
  if [[ "${FINAL_API_ORIGIN}" == https://* ]]; then
    ok "FINAL_API_ORIGIN is HTTPS"
  else
    fail "FINAL_API_ORIGIN must be set to the final HTTPS API origin, for example https://api.example.com"
  fi

  CERT_ARN="${TF_VAR_alb_certificate_arn:-${ALB_CERTIFICATE_ARN:-}}"
  if [[ -z "${CERT_ARN}" && -f "infra/terraform/terraform.tfvars" ]]; then
    if grep -Eq '^[[:space:]]*alb_certificate_arn[[:space:]]*=[[:space:]]*"arn:aws[^"]+:acm:' infra/terraform/terraform.tfvars; then
      CERT_ARN="set-in-terraform.tfvars"
    fi
  fi

  if [[ "${CERT_ARN}" == set-in-terraform.tfvars ]]; then
    ok "alb_certificate_arn is set in infra/terraform/terraform.tfvars"
  elif [[ "${CERT_ARN}" =~ ^arn:[^:]+:acm:[a-z0-9-]+:[0-9]{12}:certificate/.+ ]]; then
    ok "ALB ACM certificate ARN is set"
  else
    fail "Set TF_VAR_alb_certificate_arn or infra/terraform/terraform.tfvars alb_certificate_arn before browser-ready production deploy"
  fi
else
  section "HTTPS production origin"
  warn "Skipped HTTPS API origin and ACM certificate checks for smoke phase"
fi

section "Artifact access decision"
ARTIFACT_STRATEGY="${ARTIFACT_STRATEGY:-}"
case "${ARTIFACT_STRATEGY}" in
  controlled-outbound|s3-artifacts|prebaked-ami)
    ok "ARTIFACT_STRATEGY=${ARTIFACT_STRATEGY}"
    ;;
  "")
    fail "ARTIFACT_STRATEGY is unset; choose controlled-outbound, s3-artifacts, or prebaked-ami for Ansible package downloads"
    ;;
  *)
    fail "ARTIFACT_STRATEGY must be controlled-outbound, s3-artifacts, or prebaked-ami"
    ;;
esac

if [[ "${LOCAL_ONLY}" == true ]]; then
  section "Cloud checks"
  warn "Skipped AWS/GitHub/Vercel checks because --local-only was set"
else
  section "AWS account prerequisites"
  if have aws && have jq; then
    IDENTITY="$(aws sts get-caller-identity --output json 2>/dev/null || true)"
    if [[ -n "${IDENTITY}" ]]; then
      ACCOUNT_ID="$(printf '%s' "${IDENTITY}" | jq -r '.Account // empty')"
      ok "AWS credentials are valid for account ${ACCOUNT_ID}"
      if [[ -n "${AWS_ACCOUNT_ID:-}" && "${ACCOUNT_ID}" != "${AWS_ACCOUNT_ID}" ]]; then
        fail "AWS account mismatch: expected AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID}, got ${ACCOUNT_ID}"
      fi

      SSM_BUCKET_DEFAULT="$(printf '%s' "${PROJECT_NAME}-ssm-${ACCOUNT_ID}" | tr '[:upper:]' '[:lower:]')"
      SSM_BUCKET="${ANSIBLE_SSM_BUCKET:-${SSM_BUCKET_DEFAULT}}"
    else
      fail "AWS credentials are not valid; run aws sso login or set AWS_PROFILE"
    fi

    if aws s3api head-bucket --bucket "${STATE_BUCKET}" >/dev/null 2>&1; then
      ok "Terraform state bucket exists: ${STATE_BUCKET}"
    else
      fail "Terraform state bucket missing or inaccessible: ${STATE_BUCKET}"
    fi

    if aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${REGION}" >/dev/null 2>&1; then
      ok "Terraform lock table exists: ${LOCK_TABLE}"
    else
      fail "Terraform lock table missing or inaccessible: ${LOCK_TABLE}"
    fi

    if aws iam get-role --role-name "${OIDC_ROLE_NAME}" >/dev/null 2>&1; then
      ok "GitHub OIDC role exists: ${OIDC_ROLE_NAME}"
    else
      fail "GitHub OIDC role missing or inaccessible: ${OIDC_ROLE_NAME}"
    fi

    if aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${REGION}" >/dev/null 2>&1; then
      ok "ECR repository exists: ${ECR_REPOSITORY}"
    else
      fail "ECR repository missing or inaccessible: ${ECR_REPOSITORY}"
    fi

    if [[ -n "${SSM_BUCKET:-}" ]]; then
      if aws s3api head-bucket --bucket "${SSM_BUCKET}" >/dev/null 2>&1; then
        ok "Ansible SSM transfer bucket exists: ${SSM_BUCKET}"
      else
        fail "Ansible SSM transfer bucket missing or inaccessible: ${SSM_BUCKET}"
      fi
    fi
  else
    fail "Skipping AWS checks because aws or jq is missing"
  fi

  section "GitHub Actions secrets"
  if have gh && gh auth status >/dev/null 2>&1; then
    ok "gh is authenticated"
    GH_SECRETS="$(gh secret list --json name -q '.[].name' 2>/dev/null || true)"
    if [[ -z "${GH_SECRETS}" ]]; then
      fail "Could not list GitHub secrets for this repository"
    else
      REQUIRED_SECRETS="AWS_ROLE_TO_ASSUME AWS_REGION ANSIBLE_VAULT_PASSWORD"
      if [[ "${PHASE}" == "production" ]]; then
        REQUIRED_SECRETS="${REQUIRED_SECRETS} VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID"
      fi
      for secret in ${REQUIRED_SECRETS}; do
        if printf '%s\n' "${GH_SECRETS}" | grep -qx "${secret}"; then
          ok "GitHub secret exists: ${secret}"
        else
          fail "GitHub secret missing: ${secret}"
        fi
      done
      if [[ "${PHASE}" == "smoke" ]]; then
        for secret in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do
          if printf '%s\n' "${GH_SECRETS}" | grep -qx "${secret}"; then
            ok "GitHub secret exists: ${secret}"
          else
            warn "GitHub secret not checked for smoke phase: ${secret}"
          fi
        done
      fi
    fi
  else
    fail "gh is not authenticated for this repository"
  fi

  if [[ "${PHASE}" == "production" ]]; then
    section "Vercel environment"
    if have vercel; then
      VERCEL_ENV="$(cd client && vercel env ls production 2>/dev/null || true)"
      if printf '%s\n' "${VERCEL_ENV}" | grep -q 'VITE_API_BASE_URL'; then
        ok "Vercel Production env has VITE_API_BASE_URL"
      else
        fail "Vercel Production env is missing VITE_API_BASE_URL"
      fi
    else
      warn "vercel CLI is not installed globally; verify VITE_API_BASE_URL in the Vercel dashboard or install vercel and rerun"
    fi
  else
    section "Vercel environment"
    warn "Skipped Vercel Production env checks for smoke phase"
  fi
fi

printf '\n== Result ==\n'
if [[ "${FAILURES}" -gt 0 ]]; then
  printf 'Preflight failed: %d failure(s), %d warning(s).\n' "${FAILURES}" "${WARNINGS}"
  exit 1
fi

printf 'Preflight passed: 0 failures, %d warning(s).\n' "${WARNINGS}"
