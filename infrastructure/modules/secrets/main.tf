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

  # Input is a map so callers get stable resource addresses per secret key.
  # Example:
  # {
  #   "admin-token"   = { description = "X-Admin-Token for /api/audit" }
  #   "metrics-token" = { description = "Bearer token for /metrics" }
  #   "ws-token"      = { description = "Bearer token for /ws/updates" }
  # }
  secrets = var.secrets
}

# ---------------------------------------------------------------------------
# One aws_secretsmanager_secret per entry. All encrypted with the envelope
# CMK — this is the "KMS + Secrets Manager" half of the pitch. AWS-managed
# rotation replaces the token value on a fixed cadence without any downstream
# interruption: readers pull AWSCURRENT on each call.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secrets

  name                    = "${var.name_prefix}/${each.key}"
  description             = each.value.description
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = merge(local.tags, { SecretKey = each.key })
}

# Bootstrap a random value so the secret is immediately usable. The rotation
# Lambda will overwrite this on its first run (scheduled for +1 day from
# initial apply by default, see rotation_rules.schedule_expression).
resource "random_password" "bootstrap" {
  for_each = local.secrets

  length  = 64
  special = false
}

resource "aws_secretsmanager_secret_version" "bootstrap" {
  for_each = local.secrets

  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = random_password.bootstrap[each.key].result

  # Rotation replaces this version by creating a new AWSPENDING → promoting it
  # to AWSCURRENT. Ignore drift on secret_string so subsequent plans don't want
  # to revert to the bootstrap value.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Rotation — 30 days by default, Lambda-driven.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret_rotation" "this" {
  for_each = var.rotation_lambda_arn == "" ? {} : local.secrets

  secret_id           = aws_secretsmanager_secret.this[each.key].id
  rotation_lambda_arn = var.rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.rotation_days
  }

  depends_on = [aws_secretsmanager_secret_version.bootstrap]
}
