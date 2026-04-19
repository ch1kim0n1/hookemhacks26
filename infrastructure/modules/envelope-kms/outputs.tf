output "key_id" {
  description = "KMS key id (UUID)."
  value       = aws_kms_key.envelope.key_id
}

output "key_arn" {
  description = "KMS key ARN. Pass into Secrets Manager kms_key_id and into grantee policy resources."
  value       = aws_kms_key.envelope.arn
}

output "alias" {
  description = "Alias name, e.g. alias/clawguard-envelope."
  value       = aws_kms_alias.envelope.name
}

output "alias_arn" {
  description = "Alias ARN."
  value       = aws_kms_alias.envelope.arn
}
