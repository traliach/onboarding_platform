resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-public-sg"
  description = "ALB ingress from the internet; only the ALB is public."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_http_cidrs
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_http_cidrs
  }

  egress {
    description = "ALB to VPC only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-public-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app-sg"
  description = "API EC2 - API traffic from ALB, node_exporter scrape from monitoring."
  vpc_id      = var.vpc_id

  ingress {
    description     = "API port 3000 from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "node_exporter from Prometheus"
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = [aws_security_group.monitoring.id]
  }

  ingress {
    description     = "API metrics from Prometheus"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.monitoring.id]
  }

  egress {
    description = "Outbound (ECR, SSM, DB, Redis)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-app-sg" })
}

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker-sg"
  description = "Worker EC2 - Redis from app SG, node_exporter scrape from monitoring."
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from app (BullMQ queue)"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  ingress {
    description     = "node_exporter from Prometheus"
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = [aws_security_group.monitoring.id]
  }

  egress {
    description = "Outbound (ECR, SSM, DB)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-worker-sg" })
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "PostgreSQL EC2 - 5432 from app/worker, node_exporter scrape from monitoring."
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from app"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  ingress {
    description     = "PostgreSQL from worker"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  ingress {
    description     = "node_exporter from Prometheus"
    from_port       = 9100
    to_port         = 9100
    protocol        = "tcp"
    security_groups = [aws_security_group.monitoring.id]
  }

  egress {
    description = "Outbound (SSM + dnf)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-db-sg" })
}

resource "aws_security_group" "monitoring" {
  name        = "${var.name_prefix}-monitoring-sg"
  description = "Prometheus + Grafana - accepts traffic only from within the VPC."
  vpc_id      = var.vpc_id

  ingress {
    description = "Scrape + UI from inside the VPC (accessed via SSM port-forward)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Outbound (scrape targets, SSM, dnf)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-monitoring-sg" })
}
