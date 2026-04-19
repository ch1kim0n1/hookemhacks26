variable "name" {
  description = "Module-level logical name (becomes part of alias + role names)."
  type        = string
  default     = "clawguard-node"
}

variable "node_id" {
  description = <<-EOT
    Short, DNS-safe identifier for this node (e.g. \"a\", \"b\", \"c\").
    Becomes part of the alias (alias/clawguard-node-a) and role name.
  EOT
  type = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,15}$", var.node_id))
    error_message = "node_id must match ^[a-z0-9][a-z0-9-]{0,15}$ (lowercase/digits/dashes, 1–16 chars)."
  }
}

variable "readable_secret_arns" {
  description = "Secrets Manager ARNs the task role may read."
  type        = list(string)
  default     = []
}

variable "envelope_kms_arn" {
  description = "Optional envelope KMS key ARN the task may Encrypt/Decrypt. Empty = no envelope permissions."
  type        = string
  default     = ""
}

variable "api_execute_arns" {
  description = <<-EOT
    API Gateway execute-arns the task may invoke (SigV4). Format:
    `arn:aws:execute-api:<region>:<account>:<api_id>/<stage>/<method>/<path>`.
    Wire this on the second apply, after the API module exists.
  EOT
  type    = list(string)
  default = []
}

variable "attached_policy_arns" {
  description = "Managed policy ARNs to attach (e.g. the Bedrock-invoke policy)."
  type        = list(string)
  default     = []
}

variable "deletion_window_in_days" {
  description = "KMS pending-deletion window. Minimum 7."
  type        = number
  default     = 7

  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
