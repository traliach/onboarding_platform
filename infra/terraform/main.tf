provider "aws" {
  region = var.region
  default_tags {
    tags = local.common_tags
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)
  compute_az  = local.azs[0]
  name_prefix = var.project_name

  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

module "networking" {
  source              = "./modules/networking"
  name_prefix         = local.name_prefix
  vpc_cidr            = var.vpc_cidr
  public_subnet_cidrs = var.public_subnet_cidrs
  private_subnet_cidr = var.private_subnet_cidr
  azs                 = local.azs
  compute_az          = local.compute_az
  tags                = local.common_tags
}

module "ssm" {
  source                 = "./modules/ssm"
  name_prefix            = local.name_prefix
  vpc_id                 = module.networking.vpc_id
  private_subnet_id      = module.networking.private_subnet_id
  private_subnet_cidr    = var.private_subnet_cidr
  private_route_table_id = module.networking.private_route_table_id
  tags                   = local.common_tags
}

module "security" {
  source             = "./modules/security"
  name_prefix        = local.name_prefix
  vpc_id             = module.networking.vpc_id
  vpc_cidr           = module.networking.vpc_cidr
  allowed_http_cidrs = var.allowed_http_cidrs
  tags               = local.common_tags
}

module "compute" {
  source           = "./modules/compute"
  name_prefix      = local.name_prefix
  subnet_id        = module.networking.private_subnet_id
  ami_id           = data.aws_ami.al2023.id
  instance_type    = var.instance_type
  ebs_volume_size  = var.ebs_volume_size
  app_sg_id        = module.security.app_sg_id
  worker_sg_id     = module.security.worker_sg_id
  db_sg_id         = module.security.db_sg_id
  monitoring_sg_id = module.security.monitoring_sg_id
  tags             = local.common_tags
}

module "alb" {
  source            = "./modules/alb"
  name_prefix       = local.name_prefix
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  alb_sg_id         = module.security.alb_sg_id
  app_instance_id   = module.compute.app_instance_id
  certificate_arn   = var.alb_certificate_arn
  tags              = local.common_tags
}
