variable "name" {
  description = "Logical name. Used as the user-pool name and a prefix for everything else."
  type        = string
}

variable "domain_prefix" {
  description = <<-EOT
    Prefix for the auto-assigned Cognito hosted-UI domain. Must be globally unique
    across all Cognito pools in the region. Resulting URL:
    https://<prefix>.auth.<region>.amazoncognito.com
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,62}$", var.domain_prefix))
    error_message = "domain_prefix must be 3-63 chars, lowercase, digits, or hyphens."
  }
}

variable "callback_urls" {
  description = "Allowed redirect_uri values after login. Must be https (except localhost)."
  type        = list(string)
}

variable "logout_urls" {
  description = "Allowed redirect_uri values after logout."
  type        = list(string)
}

variable "mfa_required" {
  description = "If true, all users must set up TOTP MFA. If false, MFA is optional."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags merged onto every resource."
  type        = map(string)
  default     = {}
}
