variable "name" {
  description = "Logical name prefix for all fabric resources."
  type        = string
  default     = "clawguard-fabric"
}

variable "vpc_cidr" {
  description = "VPC primary CIDR."
  type        = string
  default     = "10.44.0.0/16"
}

variable "container_image" {
  description = "Full ECR image URI, e.g. 235921997878.dkr.ecr.us-east-1.amazonaws.com/clawguard-fabric:v1"
  type        = string
}

variable "nodes" {
  description = <<-DOC
    Map of node_id => {
      role     = "peer" | "validator"
      region   = string   # display label
      tenant   = string   # display label, e.g. "acme.co"
      peer_ids = list(string)  # this node's outbound peers (max 3)
    }
  DOC
  type = map(object({
    role     = string
    region   = string
    tenant   = string
    peer_ids = list(string)
  }))

  validation {
    condition     = alltrue([for _, n in var.nodes : length(n.peer_ids) <= 3])
    error_message = "Each node must have at most 3 outbound peer links (max 3 outbound)."
  }
}

variable "task_cpu" {
  description = "Fargate task vCPU units."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log group retention."
  type        = number
  default     = 3
}

variable "use_fargate_spot" {
  description = "Run tasks on Fargate Spot for ~70% cost reduction (demo-friendly)."
  type        = bool
  default     = true
}

variable "base_sepolia_rpc_url" {
  description = "RPC URL each task uses to read chain state."
  type        = string
  default     = "https://sepolia.base.org"
}

variable "registry_address" {
  description = "ClawGuard ThreatRegistry address on Base Sepolia."
  type        = string
  default     = ""
}

variable "cors_origins" {
  description = "Comma-separated CORS allow-list the backend honours."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags merged into every resource."
  type        = map(string)
  default     = {}
}
