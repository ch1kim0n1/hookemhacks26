variable "aws_profile" {
  description = "Named AWS profile to use."
  type        = string
  default     = "hookem"
}

variable "aws_region" {
  description = "AWS region. Pinned to us-east-1 to match the rest of the stack."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project slug used in resource names."
  type        = string
  default     = "clawguard"
}
