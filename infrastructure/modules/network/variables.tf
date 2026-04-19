variable "name" {
  description = "Module-level logical name (prefix for VPC + subnet + endpoint tags)."
  type        = string
  default     = "clawguard-net"
}

variable "vpc_cidr" {
  description = "Primary CIDR for the VPC. /16 gives plenty of room for 2 public + 2 private subnets."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR."
  }
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
