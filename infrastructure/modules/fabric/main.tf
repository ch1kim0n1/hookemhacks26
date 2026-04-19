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
  tags = merge({ Component = var.name, Env = "prod" }, var.tags)

  # Deterministic node ID ordering so listener-rule priorities are stable.
  node_ids_sorted = sort(keys(var.nodes))

  # Full mesh JSON — same on every task so any node can serve /api/network/topology.
  topology = {
    nodes = [for id in local.node_ids_sorted : {
      id     = id
      role   = var.nodes[id].role
      region = var.nodes[id].region
      tenant = var.nodes[id].tenant
    }]
    edges = flatten([
      for src_id in local.node_ids_sorted : [
        for dst_id in var.nodes[src_id].peer_ids : {
          from = src_id
          to   = dst_id
        }
      ]
    ])
  }

  topology_json = jsonencode(local.topology)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# VPC + 2 public subnets. Tasks live in public subnets with public IPs so
# they can pull ECR images without a NAT Gateway ($1.05/day saved). Security
# groups restrict inbound to the ALB SG only; egress is open for ECR + RPC.
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(local.tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-igw" })
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, {
    Name = "${var.name}-public-${count.index}"
    Tier = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-public" })

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "ALB ingress from the public internet (80 only; judges get plain http for demo)."
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${var.name}-alb" })

  ingress {
    description = "HTTP from anywhere (demo; no TLS to avoid ACM)."
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "Fargate tasks; inbound only from ALB SG on app port."
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${var.name}-tasks" })

  ingress {
    description     = "App port from ALB"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# ALB + listener + per-node target groups and listener rules
# ---------------------------------------------------------------------------

resource "aws_lb" "this" {
  name               = var.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 60
  tags               = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = jsonencode({
        error = "no route matched; dashboard should call /n/{node_id}/api/..."
      })
      status_code = "404"
    }
  }

  tags = local.tags
}

resource "aws_lb_target_group" "node" {
  for_each = var.nodes

  name        = substr("${var.name}-${replace(each.key, "_", "-")}", 0, 32)
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  health_check {
    path                = "/n/${each.key}/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  deregistration_delay = 15
  tags                 = merge(local.tags, { Node = each.key })
}

# Listener rules — one per node. Priority derived from sorted index so it's stable.
resource "aws_lb_listener_rule" "node" {
  for_each = var.nodes

  listener_arn = aws_lb_listener.http.arn
  priority     = 100 + index(local.node_ids_sorted, each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.node[each.key].arn
  }

  condition {
    path_pattern {
      values = ["/n/${each.key}/*"]
    }
  }

  tags = merge(local.tags, { Node = each.key })
}

# ---------------------------------------------------------------------------
# ECS cluster + task execution role
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = var.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "disabled" # save a few $/mo for demo
  }
}

data "aws_iam_policy_document" "exec_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "exec" {
  name               = "${var.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role (application identity). Minimal — just logs + sts for now so
# /api/aws/status can resolve caller identity.
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task_inline" {
  statement {
    sid       = "StsIdentity"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "task_inline" {
  name   = "${var.name}-task-inline"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_inline.json
}

# ---------------------------------------------------------------------------
# Log group + task definition + service per node
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "node" {
  for_each = var.nodes

  name              = "/aws/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = merge(local.tags, { Node = each.key })
}

resource "aws_ecs_task_definition" "node" {
  for_each = var.nodes

  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.exec.arn
  task_role_arn            = aws_iam_role.task.arn
  tags                     = merge(local.tags, { Node = each.key })

  container_definitions = jsonencode([
    {
      name      = "node"
      image     = var.container_image
      essential = true

      portMappings = [
        { containerPort = 8000, hostPort = 8000, protocol = "tcp" }
      ]

      environment = [
        { name = "CLAWGUARD_NODE_ID", value = each.key },
        { name = "CLAWGUARD_NODE_ROLE", value = each.value.role },
        { name = "CLAWGUARD_NODE_REGION", value = each.value.region },
        { name = "CLAWGUARD_NODE_TENANT", value = each.value.tenant },
        { name = "CLAWGUARD_PATH_PREFIX", value = "/n/${each.key}" },
        { name = "CLAWGUARD_TOPOLOGY_JSON", value = local.topology_json },
        { name = "CLAWGUARD_PEER_URLS", value = join(",", [for p in each.value.peer_ids : "http://${aws_lb.this.dns_name}/n/${p}"]) },
        { name = "CLAWGUARD_REGISTRY_ADDRESS", value = var.registry_address },
        { name = "BASE_SEPOLIA_RPC_URL", value = var.base_sepolia_rpc_url },
        { name = "CORS_ORIGINS", value = var.cors_origins },
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "REQUIRE_ADMIN_TOKEN", value = "false" },
        { name = "REQUIRE_METRICS_TOKEN", value = "false" },
        { name = "EXPOSE_OPENAPI", value = "true" },
        # Fargate tasks have no writable mount for the repo-root default
        # ./clawguard.db. skill/db_path.py already redirects the SQLite path
        # to /tmp when VERCEL is set — piggy-back on that switch.
        { name = "VERCEL", value = "1" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.node[each.key].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = each.key
        }
      }
    },
  ])
}

resource "aws_ecs_service" "node" {
  for_each = var.nodes

  name            = "${var.name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.node[each.key].arn
  desired_count   = 1
  launch_type     = var.use_fargate_spot ? null : "FARGATE"
  tags            = merge(local.tags, { Node = each.key })

  dynamic "capacity_provider_strategy" {
    for_each = var.use_fargate_spot ? [1] : []
    content {
      capacity_provider = "FARGATE_SPOT"
      weight            = 1
      base              = 0
    }
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.node[each.key].arn
    container_name   = "node"
    container_port   = 8000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = 90
  depends_on                        = [aws_lb_listener.http, aws_lb_listener_rule.node]

  propagate_tags = "SERVICE"
}

# Ensure the cluster knows about Fargate Spot
resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 0
    weight            = 1
    capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
  }
}
