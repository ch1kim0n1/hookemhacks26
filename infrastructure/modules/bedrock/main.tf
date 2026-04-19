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

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

# ---------------------------------------------------------------------------
# Bedrock invoke policy
#
# Claude models in Bedrock are exposed via cross-region inference profiles.
# The policy grants InvokeModel on:
#   1. The inference profile (what the caller actually references in code)
#   2. The foundation model ARNs the profile routes to (required by Bedrock —
#      resolving the profile still needs permission on each destination model)
#
# Model IDs list lives in `var.model_ids`. Default covers Claude Haiku 4.5 —
# multimodal, fast, cheap. That's what ClawGuard's detection pipeline uses.
# ---------------------------------------------------------------------------

locals {
  inference_profile_arns = [
    for id in var.inference_profile_ids :
    "arn:${data.aws_partition.current.partition}:bedrock:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:inference-profile/${id}"
  ]

  # Inference profiles route to foundation models in multiple regions. We grant
  # on all regions listed in var.cross_region_regions to avoid "model not in
  # profile" errors at invoke time.
  foundation_model_arns = flatten([
    for region in var.cross_region_regions : [
      for model_id in var.foundation_model_ids :
      "arn:${data.aws_partition.current.partition}:bedrock:${region}::foundation-model/${model_id}"
    ]
  ])
}

data "aws_iam_policy_document" "invoke" {
  statement {
    sid    = "InvokeInferenceProfiles"
    effect = "Allow"

    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]

    resources = concat(local.inference_profile_arns, local.foundation_model_arns)
  }

  # Listing models is handy for preflight checks and debugging. No ARN is
  # required — it's an account-wide read action.
  statement {
    sid     = "ListAndDescribe"
    effect  = "Allow"
    actions = [
      "bedrock:ListFoundationModels",
      "bedrock:GetFoundationModel",
      "bedrock:ListInferenceProfiles",
      "bedrock:GetInferenceProfile",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "invoke" {
  name        = "${var.name}-invoke"
  description = "Invoke Bedrock Claude Haiku for ClawGuard detection pipeline."
  policy      = data.aws_iam_policy_document.invoke.json
  tags        = local.tags
}
