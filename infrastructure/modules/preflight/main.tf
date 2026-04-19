# TF-level preflight: data sources that fail at `terraform plan` time when the
# caller's credentials, region, or Bedrock access don't match what the stack
# expects. This is the quiet companion to `scripts/preflight.sh` — the bash
# script is informative, this module is a hard gate.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  expected_region = "us-east-1"
  region_ok       = data.aws_region.current.name == local.expected_region
}

# Hard-stop if applied anywhere outside us-east-1. CloudFront ACM certs + the
# Bedrock model availability we depend on both pin us here.
resource "terraform_data" "region_check" {
  lifecycle {
    precondition {
      condition     = local.region_ok
      error_message = "Expected region ${local.expected_region}, got ${data.aws_region.current.name}. Set provider region correctly."
    }
  }
}

# Optional Bedrock check. Leaving this on a data source would make `plan` fail
# in sandbox accounts without Bedrock access, which is fine, but we keep it
# toggleable because Pillar 1 isn't live yet.
data "aws_bedrock_foundation_models" "claude" {
  count = var.check_bedrock ? 1 : 0

  by_provider = "anthropic"
}
