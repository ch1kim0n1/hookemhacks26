output "node_id" {
  description = "Echo of the node identifier (useful for loops in callers)."
  value       = var.node_id
}

output "kms_key_id" {
  description = "KMS key id (UUID) for the node's signing key."
  value       = aws_kms_key.signer.key_id
}

output "kms_key_arn" {
  description = "KMS key ARN."
  value       = aws_kms_key.signer.arn
}

output "kms_alias" {
  description = "Alias name, e.g. alias/clawguard-node-a."
  value       = aws_kms_alias.signer.name
}

output "task_role_arn" {
  description = "IAM role ARN the Fargate task assumes. One role per node."
  value       = aws_iam_role.task.arn
}

output "task_role_name" {
  description = "IAM role short name."
  value       = aws_iam_role.task.name
}
