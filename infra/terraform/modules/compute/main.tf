resource "aws_iam_role" "ec2_ssm" {
  name = "${var.name_prefix}-ec2-ssm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ec2_ssm" {
  name = "${var.name_prefix}-ec2-ssm"
  role = aws_iam_role.ec2_ssm.name
}

locals {
  # Non-DB instances use `for_each`. The DB is a dedicated resource because
  # `prevent_destroy` is required (CLAUDE.md section 4) and it cannot be
  # conditionally set inside a `for_each` lifecycle block.
  non_db_instances = {
    app        = { sg_id = var.app_sg_id }
    worker     = { sg_id = var.worker_sg_id }
    prometheus = { sg_id = var.monitoring_sg_id }
    grafana    = { sg_id = var.monitoring_sg_id }
  }
}

resource "aws_instance" "fleet" {
  for_each = local.non_db_instances

  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [each.value.sg_id]
  iam_instance_profile        = aws_iam_instance_profile.ec2_ssm.name
  associate_public_ip_address = false

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ebs_volume_size
    encrypted             = true
    delete_on_termination = true
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${each.key}"
    Role = each.key
  })

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_instance" "db" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.db_sg_id]
  iam_instance_profile        = aws_iam_instance_profile.ec2_ssm.name
  associate_public_ip_address = false

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ebs_volume_size
    encrypted             = true
    delete_on_termination = false
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-db"
    Role = "db"
  })

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [ami]
  }
}
