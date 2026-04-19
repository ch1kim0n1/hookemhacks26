output "account_id" {
  description = "AWS account id of the caller."
  value       = data.aws_caller_identity.current.account_id
}

output "caller_arn" {
  description = "ARN of the authenticated principal."
  value       = data.aws_caller_identity.current.arn
}

output "region" {
  description = "Resolved AWS region."
  value       = data.aws_region.current.name
}

output "partition" {
  description = "AWS partition (aws, aws-us-gov, aws-cn). Useful for building ARNs."
  value       = data.aws_partition.current.partition
}

output "bedrock_anthropic_models" {
  description = "Anthropic models visible to this account in this region. Empty unless check_bedrock = true."
  value       = try(data.aws_bedrock_foundation_models.claude[0].model_summaries[*].model_id, [])
}
