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
  tags = merge(
    { Component = var.name, Node = var.node_id },
    var.tags,
  )
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# ---------------------------------------------------------------------------
# KMS asymmetric signing key — the node's Ethereum private key.
#
# Key spec ECC_SECG_P256K1 is the secp256k1 curve Ethereum uses. Combined
# with key_usage=SIGN_VERIFY, AWS enforces that:
#   - the private-key material never leaves the HSM
#   - the key cannot be exported in any form
#   - even kms:* root permissions cannot exfiltrate it
# Signing happens via kms:Sign with signing_algorithm=ECDSA_SHA_256 and
# MessageType=DIGEST (we hand KMS the pre-hashed tx digest).
#
# This key is NOT rotated — rotating it would change the derived Ethereum
# address, which would require re-registering each node on-chain. For the
# demo we treat the key as stable and rotate the envelope CMK instead.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "key" {
  statement {
    sid     = "EnableRootAdmin"
    effect  = "Allow"
    actions = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # The node's own task role is the only principal allowed to read the public
  # key or sign. No Encrypt/Decrypt here — this key is SIGN_VERIFY only, and
  # KMS would reject those calls anyway.
  statement {
    sid     = "AllowNodeRoleSign"
    effect  = "Allow"
    actions = [
      "kms:Sign",
      "kms:Verify",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      # The role is created below; but policies are evaluated dynamically,
      # so referencing its ARN here creates a cycle. Use the predictable
      # role ARN via account id + role name path.
      identifiers = [
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.role_name}",
      ]
    }
  }
}

locals {
  role_name = "${var.name}-${var.node_id}-role"
}

resource "aws_kms_key" "signer" {
  description              = "ClawGuard node ${var.node_id} — Ethereum signing key (non-exportable, HSM-bound)"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"

  # Asymmetric keys cannot use AWS-managed key rotation. See notes above.
  enable_key_rotation = false

  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.key.json
  tags                    = local.tags
}

resource "aws_kms_alias" "signer" {
  name          = "alias/${var.name}-${var.node_id}"
  target_key_id = aws_kms_key.signer.key_id
}

# ---------------------------------------------------------------------------
# Task role — assumed by the Fargate task for this node. Only this role can
# sign with this key (policy above). Only this role can read this node's
# secrets at runtime.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Guard against the confused deputy pattern: only tasks launched by this
    # account can assume the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = local.role_name
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task_inline" {
  # Sign / read the node's own KMS key. Resource pinned to the exact key ARN
  # so rotating the key (if we ever do) forces an explicit IAM update.
  statement {
    sid     = "NodeSignOnOwnKey"
    effect  = "Allow"
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.signer.arn]
  }

  # Read the node-scoped Secrets Manager entries. Empty list → no statement.
  dynamic "statement" {
    for_each = length(var.readable_secret_arns) > 0 ? [1] : []

    content {
      sid     = "ReadNodeSecrets"
      effect  = "Allow"
      actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      resources = var.readable_secret_arns
    }
  }

  # Decrypt envelope payloads (Secrets Manager does this via kms:ViaService,
  # so this is only needed if the task encrypts/decrypts its own data).
  dynamic "statement" {
    for_each = length(var.envelope_kms_arn) > 0 ? [1] : []

    content {
      sid     = "EnvelopeUse"
      effect  = "Allow"
      actions = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
      resources = [var.envelope_kms_arn]
    }
  }

  # Call the ClawGuard API Gateway via IAM-auth (SigV4). Empty stage →
  # caller hasn't wired the API yet.
  dynamic "statement" {
    for_each = length(var.api_execute_arns) > 0 ? [1] : []

    content {
      sid     = "InvokeClawGuardApi"
      effect  = "Allow"
      actions = ["execute-api:Invoke"]
      resources = var.api_execute_arns
    }
  }

  # Bedrock invoke permissions (typically attached via var.bedrock_policy_arn
  # below, but a dynamic inline block is fine when inline is preferred).
  statement {
    sid     = "CloudWatchLogs"
    effect  = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:${data.aws_partition.current.partition}:logs:*:*:log-group:/aws/ecs/${var.name}/*"]
  }
}

resource "aws_iam_role_policy" "task_inline" {
  name   = "${local.role_name}-inline"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_inline.json
}

# Optional attached managed policies (Bedrock invoke is the common one).
resource "aws_iam_role_policy_attachment" "managed" {
  for_each   = toset(var.attached_policy_arns)
  role       = aws_iam_role.task.name
  policy_arn = each.value
}
