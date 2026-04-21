#!/usr/bin/env bash
# Regenerate inventory/hosts.yml from Terraform outputs + STS (ECR registry URI).
# Run after `terraform apply` in infra/terraform/. Requires terraform, jq, aws.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TF_DIR="$(cd "${ANSIBLE_DIR}/../terraform" && pwd)"
INV_OUT="${ANSIBLE_DIR}/inventory/hosts.yml"

for cmd in terraform jq aws; do
  command -v "${cmd}" >/dev/null 2>&1 || {
    echo "error: ${cmd} not found in PATH" >&2
    exit 1
  }
done

JSON="$(terraform -chdir="${TF_DIR}" output -json)"
REGION="$(echo "${JSON}" | jq -r '.region.value')"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
PROJECT_NAME="$(echo "${JSON}" | jq -r '.project_name.value')"

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_DEFAULT="${REGISTRY}/${PROJECT_NAME}:latest"

role_id() {
  local r="$1"
  echo "${JSON}" | jq -r --arg role "$r" '.instance_ids.value[$role]'
}

role_ip() {
  local r="$1"
  echo "${JSON}" | jq -r --arg role "$r" '.instance_private_ips.value[$role]'
}

mkdir -p "$(dirname "${INV_OUT}")"

cat >"${INV_OUT}" <<EOF
---
all:
  vars:
    ansible_connection: amazon.aws.aws_ssm
    ansible_aws_ssm_region: ${REGION}
    ansible_user: ec2-user
    ansible_python_interpreter: /usr/bin/python3
    aws_region: ${REGION}
    ecr_registry: ${REGISTRY}
    onboarding_platform_ecr_repository: ${PROJECT_NAME}
    onboarding_platform_container_image: ${IMAGE_DEFAULT}
  children:
    app:
      hosts:
        onboarding-app:
          ansible_host: $(role_id app)
          private_ip: $(role_ip app)
    worker:
      hosts:
        onboarding-worker:
          ansible_host: $(role_id worker)
          private_ip: $(role_ip worker)
    db:
      hosts:
        onboarding-db:
          ansible_host: $(role_id db)
          private_ip: $(role_ip db)
    prometheus:
      hosts:
        onboarding-prometheus:
          ansible_host: $(role_id prometheus)
          private_ip: $(role_ip prometheus)
    grafana:
      hosts:
        onboarding-grafana:
          ansible_host: $(role_id grafana)
          private_ip: $(role_ip grafana)
EOF

echo "Wrote ${INV_OUT} (edit onboarding_platform_container_image after first ECR push if needed)"
