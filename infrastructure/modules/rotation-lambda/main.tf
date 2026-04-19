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

  source_dir     = "${path.module}/../../lambdas/rotate_token"
  zip_output     = "${path.module}/build/rotate_token.zip"
  function_name  = var.name
}

# ---------------------------------------------------------------------------
# IAM — execution role + least-privilege inline policy
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

# Rotation needs: read+write on the specific secrets it's wired to, Encrypt
# and Decrypt on the KMS key those secrets are encrypted with, and write logs.
data "aws_iam_policy_document" "inline" {
  statement {
    sid = "SecretsManagerRotationOps"

    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]

    # Resource wildcard scoped by `secret_name_prefix`. Using a prefix pattern
    # instead of exact ARNs breaks the TF cycle with the secrets module
    # (secrets.rotation_lambda_arn ↔ rotation_lambda.managed_secret_arns).
    resources = [
      "arn:aws:secretsmanager:*:*:secret:${var.secret_name_prefix}/*",
    ]
  }

  statement {
    sid = "SecretsManagerRandomPassword"

    # GetRandomPassword has no resource — it's an account-wide action.
    # We don't use it (see lambdas/rotate_token/main.py) but some rotation
    # templates do, so leave it here for drop-in compatibility.
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }

  statement {
    sid = "KmsUse"

    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]

    resources = var.kms_key_arns
  }

  statement {
    sid = "Logs"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "inline" {
  name   = "${var.name}-policy"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.inline.json
}

# ---------------------------------------------------------------------------
# Lambda
# ---------------------------------------------------------------------------

data "archive_file" "src" {
  type        = "zip"
  source_dir  = local.source_dir
  output_path = local.zip_output
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "this" {
  function_name    = local.function_name
  role             = aws_iam_role.this.arn
  handler          = "main.lambda_handler"
  runtime          = "python3.12"
  filename         = data.archive_file.src.output_path
  source_code_hash = data.archive_file.src.output_base64sha256
  timeout          = var.timeout_seconds
  memory_size      = var.memory_mb
  tags             = local.tags

  environment {
    variables = {
      # Lambda sets AWS_REGION automatically; this is belt-and-suspenders.
      CLAWGUARD_ROTATION = "1"
    }
  }

  depends_on = [aws_cloudwatch_log_group.this]
}

# Secrets Manager needs permission to invoke this function. A single
# account-scoped permission with an AWS:SourceAccount condition avoids the
# cycle with the secrets module; the rotation Lambda's own IAM policy is
# what actually scopes which secrets can be rotated.
resource "aws_lambda_permission" "from_secrets_manager" {
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}
