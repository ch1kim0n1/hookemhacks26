variable "name" {
  description = "Module-level logical name (policy is named <name>-invoke)."
  type        = string
  default     = "clawguard-bedrock"
}

variable "inference_profile_ids" {
  description = <<-EOT
    Bedrock inference profile identifiers. Default: Claude Haiku 4.5 via the
    US cross-region profile. Override if you move to Sonnet/Opus for the
    LLM-judge tier.
  EOT
  type = list(string)
  default = [
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  ]
}

variable "foundation_model_ids" {
  description = <<-EOT
    Foundation model IDs the inference profiles route to. Must match the
    profile's targets; we grant invoke on all of them so profile resolution
    succeeds without extra IAM.
  EOT
  type = list(string)
  default = [
    "anthropic.claude-haiku-4-5-20251001-v1:0",
  ]
}

variable "cross_region_regions" {
  description = <<-EOT
    Regions the inference profile may route to. Default covers the US profile.
    Trim or expand to match your chosen profile's geography.
  EOT
  type = list(string)
  default = [
    "us-east-1",
    "us-east-2",
    "us-west-2",
  ]
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
