terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # S3 backend configured via `-backend-config=backend.hcl` at `terraform init`
  # (backend.hcl is gitignored; see backend.hcl.example).
  backend "s3" {}
}

provider "aws" {
  profile = var.aws_profile
  region  = var.aws_region

  default_tags {
    tags = {
      Project   = "clawguard"
      Env       = "prod"
      ManagedBy = "terraform"
    }
  }
}

# ACM certificates consumed by CloudFront must live in us-east-1. The root
# provider is already us-east-1 in this env; the alias is declared so the dns
# module can be region-explicit and safe to copy to another env later.
provider "aws" {
  alias   = "us_east_1"
  profile = var.aws_profile
  region  = "us-east-1"

  default_tags {
    tags = {
      Project   = "clawguard"
      Env       = "prod"
      ManagedBy = "terraform"
    }
  }
}
