output "secret_arns" {
  description = "Map of { short_name => secret ARN } for every managed secret."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "secret_names" {
  description = "Map of { short_name => full secret name (clawguard/<key>) }."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}

output "secret_arns_list" {
  description = "Flat list of secret ARNs. Useful for least-privilege IAM resource blocks."
  value       = [for s in aws_secretsmanager_secret.this : s.arn]
}
