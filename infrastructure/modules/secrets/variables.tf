variable "name" {
  description = "Module-level logical name (used for Component tag)."
  type        = string
  default     = "clawguard-secrets"
}

variable "name_prefix" {
  description = <<-EOT
    Prefix applied to each secret name — resulting name becomes
    `<name_prefix>/<key>` e.g. `clawguard/admin-token`.
  EOT
  type    = string
  default = "clawguard"
}

variable "secrets" {
  description = <<-EOT
    Map of secrets to create. Key is the short name (becomes last path
    segment); value holds the description surfaced in the console.
  EOT
  type = map(object({
    description = string
  }))
  default = {
    admin-token = {
      description = "X-Admin-Token for /api/audit"
    }
    metrics-token = {
      description = "Bearer token for /metrics"
    }
    ws-token = {
      description = "Bearer token for /ws/updates"
    }
  }
}

variable "kms_key_arn" {
  description = "KMS CMK ARN used to encrypt secret material. Required."
  type        = string
}

variable "rotation_lambda_arn" {
  description = <<-EOT
    ARN of the rotation Lambda. Leave empty to skip rotation wiring (useful on
    the very first apply if the Lambda doesn't exist yet — add on the next
    apply).
  EOT
  type    = string
  default = ""
}

variable "rotation_days" {
  description = "Automatic rotation cadence in days. 30 matches common enterprise posture."
  type        = number
  default     = 30

  validation {
    condition     = var.rotation_days >= 7 && var.rotation_days <= 365
    error_message = "rotation_days must be between 7 and 365."
  }
}

variable "recovery_window_in_days" {
  description = "Recovery window before the secret is permanently deleted. Zero = immediate delete (not allowed in prod)."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
