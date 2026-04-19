terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

locals {
  tags = merge({ Component = var.name }, var.tags)

  # Two AZs for HA; Fargate won't schedule a service with only one reachable
  # subnet if that AZ blips.
  az_count = 2

  private_subnet_cidrs = [
    cidrsubnet(var.vpc_cidr, 4, 0),
    cidrsubnet(var.vpc_cidr, 4, 1),
  ]
  public_subnet_cidrs = [
    cidrsubnet(var.vpc_cidr, 4, 8),
    cidrsubnet(var.vpc_cidr, 4, 9),
  ]
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# VPC + subnets
#
# Topology:
#   - 2 public subnets  → hold the single NAT Gateway + internet gateway route
#   - 2 private subnets → hold the Fargate tasks, no route to IGW
#
# Egress to AWS APIs (KMS, Secrets Manager, Bedrock, Logs, ECR) traverses
# PrivateLink interface endpoints and never touches the internet. Egress to
# Base Sepolia RPC (api.basechain, sepolia.base.org, Alchemy, etc.) goes
# through the NAT only — tight SG restricts that to tcp/443.
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = var.name })
}

resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
  tags = merge(local.tags, {
    Name = "${var.name}-public-${count.index}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count = local.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = merge(local.tags, {
    Name = "${var.name}-private-${count.index}"
    Tier = "private"
  })
}

# ---------------------------------------------------------------------------
# Internet + NAT
# ---------------------------------------------------------------------------

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-igw" })
}

# One EIP for the NAT so egress has a stable source IP (handy if you later
# allowlist ClawGuard nodes at an RPC provider).
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name}-nat-eip" })
}

# Single NAT gateway in AZ 0. Two NATs would give per-AZ HA but double the
# cost; for the demo one is plenty (tasks still span both AZs, they just
# share the NAT).
resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(local.tags, { Name = "${var.name}-nat" })

  depends_on = [aws_internet_gateway.this]
}

# ---------------------------------------------------------------------------
# Route tables
# ---------------------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-public-rt" })
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-private-rt" })
}

resource "aws_route" "private_default" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this.id
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ---------------------------------------------------------------------------
# Security groups
#
# - `task_sg`: attached to Fargate tasks. Outbound only. 443 anywhere for
#   chain RPC + AWS APIs; 53 to the VPC resolver for name lookups.
# - `endpoint_sg`: attached to interface VPC endpoints. Accepts 443 from the
#   task SG only.
# ---------------------------------------------------------------------------

resource "aws_security_group" "task" {
  name        = "${var.name}-task-sg"
  description = "Egress-only SG for ClawGuard Fargate tasks. No ingress."
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${var.name}-task-sg" })
}

resource "aws_vpc_security_group_egress_rule" "task_https" {
  security_group_id = aws_security_group.task.id
  description       = "Outbound HTTPS (AWS APIs, RPC endpoints)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_security_group" "endpoint" {
  name        = "${var.name}-endpoint-sg"
  description = "Ingress SG for VPC interface endpoints; accepts only from the task SG."
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${var.name}-endpoint-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "endpoint_from_tasks" {
  security_group_id            = aws_security_group.endpoint.id
  description                  = "HTTPS from ClawGuard tasks"
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "endpoint_all" {
  security_group_id = aws_security_group.endpoint.id
  description       = "Default allow-all egress"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ---------------------------------------------------------------------------
# VPC endpoints
#
# Interface endpoints for each AWS service the tasks + Lambdas actually call.
# Traffic for these services never leaves AWS's network. Gateway endpoint for
# S3 is free (ECR uses it for image layers).
# ---------------------------------------------------------------------------

locals {
  interface_endpoint_services = toset([
    "kms",
    "secretsmanager",
    "bedrock-runtime",
    "logs",
    "ecr.api",
    "ecr.dkr",
    "execute-api",
    "sts",
  ])
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoint_services

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoint.id]
  private_dns_enabled = true
  tags = merge(local.tags, {
    Name    = "${var.name}-${each.value}-endpoint"
    Service = each.value
  })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = merge(local.tags, { Name = "${var.name}-s3-endpoint" })
}
