variable "domain_name" {
  description = "Apex domain to host (e.g. clawguardian.ink). www.<domain> is added to the cert automatically."
  type        = string
}

variable "tags" {
  description = "Tags merged onto the zone and cert."
  type        = map(string)
  default     = {}
}
