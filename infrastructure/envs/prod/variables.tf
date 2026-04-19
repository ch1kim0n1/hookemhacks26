variable "aws_profile" {
  description = "Named AWS profile. Must match the bootstrap profile."
  type        = string
  default     = "hookem"
}

variable "aws_region" {
  description = "AWS region. Locked to us-east-1 to match bootstrap + CloudFront/ACM constraints."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project slug used in resource names."
  type        = string
  default     = "clawguard"
}

variable "site_name" {
  description = "Logical name for the static site (used as a prefix and as the Component tag)."
  type        = string
  default     = "clawguard-landing"
}

variable "site_aliases" {
  description = "Optional custom domains for the distribution. Empty = default *.cloudfront.net hostname only."
  type        = list(string)
  default     = []
}

variable "site_acm_certificate_arn" {
  description = "ACM cert ARN in us-east-1 covering `site_aliases`. Required when site_aliases is non-empty."
  type        = string
  default     = null
}

variable "site_additional_html_entrypoints" {
  description = "Extra HTML entrypoints beyond index.html (e.g., [\"dashboard.html\"])."
  type        = list(string)
  default     = ["dashboard.html"]
}

variable "check_bedrock" {
  description = "Hard-gate on Bedrock access at plan time. Flip on once model access is granted for Pillar 1."
  type        = bool
  default     = false
}

variable "cognito_name" {
  description = "Cognito user-pool logical name."
  type        = string
  default     = "clawguard-users"
}

variable "cognito_domain_prefix" {
  description = <<-EOT
    Prefix for the Cognito hosted-UI domain. Must be globally unique in the region.
    Leave empty to default to `clawguard-<account_id>`.
  EOT
  type        = string
  default     = ""
}

variable "cognito_extra_callback_urls" {
  description = <<-EOT
    Extra allowed callback URLs beyond the CloudFront URL. Useful for local
    development (e.g., `["http://localhost:5173/"]`).
  EOT
  type        = list(string)
  default     = ["http://localhost:5173/"]
}

variable "cognito_mfa_required" {
  description = "If true, all users must configure TOTP MFA. Keep on for the judge demo."
  type        = bool
  default     = true
}
