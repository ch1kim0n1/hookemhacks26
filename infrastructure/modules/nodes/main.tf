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
}

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# ECR repository — one repo, all three node tasks pull the same image. We
# distinguish nodes by env vars on the task definitions, not by container
# image, to keep deploys simple: one `docker push` updates all three nodes.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "node" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # demo: destroy-friendly
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.envelope_kms_arn
  }
}

resource "aws_ecr_lifecycle_policy" "node" {
  repository = aws_ecr_repository.node.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 10 images — demo never needs more."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# ECS cluster
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = var.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# ---------------------------------------------------------------------------
# Task execution role — shared by all three node task definitions. Pulls the
# image, writes to CloudWatch Logs, reads Secrets Manager secrets referenced
# in the task definition `secrets` block. NOT the node identity role (that's
# the per-node task role minted by the node-signer module).
# ---------------------------------------------------------------------------

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
  name               = "${var.name}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "exec_inline" {
  statement {
    sid     = "ReadNodeSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = length(var.readable_secret_arns) > 0 ? var.readable_secret_arns : ["*"]
  }

  statement {
    sid     = "DecryptSecrets"
    effect  = "Allow"
    actions = ["kms:Decrypt", "kms:DescribeKey"]
    resources = [var.envelope_kms_arn]
  }
}

resource "aws_iam_role_policy" "exec_inline" {
  name   = "${var.name}-exec-inline"
  role   = aws_iam_role.exec.id
  policy = data.aws_iam_policy_document.exec_inline.json
}

# ---------------------------------------------------------------------------
# Per-node task definitions + services
#
# Input `var.nodes` is a map: { node_id => { task_role_arn, kms_key_arn, ... }}.
# For each entry we emit one task definition + one service.
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
  task_role_arn            = each.value.task_role_arn
  tags                     = merge(local.tags, { Node = each.key })

  container_definitions = jsonencode([
    {
      name      = "node"
      image     = var.container_image
      essential = true

      environment = concat(
        [
          { name = "CLAWGUARD_NODE_ID", value = each.key },
          { name = "CLAWGUARD_KMS_KEY_ID", value = each.value.kms_key_arn },
          { name = "CLAWGUARD_API_ENDPOINT", value = var.api_endpoint },
          { name = "CLAWGUARD_BEDROCK_MODEL_ID", value = var.bedrock_model_id },
          { name = "CLAWGUARD_REGISTRY_ADDRESS", value = var.registry_address },
          { name = "BASE_SEPOLIA_RPC_URL", value = var.base_sepolia_rpc_url },
          { name = "AWS_REGION", value = data.aws_region.current.name },
          { name = "LOG_FORMAT", value = "json" },
        ],
        var.extra_environment,
      )

      secrets = [
        for k, arn in var.secret_refs :
        { name = k, valueFrom = arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.node[each.key].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = each.key
        }
      }

      # Read-only root filesystem: any secret that does need to hit disk must
      # be explicitly mounted — the default is "no writes allowed anywhere".
      readonlyRootFilesystem = true

      # Drop all Linux capabilities except the ones we actually need (none).
      linuxParameters = {
        capabilities = {
          drop = ["ALL"]
        }
      }

      # 1Gi ephemeral tmpfs so Python can still use /tmp for small scratch.
      mountPoints = [
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
      ]
    },
  ])

  volume {
    name = "tmp"
  }
}

resource "aws_ecs_service" "node" {
  for_each = var.nodes

  name            = "${var.name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.node[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"
  tags            = merge(local.tags, { Node = each.key })

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.task_security_group_id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  propagate_tags = "SERVICE"
}
