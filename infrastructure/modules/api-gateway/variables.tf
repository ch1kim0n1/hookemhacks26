variable "name" {
  description = "Logical name — API, Lambdas, and IAM roles derive from this."
  type        = string
  default     = "clawguard-api"
}

variable "node_signing_key_arns" {
  description = "Exact list of node KMS signing key ARNs this API is allowed to sign with."
  type        = list(string)
}

variable "node_alias_prefix" {
  description = "Alias prefix for per-node keys; sign-tx Lambda uses `<prefix>-<node_id>` to resolve the key."
  type        = string
  default     = "clawguard-node"
}

variable "bedrock_policy_arn" {
  description = "Managed-policy ARN granting bedrock:InvokeModel. Output of the bedrock module."
  type        = string
}

variable "bedrock_model_id" {
  description = "Inference profile id. Must match the bedrock module's default."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for both Lambdas."
  type        = number
  default     = 7
}

variable "throttle_rate" {
  description = "Steady-state req/sec limit for the stage."
  type        = number
  default     = 10
}

variable "throttle_burst" {
  description = "Burst capacity for the stage."
  type        = number
  default     = 20
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
