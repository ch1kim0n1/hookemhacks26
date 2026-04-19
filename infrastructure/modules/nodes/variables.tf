variable "name" {
  description = "Logical name — used for cluster, ECR repo, IAM roles."
  type        = string
  default     = "clawguard-nodes"
}

variable "nodes" {
  description = <<-EOT
    Map of node definitions. Key is the short id (becomes service + task
    family suffix). Each value holds the per-node task role ARN and the
    KMS signing key ARN the node owns (only for labelling / log context;
    kms:Sign is authorised by the task role's own policy).

    Example:
    {
      "a" = { task_role_arn = "...", kms_key_arn = "..." }
    }
  EOT
  type = map(object({
    task_role_arn = string
    kms_key_arn   = string
  }))
}

variable "container_image" {
  description = <<-EOT
    Full container image URI. Use a placeholder (e.g. public.ecr.aws/docker/library/python:3.12-slim)
    on the first apply, then update to `<ecr_repo_url>:<tag>` after the first push.
  EOT
  type    = string
  default = "public.ecr.aws/docker/library/python:3.12-slim"
}

variable "api_endpoint" {
  description = "HTTPS endpoint for the ClawGuard API Gateway (output of api-gateway module)."
  type        = string
}

variable "bedrock_model_id" {
  description = "Inference profile id the node uses. Pass through from envs/prod."
  type        = string
}

variable "registry_address" {
  description = "ClawGuardRegistry contract address on Base Sepolia. Optional — nodes degrade when empty."
  type        = string
  default     = ""
}

variable "base_sepolia_rpc_url" {
  description = "Base Sepolia RPC URL. Default is public sepolia.base.org; swap for Alchemy/Infura in a real demo."
  type        = string
  default     = "https://sepolia.base.org"
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the Fargate services."
  type        = list(string)
}

variable "task_security_group_id" {
  description = "SG attached to every task."
  type        = string
}

variable "envelope_kms_arn" {
  description = "Envelope CMK ARN — ECR repo encryption + exec-role Decrypt."
  type        = string
}

variable "readable_secret_arns" {
  description = "Secrets Manager ARNs the execution role may pull into the container env."
  type        = list(string)
  default     = []
}

variable "secret_refs" {
  description = <<-EOT
    Map of { ENV_VAR_NAME => secret_arn } that Fargate injects at task start.
    ECS resolves valueFrom at container boot via the exec role.
  EOT
  type    = map(string)
  default = {}
}

variable "extra_environment" {
  description = "Extra environment key/value pairs appended to every node task."
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "task_cpu" {
  description = "Fargate CPU units (256 = 0.25 vCPU)."
  type        = string
  default     = "256"
}

variable "task_memory" {
  description = "Fargate memory in MiB."
  type        = string
  default     = "512"
}

variable "log_retention_days" {
  description = "CloudWatch retention for each node's log group."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
