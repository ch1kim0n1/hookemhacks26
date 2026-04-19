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

# ---------------------------------------------------------------------------
# Symmetric CMK — used for envelope encryption of any off-chain payload that
# leaves an AWS boundary (Secrets Manager KMS key, future node↔node broadcast,
# cross-node messages to peers). Yearly key rotation is AWS-managed and free;
# we enable it so the 30-second judge pitch ("keys rotate") is literal.
#
# This key does NOT sign Ethereum transactions — that's the job of the
# ECC_SECG_P256K1 keys in modules/node-signer. Separating them keeps the blast
# radius small: compromising this symmetric key only leaks data-at-rest, not
# on-chain authority.
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_iam_policy_document" "key" {
  # Root account can always administer — AWS recommends this for break-glass;
  # removing it can make a key permanently unmanageable.
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

  # Secrets Manager uses this key to encrypt secret material at rest.
  # The service principal is scoped via the kms:ViaService condition so only
  # SM in this region can request a decrypt.
  statement {
    sid    = "AllowSecretsManagerUse"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
      "kms:DescribeKey",
    ]

    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["secretsmanager.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.name}.amazonaws.com"]
    }
  }

  # Explicitly granted principals (node task roles + Lambda exec roles) get
  # Encrypt / Decrypt for off-chain payload envelopes. No key-admin powers.
  dynamic "statement" {
    for_each = length(var.grantee_arns) > 0 ? [1] : []

    content {
      sid    = "AllowGranteeEnvelopeUse"
      effect = "Allow"

      actions = [
        "kms:Decrypt",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]

      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.grantee_arns
      }
    }
  }
}

data "aws_region" "current" {}

resource "aws_kms_key" "envelope" {
  description             = "ClawGuard envelope encryption key — Secrets Manager + off-chain payloads"
  key_usage               = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.key.json
  tags                    = local.tags
}

resource "aws_kms_alias" "envelope" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.envelope.key_id
}
