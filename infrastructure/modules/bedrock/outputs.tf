output "policy_arn" {
  description = "ARN of the managed policy granting InvokeModel. Attach to task roles and Lambda exec roles."
  value       = aws_iam_policy.invoke.arn
}

output "policy_name" {
  description = "Managed policy name."
  value       = aws_iam_policy.invoke.name
}

output "inference_profile_arns" {
  description = "Computed inference-profile ARNs (handy for debugging policy evaluation)."
  value       = local.inference_profile_arns
}
