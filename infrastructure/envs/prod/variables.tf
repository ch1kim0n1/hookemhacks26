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
  description = <<-EOT
    Extra custom domains for the distribution beyond `site_domain_name`. Usually
    left empty — the dns module already wires the apex + www for you.
  EOT
  type    = list(string)
  default = []
}

variable "site_acm_certificate_arn" {
  description = <<-EOT
    Override ACM cert ARN. Leave null to use the cert the dns module provisions
    for `site_domain_name`. Must be in us-east-1.
  EOT
  type    = string
  default = null
}

variable "site_domain_name" {
  description = <<-EOT
    Apex domain served by CloudFront. Empty string disables the dns module and
    the distribution falls back to the default *.cloudfront.net hostname.
    Example: "clawguardian.ink".
  EOT
  type    = string
  default = ""
}

variable "dns_create_alias_records" {
  description = <<-EOT
    Whether the dns module creates apex + www ALIAS records pointing at
    CloudFront. Keep true; the zone is created regardless.
  EOT
  type    = bool
  default = true
}

variable "site_additional_html_entrypoints" {
  description = "Extra HTML entrypoints beyond index.html (e.g., [\"dashboard.html\"])."
  type        = list(string)
  default     = ["dashboard.html"]
}

variable "check_bedrock" {
  description = "Hard-gate on Bedrock access at plan time. Flip on once model access is granted."
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

# ---------------------------------------------------------------------------
# Pillar 2: KMS + Secrets Manager + Bedrock + ECS Fargate decentralised nodes
# ---------------------------------------------------------------------------

variable "node_ids" {
  description = "Short node identifiers. Three is the right number for the demo story."
  type        = list(string)
  default     = ["a", "b", "c"]
}

variable "enable_compute" {
  description = <<-EOT
    Turn on the VPC + Fargate nodes. Default OFF because the resources are not
    free (NAT + endpoints ~$85/mo). Flip on for a live demo, flip off after.
    KMS, Secrets Manager, Bedrock policy, and API Gateway Lambdas apply
    whether or not this is true.
  EOT
  type    = bool
  default = false
}

variable "node_container_image" {
  description = <<-EOT
    Image URI for the ClawGuard node container. On the very first apply use
    the placeholder default; after your first `docker push` update to
    `<ecr_repo_url>:<tag>` and re-apply.
  EOT
  type    = string
  default = "public.ecr.aws/docker/library/python:3.12-slim"
}

variable "base_sepolia_rpc_url" {
  description = "Public or private RPC URL for Base Sepolia (chain id 84532)."
  type        = string
  default     = "https://sepolia.base.org"
}

variable "registry_address" {
  description = "Deployed ClawGuardRegistry contract on Base Sepolia. Optional — nodes degrade gracefully when empty."
  type        = string
  default     = ""
}

variable "alert_emails" {
  description = "SNS subscribers for the observability alerts topic."
  type        = list(string)
  default     = []
}

variable "rotation_days" {
  description = "Automatic rotation cadence for bearer tokens. 30d matches enterprise default."
  type        = number
  default     = 30
}
