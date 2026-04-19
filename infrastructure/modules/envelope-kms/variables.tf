variable "name" {
  description = "Logical name for the CMK alias (becomes alias/<name>)."
  type        = string
  default     = "clawguard-envelope"
}

variable "grantee_arns" {
  description = <<-EOT
    IAM principals (role ARNs) allowed to Encrypt / Decrypt / GenerateDataKey on
    this CMK. Usually the ECS task roles for each node plus the Lambda exec roles.
    Leave empty on first apply; set after the node-signer module exists.
  EOT
  type        = list(string)
  default     = []
}

variable "deletion_window_in_days" {
  description = <<-EOT
    Pending-deletion window if the key is scheduled for deletion. 7 days is the
    AWS minimum — fine for a demo; bump to 30 before going to production.
  EOT
  type    = number
  default = 7

  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

variable "tags" {
  description = "Additional tags merged onto the CMK + alias."
  type        = map(string)
  default     = {}
}
