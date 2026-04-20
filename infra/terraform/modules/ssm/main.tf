data "aws_region" "current" {}

resource "aws_security_group" "endpoint" {
  name        = "${var.name_prefix}-vpce-sg"
  description = "HTTPS from the private subnet to the SSM/ECR VPC endpoints."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from private subnet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.private_subnet_cidr]
  }

  egress {
    description = "Egress to AWS service endpoints"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-sg" })
}

locals {
  # These five interface endpoints replace a NAT gateway entirely:
  # - ssm / ssmmessages / ec2messages: Session Manager + SSM agent registration
  # - ecr.api / ecr.dkr: pulling the app/worker image from ECR on the private EC2s
  interface_endpoints = toset([
    "ssm",
    "ssmmessages",
    "ec2messages",
    "ecr.api",
    "ecr.dkr",
  ])
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [var.private_subnet_id]
  security_group_ids  = [aws_security_group.endpoint.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-${each.value}" })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [var.private_route_table_id]

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-s3" })
}
