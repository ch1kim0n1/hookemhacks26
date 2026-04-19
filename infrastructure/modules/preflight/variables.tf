variable "check_bedrock" {
  description = <<-EOT
    If true, the module refuses to plan unless `bedrock:ListFoundationModels` succeeds
    for the Anthropic provider in the current region. Turn on once the account has
    Bedrock model access granted; Pillar 1 (multimodal Haiku detection) depends on it.
  EOT
  type        = bool
  default     = false
}
