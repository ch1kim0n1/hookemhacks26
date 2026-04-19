variable "name" {
  description = "Function name (also used for the IAM role and log group)."
  type        = string
  default     = "clawguard-rotate-token"
}

variable "secret_name_prefix" {
  description = <<-EOT
    Name prefix for secrets this Lambda may rotate. Permissions are granted on
    `arn:aws:secretsmanager:*:*:secret:<prefix>/*` — same naming convention
    used by the secrets module.
  EOT
  type    = string
  default = "clawguard"
}

variable "kms_key_arns" {
  description = "KMS key ARNs the managed secrets are encrypted with."
  type        = list(string)
  default     = []
}

variable "timeout_seconds" {
  description = "Lambda timeout. 60s is plenty for the four rotation steps."
  type        = number
  default     = 60
}

variable "memory_mb" {
  description = "Memory size. boto3 + handler fits comfortably in 256 MB."
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch log retention. 7 days for demo, bump for prod."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
